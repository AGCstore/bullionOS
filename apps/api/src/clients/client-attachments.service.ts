import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB } from '../db/types';
import { TextractService } from '../ocr/textract.service';

export interface ClientAttachmentMeta {
  id: string;
  client_id: string;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: number;
  uploaded_by_user_id: string | null;
  ocr_status: 'pending' | 'succeeded' | 'failed' | null;
  ocr_fields: unknown;
  created_at: Date;
}

// Kinds that get dispatched to the OCR pipeline on upload.
const OCR_ELIGIBLE_KINDS = new Set(['drivers_license', 'passport', 'id_other']);

/**
 * Client attachment storage (ID docs, receipts, photos). Bytes live
 * inline in the DB alongside a meta row. Upload cap enforced in the
 * service; the admin page surfaces a clear error when it's tripped.
 */
@Injectable()
export class ClientAttachmentsService {
  private static readonly MAX_BYTES = 15 * 1024 * 1024; // 15 MB
  private readonly logger = new Logger(ClientAttachmentsService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly textract: TextractService,
  ) {}

  async list(clientId: string): Promise<ClientAttachmentMeta[]> {
    const rows = await this.db
      .selectFrom('client_attachments')
      .select([
        'id',
        'client_id',
        'kind',
        'filename',
        'mime',
        'size_bytes',
        'uploaded_by_user_id',
        'ocr_status',
        'ocr_fields',
        'created_at',
      ])
      .where('client_id', '=', clientId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows as unknown as ClientAttachmentMeta[];
  }

  async create(input: {
    clientId: string;
    kind: string;
    filename: string;
    mime: string;
    bytes: Buffer;
    uploadedByUserId: string;
  }): Promise<ClientAttachmentMeta> {
    if (input.bytes.length > ClientAttachmentsService.MAX_BYTES) {
      throw new BadRequestException(
        `Attachment exceeds 15 MB limit (${(input.bytes.length / 1024 / 1024).toFixed(1)} MB)`,
      );
    }
    // Confirm the client exists; otherwise the bytea insert would
    // fail with a cryptic FK error.
    const client = await this.db
      .selectFrom('clients')
      .select('id')
      .where('id', '=', input.clientId)
      .executeTakeFirst();
    if (!client) throw new NotFoundException('Client not found');

    const kind = input.kind || 'other';
    const shouldOcr =
      OCR_ELIGIBLE_KINDS.has(kind) &&
      this.textract.isConfigured() &&
      input.mime.startsWith('image/');

    const inserted = await this.db
      .insertInto('client_attachments')
      .values({
        client_id: input.clientId,
        kind,
        filename: input.filename.slice(0, 255),
        mime: input.mime.slice(0, 100),
        bytes: input.bytes,
        size_bytes: input.bytes.length,
        uploaded_by_user_id: input.uploadedByUserId,
        ocr_status: shouldOcr ? 'pending' : null,
      })
      .returning([
        'id',
        'client_id',
        'kind',
        'filename',
        'mime',
        'size_bytes',
        'uploaded_by_user_id',
        'ocr_status',
        'ocr_fields',
        'created_at',
      ])
      .executeTakeFirstOrThrow();

    // Fire OCR inline after the insert lands. AnalyzeID typically
    // returns in 1-3 seconds — slow enough that the UX shows "Uploading…"
    // a beat longer, fast enough that putting it on a background job is
    // over-engineering at AGC's volume. Always wrapped in try/catch so
    // an OCR failure can never break the upload itself.
    if (shouldOcr) {
      try {
        const result = await this.textract.analyzeId(input.bytes);
        if (result.ok) {
          await this.db
            .updateTable('client_attachments')
            .set({
              ocr_status: 'succeeded',
              ocr_text: result.raw_text,
              ocr_fields: sql`${JSON.stringify(result.fields)}::jsonb`,
            })
            .where('id', '=', inserted.id)
            .execute();
          return {
            ...inserted,
            ocr_status: 'succeeded',
            ocr_fields: result.fields,
          } as unknown as ClientAttachmentMeta;
        } else {
          await this.db
            .updateTable('client_attachments')
            .set({
              ocr_status: 'failed',
              ocr_text: result.reason,
            })
            .where('id', '=', inserted.id)
            .execute();
          this.logger.warn(
            `OCR failed for attachment ${inserted.id}: ${result.reason}`,
          );
          return {
            ...inserted,
            ocr_status: 'failed',
          } as unknown as ClientAttachmentMeta;
        }
      } catch (err) {
        // Shouldn't happen — TextractService catches internally — but
        // belt-and-suspenders so a bug there can't roll back the
        // upload.
        this.logger.error(
          `Unexpected OCR exception for ${inserted.id}: ${(err as Error).message}`,
        );
      }
    }

    return inserted as unknown as ClientAttachmentMeta;
  }

  /**
   * Return the OCR fields extracted from an attachment. Used by the
   * "Fill from ID" flow on the client edit page — the UI pre-fills
   * the form with these values, the operator reviews, then saves.
   */
  async getOcrFields(id: string): Promise<{
    status: 'pending' | 'succeeded' | 'failed' | null;
    fields: Record<string, unknown> | null;
    text: string | null;
  } | null> {
    const row = await this.db
      .selectFrom('client_attachments')
      .select(['ocr_status', 'ocr_fields', 'ocr_text'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      status: row.ocr_status,
      fields: (row.ocr_fields as Record<string, unknown> | null) ?? null,
      text: row.ocr_text,
    };
  }

  /** Stream bytes out for a download/preview. */
  async getBytes(
    id: string,
  ): Promise<{ filename: string; mime: string; bytes: Buffer } | null> {
    const row = await this.db
      .selectFrom('client_attachments')
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
      .deleteFrom('client_attachments')
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) {
      throw new NotFoundException('Attachment not found');
    }
  }
}
