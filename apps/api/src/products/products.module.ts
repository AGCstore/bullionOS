import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { AdminProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PricingModule],
  controllers: [AdminProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
