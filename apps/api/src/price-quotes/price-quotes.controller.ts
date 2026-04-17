import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { PriceQuotesService } from './price-quotes.service';

@Controller('client/quotes')
@Roles('client')
export class ClientQuotesController {
  constructor(private readonly service: PriceQuotesService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateQuoteDto) {
    return this.service.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.listForClientUser(user.id);
  }
}

@Controller('admin/quotes')
@Roles('admin', 'staff')
export class AdminQuotesController {
  constructor(private readonly service: PriceQuotesService) {}

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getById(id);
  }

  @Post(':id/convert')
  @HttpCode(201)
  convert(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.convertToInvoice(id, user.id);
  }
}
