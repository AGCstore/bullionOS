import { Controller, Get } from '@nestjs/common';
import { MetalsService } from './metals.service';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';

@Controller('metals')
export class MetalsController {
  constructor(private readonly metals: MetalsService) {}

  /** Live spot prices. Auth-gated so we don't expose our API quota publicly. */
  @Get('spot')
  async spot(@CurrentUser() _user: RequestUser) {
    return this.metals.getSpot();
  }
}
