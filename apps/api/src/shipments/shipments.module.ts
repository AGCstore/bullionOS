import { Module } from '@nestjs/common';
import {
  AdminShipmentsController,
  ClientShipmentsController,
} from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  controllers: [AdminShipmentsController, ClientShipmentsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
