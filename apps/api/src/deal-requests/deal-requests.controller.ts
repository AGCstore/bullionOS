import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { DealRequestStatus } from '../db/types';
import { CreateDealRequestDto } from './dto/create-deal-request.dto';
import { RespondDealRequestDto } from './dto/respond-deal-request.dto';
import { DealRequestsService } from './deal-requests.service';

@Controller('client/deal-requests')
@Roles('client')
export class ClientDealRequestsController {
  constructor(private readonly service: DealRequestsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateDealRequestDto) {
    return this.service.createForClient(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Query('status') status?: DealRequestStatus) {
    return this.service.listForClient(user.id, status);
  }
}

@Controller('admin/deal-requests')
@Roles('admin', 'staff')
export class AdminDealRequestsController {
  constructor(private readonly service: DealRequestsService) {}

  @Get()
  list(@Query('status') status?: DealRequestStatus) {
    return this.service.listAll(status);
  }

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getById(id);
  }

  @Patch(':id/respond')
  respond(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RespondDealRequestDto,
  ) {
    return this.service.respond(id, dto.decision, user.id, dto.message);
  }
}
