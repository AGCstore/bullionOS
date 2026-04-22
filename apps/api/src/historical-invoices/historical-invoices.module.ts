import { Module } from '@nestjs/common';
import { HistoricalInvoicesController } from './historical-invoices.controller';
import { HistoricalInvoicesService } from './historical-invoices.service';

@Module({
  controllers: [HistoricalInvoicesController],
  providers: [HistoricalInvoicesService],
  exports: [HistoricalInvoicesService],
})
export class HistoricalInvoicesModule {}
