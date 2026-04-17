import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { MessagesService } from './messages.service';

class PostMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

@Controller('deal-requests/:id/messages')
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.list(id, user.id, user.role);
  }

  @Post()
  @HttpCode(201)
  post(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PostMessageDto,
  ) {
    return this.service.post(id, { id: user.id, role: user.role }, dto.body);
  }
}
