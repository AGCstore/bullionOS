import { Controller, Get, Inject } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Public } from '../common/decorators/public.decorator';
import { KYSELY } from '../db/database.module';
import type { DB } from '../db/types';

@Controller()
export class HealthController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  @Public()
  @Get('health')
  async health() {
    let db: 'ok' | 'down' = 'ok';
    try {
      await sql`select 1`.execute(this.db);
    } catch {
      db = 'down';
    }
    return { status: db === 'ok' ? 'ok' : 'degraded', db, time: new Date().toISOString() };
  }
}
