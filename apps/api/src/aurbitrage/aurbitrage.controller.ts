import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AurbitrageService } from './aurbitrage.service';

/**
 * Admin-only Aurbitrage surface. Pricing data is wholesale-vendor
 * intel — we don't expose any of this to the client portal.
 *
 *   GET  /admin/aurbitrage/state    — last-sync metadata
 *   GET  /admin/aurbitrage/quotes   — flat list of all stored quotes
 *   POST /admin/aurbitrage/sync     — manual refresh
 */
@Controller('admin/aurbitrage')
@Roles('admin', 'staff')
export class AurbitrageController {
  constructor(private readonly aurbitrage: AurbitrageService) {}

  @Get('state')
  state() {
    return this.aurbitrage.getSyncState();
  }

  @Get('quotes')
  quotes() {
    return this.aurbitrage.listQuotes();
  }

  @Post('sync')
  @HttpCode(200)
  @Roles('admin')
  sync() {
    return this.aurbitrage.runSync();
  }
}
