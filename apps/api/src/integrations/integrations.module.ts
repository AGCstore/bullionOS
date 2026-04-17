import { Global, Module } from '@nestjs/common';
import { CarrierService } from './carrier.service';
import { DocuSignService } from './docusign.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

// Global: many feature modules will inject CarrierService/DocuSignService.
@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, CarrierService, DocuSignService],
  exports: [IntegrationsService, CarrierService, DocuSignService],
})
export class IntegrationsModule {}
