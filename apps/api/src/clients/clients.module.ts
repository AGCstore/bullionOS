import { Module } from '@nestjs/common';
import { AdminClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [AdminClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
