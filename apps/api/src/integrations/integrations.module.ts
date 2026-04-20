import { forwardRef, Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EasyPostAdapter } from './adapters/easypost.adapter';
import { FedexAdapter } from './adapters/fedex.adapter';
import { UpsAdapter } from './adapters/ups.adapter';
import { UspsAdapter } from './adapters/usps.adapter';
import { CarrierService } from './carrier.service';
import { DocuSignService } from './docusign.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ShipmentIngestService } from './shipment-ingest.service';
import { ShipmentPollService } from './shipment-poll.service';
import { CarrierWebhooksController } from './webhooks.controller';
import { MetalsModule } from '../metals/metals.module';
import { CalendarModule } from '../calendar/calendar.module';

// Global: many feature modules will inject CarrierService/DocuSignService.
// Imports MetalsModule because IntegrationsController needs MetalsService
// for the admin "Test connection" button on the metals provider. The reverse
// dependency (MetalsService needs IntegrationsService) is satisfied by this
// module's @Global export.
@Global()
@Module({
  // forwardRef breaks the cycle: CalendarModule imports this one to read
  // integration credentials, and this controller needs CalendarService for
  // the per-provider "Test connection" button.
  //
  // ScheduleModule.forRoot() boots the cron scheduler so @Cron-decorated
  // methods on ShipmentPollService (and any future scheduled services in
  // this module) actually fire. Already called in BackupsModule, but
  // @nestjs/schedule is safe to initialize once per module it's used in —
  // internally it's a singleton registry.
  imports: [ScheduleModule.forRoot(), MetalsModule, forwardRef(() => CalendarModule)],
  controllers: [IntegrationsController, CarrierWebhooksController],
  providers: [
    IntegrationsService,
    CarrierService,
    DocuSignService,
    ShipmentIngestService,
    ShipmentPollService,
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
    ShipmentPollService,
  ],
})
export class IntegrationsModule {}
