import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  CurrentUser,
  type RequestUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { InvoiceAttachmentsService } from './invoice-attachments.service';

/**
 * Per-invoice attachment CRUD — admin/staff only. Mirrors the
 * client_attachments controller layout (nested upload + list, flat
 * download + delete).
 *
 *   GET    /admin/invoices/:invoiceId/attachments       list
 *   POST   /admin/invoices/:invoiceId/attachments       upload (multipart)
 *   GET    /admin/invoice-attachments/:id/file          stream bytes
 *   DELETE /admin/invoice-attachments/:id               remove
 *
 * Visibility: nothing in this controller is exposed on the client
 * portal. PDF generation and email delivery do not consume this
 * table — operator-only by design.
 */
@Controller()
@Roles('admin', 'staff')
export class InvoiceAttachmentsController {
  constructor(private readonly service: InvoiceAttachmentsService) {}

  @Get('admin/invoices/:invoiceId/attachments')
  list(@Param('invoiceId', new ParseUUIDPipe()) invoiceId: string) {
    return this.service.list(invoiceId);
  }

  @Post('admin/invoices/:invoiceId/attachments')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('kind') kind: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.create({
      invoiceId,
      kind: kind || 'other',
      filename: file.originalname,
      mime: file.mimetype,
      bytes: file.buffer,
      uploadedByUserId: user.id,
    });
  }

  @Get('admin/invoice-attachments/:id/file')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ) {
    const data = await this.service.getBytes(id);
    if (!data) throw new NotFoundException('Attachment not found');
    res.setHeader('Content-Type', data.mime);
    // Inline so images render in-page; the browser's default download
    // path takes over for non-inline-friendly mimes (rare here — we
    // expect overwhelmingly image/* uploads).
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(data.filename)}"`,
    );
    // Short private cache so thumbnails don't re-hit the DB on every
    // re-render; short enough that a delete reflects within a minute.
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.end(data.bytes);
  }

  @Delete('admin/invoice-attachments/:id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.delete(id);
  }
}
