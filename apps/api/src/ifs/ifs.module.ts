import { Module } from '@nestjs/common';
import { IfsController } from './ifs.controller';
import { IfsService } from './ifs.service';
import { ShipmentsModule } from '../shipments/shipments.module';

/**
 * IFS Clients (ifsclients.com) integration. Relies on the global
 * Database + IntegrationsService. ShipmentsModule is imported so
 * Phase 2's createLabel() can call ShipmentsService.create() to
 * link a new IFS label back to its invoice (carrier='fedex').
 *
 * The @Cron decorator on IfsService.scheduledSync wires into
 * AppModule's ScheduleModule registry.
 */
@Module({
  imports: [ShipmentsModule],
  controllers: [IfsController],
  providers: [IfsService],
  exports: [IfsService],
})
export class IfsModule {}
