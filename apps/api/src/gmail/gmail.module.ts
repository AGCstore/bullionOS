import { Module } from '@nestjs/common';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';
import { RarcoaModule } from '../rarcoa/rarcoa.module';

/**
 * Gmail auto-ingest module.
 *
 * Depends on RarcoaModule so the poller can hand PDF attachments
 * straight to RarcoaService.ingestPdf(). IntegrationsService and
 * NotificationsService both come from @Global modules so they're
 * implicitly available — no explicit import needed.
 *
 * ScheduleModule.forRoot() is NOT called here; AppModule owns the
 * root scheduler and the @Cron decorator on GmailService.scheduledPoll
 * wires itself into that registry automatically.
 */
@Module({
  imports: [RarcoaModule],
  controllers: [GmailController],
  providers: [GmailService],
  exports: [GmailService],
})
export class GmailModule {}
