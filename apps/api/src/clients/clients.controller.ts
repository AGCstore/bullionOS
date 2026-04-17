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
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/upsert-client.dto';

@Controller('admin/clients')
@Roles('admin', 'staff')
export class AdminClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(
    @Query('q') search?: string,
    @Query('client_type') client_type?: 'retail' | 'wholesaler',
  ) {
    return this.clients.list(search, client_type ? { client_type } : {});
  }

  @Get(':id')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.clients.getById(id);
  }

  @Get(':id/timeline')
  timeline(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.clients.getTimeline(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clients.update(id, dto);
  }

  // Portal-admin actions are admin-only (not staff). Password reset reveals a
  // temp password; restrict that to the most trusted role.
  @Post(':id/enable-portal')
  @Roles('admin')
  enablePortal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.clients.enablePortal(id, user.id);
  }

  @Post(':id/disable-portal')
  @Roles('admin')
  @HttpCode(204)
  async disablePortal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.clients.disablePortal(id, user.id);
  }

  @Post(':id/reset-password')
  @Roles('admin')
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.clients.resetPassword(id, user.id);
  }
}
