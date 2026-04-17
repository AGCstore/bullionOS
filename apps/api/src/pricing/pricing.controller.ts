import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';
import { PricingRulesService } from './pricing-rules.service';

@Controller('admin/pricing-rules')
@Roles('admin', 'staff')
export class PricingController {
  constructor(private readonly rules: PricingRulesService) {}

  @Get()
  list() {
    return this.rules.list();
  }

  @Post()
  @HttpCode(201)
  upsert(@Body() dto: UpsertPricingRuleDto) {
    return this.rules.upsert(dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async deactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.rules.deactivate(id);
  }
}
