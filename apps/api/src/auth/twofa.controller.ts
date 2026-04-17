import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { TwoFactorService } from './twofa.service';

class VerifyDto {
  @IsString()
  @Length(6, 20)
  code!: string;
}

@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twofa: TwoFactorService) {}

  @Post('enroll')
  @HttpCode(201)
  enroll(@CurrentUser() user: RequestUser) {
    return this.twofa.enroll(user.id);
  }

  @Post('activate')
  @HttpCode(204)
  async activate(@CurrentUser() user: RequestUser, @Body() dto: VerifyDto) {
    await this.twofa.activate(user.id, dto.code);
  }

  @Delete('')
  @HttpCode(204)
  async disable(@CurrentUser() user: RequestUser) {
    await this.twofa.disable(user.id);
  }
}
