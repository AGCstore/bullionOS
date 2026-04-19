import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { BackupsService } from './backups.service';

@Controller('admin/backups')
@Roles('admin', 'staff')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  list() {
    return this.backups.list();
  }

  /** Kick off an ad-hoc backup. Returns the new row's id immediately. */
  @Post('run')
  @HttpCode(202)
  async run(@CurrentUser() user: RequestUser) {
    const id = await this.backups.run({
      trigger: 'manual',
      createdByUserId: user.id,
    });
    return { id };
  }

  /**
   * Stream a completed backup's gzipped SQL script to the client.
   * Served as application/octet-stream so the browser saves directly.
   * Filename encodes the ISO start timestamp so downloaded backups
   * self-sort on disk. `.sql.gz` signals plain-SQL, gzip-compressed —
   * restorable via `gunzip -c file.sql.gz | psql $URL`.
   */
  @Get(':id/download')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ) {
    const row = await this.backups.getDump(id);
    if (!row) throw new NotFoundException('Backup not available');
    const stamp = row.startedAt.toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="agc-${stamp}.sql.gz"`,
    );
    res.setHeader('Content-Length', row.bytes.length);
    res.end(row.bytes);
  }
}
