import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { AdminProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsImportService } from './products-import.service';

@Module({
  imports: [PricingModule],
  controllers: [AdminProductsController],
  providers: [ProductsService, ProductsImportService],
  exports: [ProductsService],
})
export class ProductsModule {}
