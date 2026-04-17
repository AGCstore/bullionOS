import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { SettingsService, UPLOADS_DIR } from './settings.service';

class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  company_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  address_line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  address_line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  address_city_state_zip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  website?: string;
}

const ALLOWED_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/svg+xml', '.svg'],
]);
const MAX_LOGO_BYTES = 1_000_000; // 1 MB is plenty for a logo.

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('admin/settings')
  @Roles('admin', 'staff')
  async get() {
    return {
      branding: await this.settings.getBranding(),
    };
  }

  @Patch('admin/settings/branding')
  @Roles('admin')
  async updateBranding(@Body() dto: UpdateBrandingDto, @CurrentUser() user: RequestUser) {
    const fieldMap: Array<[keyof UpdateBrandingDto, string]> = [
      ['company_name', 'branding.company_name'],
      ['company_tagline', 'branding.company_tagline'],
      ['address_line1', 'branding.address_line1'],
      ['address_line2', 'branding.address_line2'],
      ['address_city_state_zip', 'branding.address_city_state_zip'],
      ['phone', 'branding.phone'],
      ['website', 'branding.website'],
    ];
    for (const [dtoField, key] of fieldMap) {
      const value = dto[dtoField];
      if (value !== undefined) await this.settings.setString(key, value, user.id);
    }
    return this.settings.getBranding();
  }

  @Post('admin/settings/logo')
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
    }),
  )
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart/form-data)');

    const ext = ALLOWED_MIME.get(file.mimetype);
    if (!ext) {
      throw new BadRequestException(
        `Unsupported image type. Allowed: ${[...ALLOWED_MIME.keys()].join(', ')}`,
      );
    }

    // Basic magic-byte sniff so a mislabeled file can't sneak through.
    if (file.mimetype === 'image/png' && !this.startsWith(file.buffer, [0x89, 0x50, 0x4e, 0x47])) {
      throw new BadRequestException('File content does not match PNG');
    }
    if (file.mimetype === 'image/jpeg' && !this.startsWith(file.buffer, [0xff, 0xd8, 0xff])) {
      throw new BadRequestException('File content does not match JPEG');
    }

    await this.settings.ensureUploadsDir();

    // Remove prior logo so we don't leak files.
    await this.settings.deleteLogo(user.id);

    const filename = `logo-${Date.now()}${ext}`;
    const diskPath = path.join(UPLOADS_DIR, filename);
    await fs.promises.writeFile(diskPath, file.buffer);

    await this.settings.setLogoPath(diskPath, user.id);
    return this.settings.getBranding();
  }

  @Delete('admin/settings/logo')
  @Roles('admin')
  @HttpCode(204)
  async removeLogo(@CurrentUser() user: RequestUser) {
    await this.settings.deleteLogo(user.id);
  }

  /** Serves the current logo. Public so it can be embedded in PDFs/emails. */
  @Public()
  @Get('public/branding/logo')
  async getLogo(@Res() res: Response) {
    const diskPath = await this.settings.resolveLogoFile();
    if (!diskPath) {
      res.status(404).end();
      return;
    }
    const ext = path.extname(diskPath).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.svg'
          ? 'image/svg+xml'
          : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=60');
    fs.createReadStream(diskPath).pipe(res);
  }

  private startsWith(buf: Buffer, bytes: number[]): boolean {
    if (buf.length < bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) if (buf[i] !== bytes[i]) return false;
    return true;
  }
}
