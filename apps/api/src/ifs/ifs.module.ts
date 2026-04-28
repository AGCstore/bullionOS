import { Module } from '@nestjs/common';
import { IfsController } from './ifs.controller';
import { IfsService } from './ifs.service';

/**
 * IFS Clients (ifsclients.com) integration. Self-contained — relies
 * on the global Database + IntegrationsService. The @Cron decorator
 * on IfsService.scheduledSync wires into AppModule's ScheduleModule
 * registry.
 */
@Module({
  controllers: [IfsController],
  providers: [IfsService],
  exports: [IfsService],
})
export class IfsModule {}
