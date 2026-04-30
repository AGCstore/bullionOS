import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB } from '../db/types';

export interface InvoiceAttachmentMeta {
  id: string;
  invoice_id: string;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: number;
  uploaded_by_user_id: string | null;
  created_at: Date;
}

/**
 * Per-invoice attachment storage (ID photos, customer photos, item
 * photos for scrap intake compliance). Bytes live inline in Postgres
 * alongside meta, mirroring client_attachments — single-tenant, no
 * external blob store required. The PDF generator and client portal
 * both ignore this table by design; rows only surface on the admin
 * invoice-detail page.
 */
@Injectable()
export class InvoiceAttachmentsService {
  /**
   * 15 MB cap matches client_attachments. Enforced server-side so a
   * misbehaving client can't silently pollute the DB; the upload UI
   * surfaces the failure as a clear toast.
   */
  private static readonly MAX_BYTES = 15 * 1024 * 1024;

  /**
   * Allowed kinds. Free-text in the DB so operators can add new tags
   * without a migration; the API enforces the closed set so we don't
   * accidentally store garbage.
   */
  private static readonly KINDS = new Set([
    'id',
    'client_photo',
    'item',
    'other',
  ]);

  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async list(invoiceId: string): Promise<InvoiceAttachmentMeta[]> {
    const rows = await this.db
      .selectFrom('invoice_attachments')
      .select([
        'id',
        'invoice_id',
        'kind',
        'filename',
        'mime',
        'size_bytes',
        'uploaded_by_user_id',
        'created_at',
      ])
      .where('invoice_id', '=', invoiceId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows as unknown as InvoiceAttachmentMeta[];
  }

  async create(input: {
    invoiceId: string;
    kind: string;
    filename: string;
    mime: string;
    bytes: Buffer;
    uploadedByUserId: string;
  }): Promise<InvoiceAttachmentMeta> {
    if (input.bytes.length > InvoiceAttachmentsService.MAX_BYTES) {
      throw new BadRequestException(
        `Attachment exceeds 15 MB limit (${(input.bytes.length / 1024 / 1024).toFixed(1)} MB)`,
      );
    }
    const kind = (input.kind || 'other').toLowerCase();
    if (!InvoiceAttachmentsService.KINDS.has(kind)) {
      throw new BadRequestException(
        `Invalid kind '${kind}'. Allowed: ${[...InvoiceAttachmentsService.KINDS].join(', ')}`,
      );
    }

    // Confirm the invoice exists; otherwise the bytea insert fails
    // with a cryptic FK error.
    const invoice = await this.db
      .selectFrom('invoices')
      .select('id')
      .where('id', '=', input.invoiceId)
      .executeTakeFirst();
    if (!invoice) throw new NotFoundException('Invoice not found');

    const inserted = await this.db
      .insertInto('invoice_attachments')
      .values({
        invoice_id: input.invoiceId,
        kind,
        filename: input.filename.slice(0, 255),
        mime: input.mime.slice(0, 100),
        bytes: input.bytes,
        size_bytes: input.bytes.length,
        uploaded_by_user_id: input.uploadedByUserId,
      })
      .returning([
        'id',
        'invoice_id',
        'kind',
        'filename',
        'mime',
        'size_bytes',
        'uploaded_by_user_id',
        'created_at',
      ])
      .executeTakeFirstOrThrow();

    return inserted as unknown as InvoiceAttachmentMeta;
  }

  /** Stream bytes for inline preview / download. */
  async getBytes(
    id: string,
  ): Promise<{ filename: string; mime: string; bytes: Buffer } | null> {
    const row = await this.db
      .selectFrom('invoice_attachments')
      .select(['filename', 'mime', 'bytes'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      filename: row.filename,
      mime: row.mime,
      bytes: row.bytes as unknown as Buffer,
    };
  }

  async delete(id: string): Promise<void> {
    const r = await this.db
      .deleteFrom('invoice_attachments')
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) {
      throw new NotFoundException('Attachment not found');
    }
  }
}
