import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import {
  AdminQuotesController,
  ClientQuotesController,
} from './price-quotes.controller';
import { PriceQuotesService } from './price-quotes.service';

@Module({
  imports: [PricingModule],
  controllers: [ClientQuotesController, AdminQuotesController],
  providers: [PriceQuotesService],
  exports: [PriceQuotesService],
})
export class PriceQuotesModule {}
