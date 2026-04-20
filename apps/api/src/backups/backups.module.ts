import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

/**
 * ScheduleModule.forRoot() intentionally NOT registered here. Per
 * nestjs/schedule guidance, forRoot() must be called exactly once at
 * the app root (AppModule). Calling it in multiple feature modules
 * creates duplicate registries, and @Cron decorators on services
 * across the app can fail to wire up to the active scheduler.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [BackupsController],
  providers: [BackupsService],
})
export class BackupsModule {}
