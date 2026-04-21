import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { KpiManualEntriesService } from './kpi-manual-entries.service';
import type { KpiManualCategory } from '../db/types';
import {
  CreateKpiManualEntryDto,
  UpdateKpiManualEntryDto,
} from './dto/kpi-manual-entry.dto';

/**
 * Admin-only CRUD for historical KPI entries.
 *
 *   GET    /admin/kpi/manual-entries       — list (filterable)
 *   POST   /admin/kpi/manual-entries       — create
 *   PATCH  /admin/kpi/manual-entries/:id   — update
 *   DELETE /admin/kpi/manual-entries/:id   — remove
 *
 * Restricted to admin — bookkeeping-level changes that shift the
 * displayed KPI totals shouldn't be available to staff seats.
 */
@Controller('admin/kpi/manual-entries')
@Roles('admin')
export class KpiManualEntriesController {
  constructor(private readonly service: KpiManualEntriesService) {}

  @Get()
  list(
    @Query('fromMonth') fromMonth?: string,
    @Query('toMonth') toMonth?: string,
    @Query('category') category?: KpiManualCategory,
  ) {
    return this.service.list({ fromMonth, toMonth, category });
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateKpiManualEntryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateKpiManualEntryDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.delete(id);
  }
}
