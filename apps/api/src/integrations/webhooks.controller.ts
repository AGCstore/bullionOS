import {
  BadRequestException,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import type { ShipmentCarrier } from '../db/types';
import { CarrierService } from './carrier.service';
import { ShipmentIngestService } from './shipment-ingest.service';

/**
 * Webhook receivers for carrier push updates.
 *
 * Status
 *   - `/webhooks/carriers/:carrier` is wired but idle: no carrier is
 *     currently signed up for push delivery. When a carrier's webhook is
 *     enabled in their admin portal, its adapter must implement
 *     verifyWebhook() + parseWebhook() and this controller will route
 *     into ShipmentIngestService.
 *
 * Security
 *   - Public (no JWT) because carriers authenticate via signed payloads.
 *   - Signature verification delegated to the adapter. A missing/bad
 *     signature is a 401; a correctly signed but malformed body is a 400.
 *
 * Idempotency
 *   - Carriers retry on non-2xx. ShipmentIngestService uses an ON CONFLICT
 *     on (shipment_id, carrier_event_id), so replayed events are no-ops.
 */
@Controller('webhooks/carriers')
export class CarrierWebhooksController {
  constructor(
    private readonly carrier: CarrierService,
    private readonly ingest: ShipmentIngestService,
  ) {}

  @Public()
  @Post(':carrier')
  @HttpCode(200)
  async receive(@Param('carrier') carrierRaw: string, @Req() req: Request) {
    const carrier = carrierRaw as ShipmentCarrier;
    const adapter = this.carrier.getAdapter(carrier);
    if (!adapter) throw new BadRequestException(`Unknown carrier: ${carrierRaw}`);
    if (!adapter.verifyWebhook || !adapter.parseWebhook) {
      // Carrier doesn't support push; 202-style ignore. We don't currently
      // accept any webhook — this returns OK so misconfigured tests don't spam
      // carrier dashboards with failures.
      return { received: false, reason: 'carrier does not support webhooks' };
    }

    // Verify signature. We need the raw body as a Buffer; cookie-parser +
    // body-parser already converted to JSON, so callers that wire real
    // webhooks must also register a raw-body parser for this route. Left
    // as an explicit gap — not a crash path today.
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody
      ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }

    const verdict = await adapter.verifyWebhook(rawBody, headers);
    if (!verdict.ok) {
      throw new BadRequestException(`Invalid webhook signature: ${verdict.message}`);
    }

    const updates = adapter.parseWebhook(rawBody);
    for (const update of updates) {
      await this.ingest.ingest(update);
    }
    return { received: true, count: updates.length };
  }
}
