import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { KpiController } from './kpi.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [KpiController],
})
export class KpiModule {}
