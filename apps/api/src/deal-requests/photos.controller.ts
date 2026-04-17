import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as fs from 'node:fs';
import type { Response } from 'express';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import {
  ALLOWED_MIME,
  DealRequestPhotosService,
  MAX_BYTES,
} from './photos.service';

@Controller('deal-requests/:id/photos')
export class DealRequestPhotosController {
  constructor(private readonly service: DealRequestPhotosService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.service.assertAccess(id, user.id, user.role);
    const rows = await this.service.list(id);
    return rows.map((r) => ({
      id: r.id,
      mime_type: r.mime_type,
      byte_size: r.byte_size,
      position: r.position,
      url: `/api/v1/deal-requests/${id}/photos/${r.id}/file`,
      created_at: r.created_at,
    }));
  }

  @Post()
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported type. Allowed: ${[...ALLOWED_MIME.keys()].join(', ')}`,
      );
    }
    await this.service.assertAccess(id, user.id, user.role);
    const photo = await this.service.upload(id, file, user.id);
    return {
      id: photo.id,
      url: `/api/v1/deal-requests/${id}/photos/${photo.id}/file`,
    };
  }

  /** Serve the file bytes. Auth-gated so photos aren't publicly enumerable. */
  @Get(':photoId/file')
  async getFile(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @Res() res: Response,
  ) {
    const photo = await this.service.assertPhotoAccess(photoId, user.id, user.role);
    if (photo.deal_request_id !== id) {
      throw new BadRequestException('Photo not attached to this request');
    }
    res.setHeader('Content-Type', photo.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(photo.disk_path).pipe(res);
  }

  @Delete(':photoId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ) {
    const photo = await this.service.assertPhotoAccess(photoId, user.id, user.role);
    if (photo.deal_request_id !== id) {
      throw new BadRequestException('Photo not attached to this request');
    }
    await this.service.delete(photoId);
  }
}
