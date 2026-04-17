import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

export class RedisCleanup implements OnModuleDestroy {
  constructor(private readonly client: Redis) {}
  async onModuleDestroy() {
    await this.client.quit();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Redis(config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: 3,
          // Avoid noisy unhandled errors on boot if Redis isn't up yet.
          lazyConnect: false,
          enableReadyCheck: true,
        });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
