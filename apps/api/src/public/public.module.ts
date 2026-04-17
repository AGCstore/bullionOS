import { Global, Module } from '@nestjs/common';
import { MetalsModule } from '../metals/metals.module';
import { PricingModule } from '../pricing/pricing.module';
import { ProductsModule } from '../products/products.module';
import { PublicController } from './public.controller';
import { PublicCacheService } from './public-cache.service';

/**
 * Global so ProductsService / PricingRulesService / InventoryService can
 * invalidate the public cache without circular-import ceremony.
 */
@Global()
@Module({
  imports: [ProductsModule, PricingModule, MetalsModule],
  controllers: [PublicController],
  providers: [PublicCacheService],
  exports: [PublicCacheService],
})
export class PublicModule {}
