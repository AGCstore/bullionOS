import { Global, Module } from '@nestjs/common';
import { EasyPostAdapter } from './adapters/easypost.adapter';
import { FedexAdapter } from './adapters/fedex.adapter';
import { UpsAdapter } from './adapters/ups.adapter';
import { UspsAdapter } from './adapters/usps.adapter';
import { CarrierService } from './carrier.service';
import { DocuSignService } from './docusign.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ShipmentIngestService } from './shipment-ingest.service';
import { CarrierWebhooksController } from './webhooks.controller';

// Global: many feature modules will inject CarrierService/DocuSignService.
@Global()
@Module({
  controllers: [IntegrationsController, CarrierWebhooksController],
  providers: [
    IntegrationsService,
    CarrierService,
    DocuSignService,
    ShipmentIngestService,
    // Carrier adapters — one per provider.
    UpsAdapter,
    FedexAdapter,
    UspsAdapter,
    EasyPostAdapter,
  ],
  exports: [
    IntegrationsService,
    CarrierService,
    DocuSignService,
    ShipmentIngestService,
  ],
})
export class IntegrationsModule {}
