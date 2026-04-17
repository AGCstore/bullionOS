import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../db/database.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [BackupsController],
  providers: [BackupsService],
})
export class BackupsModule {}
