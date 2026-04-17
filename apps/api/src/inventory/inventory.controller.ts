import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryService } from './inventory.service';

@Controller()
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('admin/inventory')
  @Roles('admin', 'staff')
  list() {
    return this.service.list();
  }

  @Patch('admin/inventory/:productId')
  @Roles('admin', 'staff')
  adjust(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: AdjustInventoryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.adjust(productId, dto.delta, user.id, dto.notes);
  }

  /** Client-portal view (requires auth, role=client). */
  @Get('client/in-stock')
  @Roles('client')
  clientInStock() {
    return this.service.inStock();
  }

  /** Public shop feed — no auth. */
  @Public()
  @Get('public/in-stock')
  publicInStock() {
    return this.service.inStock();
  }
}
