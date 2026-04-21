import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { KpiController } from './kpi.controller';
import { KpiManualEntriesController } from './kpi-manual-entries.controller';
import { KpiManualEntriesService } from './kpi-manual-entries.service';

@Module({
  // InvoicesModule is imported so we can delegate the wholesale-owed
  // breakdown to InvoicesService.listOutstandingWholesale() rather than
  // duplicating the aggregation query. No cycle — InvoicesModule does
  // not depend on KpiModule.
  imports: [DatabaseModule, InvoicesModule],
  controllers: [KpiController, KpiManualEntriesController],
  providers: [KpiManualEntriesService],
  exports: [KpiManualEntriesService],
})
export class KpiModule {}
