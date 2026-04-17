import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

export const KYSELY = Symbol('KYSELY');

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          max: config.get<number>('DATABASE_POOL_MAX', 20),
          // Fail fast on unreachable DB during boot.
          connectionTimeoutMillis: 5_000,
        });

        // Surface errors instead of silently dying.
        pool.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error('[pg pool error]', err);
        });

        return new Kysely<DB>({
          dialect: new PostgresDialect({ pool }),
          log: config.get('NODE_ENV') === 'development' ? ['error'] : ['error'],
        });
      },
    },
  ],
  exports: [KYSELY],
})
export class DatabaseModule {}
