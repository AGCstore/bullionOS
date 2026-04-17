import { Module } from '@nestjs/common';
import { MetalsModule } from '../metals/metals.module';
import { PricingModule } from '../pricing/pricing.module';
import { ProductsModule } from '../products/products.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { ClientPortalController } from './client-portal.controller';

@Module({
  imports: [ProductsModule, PricingModule, MetalsModule, InvoicesModule],
  controllers: [ClientPortalController],
})
export class ClientPortalModule {}
