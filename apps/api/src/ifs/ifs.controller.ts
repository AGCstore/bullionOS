import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { IfsService } from './ifs.service';

/**
 * Admin-only IFS surface. Phase 1 = read-only mirror of the
 * ifsclients.com shipment dashboard.
 *
 *   GET  /admin/ifs/state           — last-sync metadata
 *   GET  /admin/ifs/shipments?q=…   — flat list (search optional)
 *   POST /admin/ifs/sync            — manual refresh
 */
@Controller('admin/ifs')
@Roles('admin', 'staff')
export class IfsController {
  constructor(private readonly ifs: IfsService) {}

  @Get('state')
  state() {
    return this.ifs.getSyncState();
  }

  @Get('shipments')
  shipments(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.ifs.listShipments({
      search: q,
      limit: limit ? Math.min(1000, Math.max(1, Number(limit))) : undefined,
    });
  }

  @Post('sync')
  @HttpCode(200)
  @Roles('admin')
  sync() {
    return this.ifs.runSync();
  }
}
