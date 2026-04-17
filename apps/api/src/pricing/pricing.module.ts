import { Module } from '@nestjs/common';
import { MetalsModule } from '../metals/metals.module';
import { PricingController } from './pricing.controller';
import { PricingRulesService } from './pricing-rules.service';
import { PricingService } from './pricing.service';

@Module({
  imports: [MetalsModule],
  controllers: [PricingController],
  providers: [PricingService, PricingRulesService],
  exports: [PricingService, PricingRulesService],
})
export class PricingModule {}
