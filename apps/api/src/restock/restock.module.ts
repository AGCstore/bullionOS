import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { RestockController } from './restock.controller';
import { RestockService } from './restock.service';

/**
 * Restock-notification pipeline. `@Global()` so InventoryService +
 * InvoicesService can inject {@link RestockService} without a
 * forward-ref. The service sends the "back in stock" email; the
 * controller serves the public unsubscribe page.
 *
 * EmailModule is already `@Global()`, so we only need to pull in
 * SettingsModule here for branding + email-template access.
 */
@Global()
@Module({
  imports: [SettingsModule],
  controllers: [RestockController],
  providers: [RestockService],
  exports: [RestockService],
})
export class RestockModule {}
