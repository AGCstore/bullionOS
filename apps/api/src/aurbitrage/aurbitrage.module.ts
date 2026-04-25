import { Module } from '@nestjs/common';
import { AurbitrageController } from './aurbitrage.controller';
import { AurbitrageService } from './aurbitrage.service';

/**
 * Aurbitrage wholesaler-pricing aggregator. Self-contained — relies
 * on the global Database + IntegrationsService (the latter from the
 * @Global IntegrationsModule). The @Cron decorator on
 * AurbitrageService.scheduledSync wires into AppModule's
 * ScheduleModule registry.
 */
@Module({
  controllers: [AurbitrageController],
  providers: [AurbitrageService],
  exports: [AurbitrageService],
})
export class AurbitrageModule {}
