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
import { PricingService } from '../pricing/pricing.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('admin/products')
@Roles('admin', 'staff')
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly pricing: PricingService,
  ) {}

  @Get()
  list() {
    return this.products.list();
  }

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.products.getById(id);
  }

  /** Live price preview for a single product (uses current spot). */
  @Get(':id/quote')
  quote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('quantity') quantity?: string,
  ) {
    const q = quantity ? Math.max(1, Math.floor(Number(quantity))) : 1;
    return this.pricing.quote(id, q);
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.products.delete(id);
  }
}
