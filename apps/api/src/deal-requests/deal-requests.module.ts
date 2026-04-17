import { Module } from '@nestjs/common';
import {
  AdminDealRequestsController,
  ClientDealRequestsController,
} from './deal-requests.controller';
import { DealRequestsService } from './deal-requests.service';
import { DealRequestPhotosController } from './photos.controller';
import { DealRequestPhotosService } from './photos.service';

@Module({
  controllers: [
    ClientDealRequestsController,
    AdminDealRequestsController,
    DealRequestPhotosController,
  ],
  providers: [DealRequestsService, DealRequestPhotosService],
  exports: [DealRequestsService, DealRequestPhotosService],
})
export class DealRequestsModule {}
