import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminInvoicesController } from './invoices.controller';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';
import { InvoiceAttachmentsController } from './invoice-attachments.controller';
import { InvoiceAttachmentsService } from './invoice-attachments.service';

@Module({
  imports: [PricingModule, SettingsModule],
  controllers: [AdminInvoicesController, InvoiceAttachmentsController],
  providers: [InvoicesService, InvoicePdfService, InvoiceAttachmentsService],
  exports: [InvoicesService, InvoicePdfService],
})
export class InvoicesModule {}
