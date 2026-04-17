import { Module } from '@nestjs/common';
import { MetalsModule } from '../metals/metals.module';
import { PricingModule } from '../pricing/pricing.module';
import { ProductsModule } from '../products/products.module';
import { PublicController } from './public.controller';

@Module({
  imports: [ProductsModule, PricingModule, MetalsModule],
  controllers: [PublicController],
})
export class PublicModule {}
