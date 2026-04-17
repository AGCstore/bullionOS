import { Module } from '@nestjs/common';
import { MetalsController } from './metals.controller';
import { MetalsSseController } from './metals-sse.controller';
import { MetalsService } from './metals.service';

@Module({
  controllers: [MetalsController, MetalsSseController],
  providers: [MetalsService],
  exports: [MetalsService],
})
export class MetalsModule {}
