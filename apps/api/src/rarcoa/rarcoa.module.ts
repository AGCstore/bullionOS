import { Module } from '@nestjs/common';
import { RarcoaController } from './rarcoa.controller';
import { RarcoaService } from './rarcoa.service';
import { RarcoaParserService } from './rarcoa-parser.service';

/**
 * RARCOA supplier pricing module. Self-contained — no cross-module
 * dependencies beyond the global Database + Crypto (via KYSELY).
 * Phase 2 will add an email listener; that'll likely live here too.
 */
@Module({
  controllers: [RarcoaController],
  providers: [RarcoaService, RarcoaParserService],
  exports: [RarcoaService],
})
export class RarcoaModule {}
