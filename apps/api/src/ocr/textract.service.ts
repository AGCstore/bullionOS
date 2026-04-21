import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AnalyzeIDCommand,
  TextractClient,
} from '@aws-sdk/client-textract';

/**
 * Structured fields extracted from a government ID via AWS Textract
 * AnalyzeID. Everything is nullable — Textract only returns fields it
 * could read with confidence, and different document types expose
 * different field sets (a passport has no DOCUMENT_NUMBER in the US
 * driver's-license slot, etc.).
 *
 * Keys are our internal names; the adapter maps from Textract's
 * wire-format to these. We keep the raw text too so audit /
 * reprocessing is possible without re-calling AWS.
 */
export interface IdExtractionFields {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  suffix?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  date_of_birth?: string; // MM/DD/YYYY from Textract
  expiration_date?: string;
  issue_date?: string;
  document_number?: string;
  class?: string;
  endorsements?: string;
  restrictions?: string;
  sex?: string;
  /** Textract's raw confidence (0-100) for the whole doc, min across fields. */
  min_confidence?: number;
}

export interface IdExtractionResult {
  ok: true;
  fields: IdExtractionFields;
  raw_text: string;
}
export interface IdExtractionFailure {
  ok: false;
  reason: string;
}

/**
 * AWS Textract AnalyzeID wrapper.
 *
 * AnalyzeID is the right endpoint specifically for government IDs —
 * it returns structured fields (FIRST_NAME, LAST_NAME, ADDRESS, etc.)
 * rather than generic form fields the way AnalyzeDocument does.
 *
 * Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
 * AWS_REGION env vars. When any of those is missing, isConfigured()
 * returns false and callers should skip the OCR pass cleanly; the
 * attachment upload still succeeds.
 *
 * Cost: ~$0.025 per document (AnalyzeID, us-east-1, Apr 2026).
 * Latency: typically 1–3s per call. Small enough to do inline on
 * upload without needing a queue.
 */
@Injectable()
export class TextractService {
  private readonly logger = new Logger(TextractService.name);
  private readonly client: TextractClient | null;

  constructor(config: ConfigService) {
    const keyId = config.get<string>('AWS_ACCESS_KEY_ID') ?? '';
    const secret = config.get<string>('AWS_SECRET_ACCESS_KEY') ?? '';
    const region = config.get<string>('AWS_REGION') ?? 'us-east-1';
    if (!keyId || !secret) {
      this.client = null;
      this.logger.log(
        'AWS credentials not configured — client ID OCR is disabled',
      );
      return;
    }
    this.client = new TextractClient({
      region,
      credentials: { accessKeyId: keyId, secretAccessKey: secret },
    });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Run AnalyzeID against a single-page document image (JPG / PNG /
   * PDF accepted; multi-page PDFs only have their first page read
   * for AnalyzeID — that's the AWS limitation, not ours).
   *
   * Returns a discriminated union: `ok: true` with structured fields
   * on success, `ok: false` with a reason on failure. NEVER throws
   * to the caller — OCR is best-effort and an upload should never
   * fail because Textract was flaky.
   */
  async analyzeId(bytes: Buffer): Promise<IdExtractionResult | IdExtractionFailure> {
    if (!this.client) return { ok: false, reason: 'Textract not configured' };
    try {
      const res = await this.client.send(
        new AnalyzeIDCommand({ DocumentPages: [{ Bytes: bytes }] }),
      );
      const doc = res.IdentityDocuments?.[0];
      if (!doc || !doc.IdentityDocumentFields) {
        return { ok: false, reason: 'Textract returned no identity fields' };
      }
      const fields: IdExtractionFields = {};
      const rawLines: string[] = [];
      let minConfidence = 100;

      for (const f of doc.IdentityDocumentFields) {
        const type = f.Type?.Text ?? '';
        const value = f.ValueDetection?.Text ?? '';
        const conf = f.ValueDetection?.Confidence ?? 0;
        if (!type || !value) continue;
        rawLines.push(`${type}: ${value}`);
        if (conf > 0 && conf < minConfidence) minConfidence = conf;
        mapField(fields, type, value);
      }
      fields.min_confidence = minConfidence === 100 ? undefined : minConfidence;

      return {
        ok: true,
        fields,
        raw_text: rawLines.join('\n'),
      };
    } catch (err) {
      const msg = (err as Error).message ?? 'Textract call failed';
      this.logger.warn(`AnalyzeID failed: ${msg}`);
      return { ok: false, reason: msg.slice(0, 300) };
    }
  }
}

/**
 * Map Textract's AnalyzeID field-type codes to our internal field names.
 * List is from AWS docs:
 *   https://docs.aws.amazon.com/textract/latest/dg/analyzing-document-identity.html
 */
function mapField(out: IdExtractionFields, type: string, value: string): void {
  switch (type) {
    case 'FIRST_NAME':
      out.first_name = value;
      break;
    case 'LAST_NAME':
      out.last_name = value;
      break;
    case 'MIDDLE_NAME':
      out.middle_name = value;
      break;
    case 'SUFFIX':
      out.suffix = value;
      break;
    case 'ADDRESS':
      out.address_line1 = value;
      break;
    case 'CITY_IN_ADDRESS':
      out.city = value;
      break;
    case 'STATE_IN_ADDRESS':
    case 'STATE_NAME':
      out.state = value;
      break;
    case 'ZIP_CODE_IN_ADDRESS':
      out.postal_code = value;
      break;
    case 'COUNTY':
      // Not propagated — we don't track county on clients.
      break;
    case 'PLACE_OF_BIRTH':
      // Passport-only; no slot on our client record.
      break;
    case 'DATE_OF_BIRTH':
      out.date_of_birth = value;
      break;
    case 'EXPIRATION_DATE':
      out.expiration_date = value;
      break;
    case 'DATE_OF_ISSUE':
      out.issue_date = value;
      break;
    case 'DOCUMENT_NUMBER':
      out.document_number = value;
      break;
    case 'CLASS':
      out.class = value;
      break;
    case 'ENDORSEMENTS':
      out.endorsements = value;
      break;
    case 'RESTRICTIONS':
      out.restrictions = value;
      break;
    case 'ID_TYPE':
      // e.g. 'DRIVER LICENSE FRONT' — skip, we already know the kind.
      break;
    case 'SEX':
      out.sex = value;
      break;
    case 'VETERAN':
    case 'MRZ_CODE':
    default:
      // Ignored / unmapped. AWS adds new types over time; we stay
      // permissive rather than logging warnings for every new one.
      break;
  }
}
