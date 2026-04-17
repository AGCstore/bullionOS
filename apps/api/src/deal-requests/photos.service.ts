import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Kysely } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, DealRequestPhoto } from '../db/types';

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads', 'deal-request-photos');
const MAX_PER_REQUEST = 4;
const MAX_BYTES = 5_000_000;

const ALLOWED_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

export { ALLOWED_MIME, MAX_BYTES, MAX_PER_REQUEST };

@Injectable()
export class DealRequestPhotosService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  private async ensureDir() {
    await fs.mkdir(UPLOADS_ROOT, { recursive: true });
  }

  /** Verify the user owns the deal_request (either as client or as staff/admin). */
  async assertAccess(
    requestId: string,
    userId: string,
    role: 'admin' | 'staff' | 'client',
  ): Promise<void> {
    if (role === 'admin' || role === 'staff') {
      const exists = await this.db
        .selectFrom('deal_requests')
        .select('id')
        .where('id', '=', requestId)
        .executeTakeFirst();
      if (!exists) throw new NotFoundException('Request not found');
      return;
    }
    const row = await this.db
      .selectFrom('deal_requests as dr')
      .innerJoin('clients as c', 'c.id', 'dr.client_id')
      .select(['dr.id'])
      .where('dr.id', '=', requestId)
      .where('c.user_id', '=', userId)
      .executeTakeFirst();
    if (!row) throw new ForbiddenException('Not your request');
  }

  async list(requestId: string): Promise<DealRequestPhoto[]> {
    return this.db
      .selectFrom('deal_request_photos')
      .selectAll()
      .where('deal_request_id', '=', requestId)
      .orderBy('position')
      .execute();
  }

  async upload(
    requestId: string,
    file: Express.Multer.File,
    uploaderUserId: string,
  ): Promise<DealRequestPhoto> {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Unsupported image type');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('File too large (max 5 MB)');
    }

    const existing = await this.db
      .selectFrom('deal_request_photos')
      .select(({ fn }) => fn.countAll<string>().as('c'))
      .where('deal_request_id', '=', requestId)
      .executeTakeFirstOrThrow();
    if (Number(existing.c) >= MAX_PER_REQUEST) {
      throw new BadRequestException(`Max ${MAX_PER_REQUEST} photos per request`);
    }

    await this.ensureDir();
    const ext = ALLOWED_MIME.get(file.mimetype)!;
    const filename = `${requestId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
    const diskPath = path.join(UPLOADS_ROOT, filename);
    await fs.writeFile(diskPath, file.buffer);

    return this.db
      .insertInto('deal_request_photos')
      .values({
        deal_request_id: requestId,
        disk_path: diskPath,
        mime_type: file.mimetype,
        byte_size: file.size,
        position: Number(existing.c), // 0-indexed append
        uploaded_by_user_id: uploaderUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async resolvePhoto(photoId: string): Promise<DealRequestPhoto> {
    const row = await this.db
      .selectFrom('deal_request_photos')
      .selectAll()
      .where('id', '=', photoId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Photo not found');
    return row;
  }

  async assertPhotoAccess(
    photoId: string,
    userId: string,
    role: 'admin' | 'staff' | 'client',
  ): Promise<DealRequestPhoto> {
    const photo = await this.resolvePhoto(photoId);
    await this.assertAccess(photo.deal_request_id, userId, role);
    return photo;
  }

  async delete(photoId: string): Promise<void> {
    const photo = await this.resolvePhoto(photoId);
    await this.db.deleteFrom('deal_request_photos').where('id', '=', photoId).execute();
    try {
      await fs.unlink(photo.disk_path);
    } catch {
      /* file already gone — fine */
    }
  }
}
