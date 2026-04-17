import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { Observable, defer, from, interval, startWith, switchMap } from 'rxjs';
import { Public } from '../common/decorators/public.decorator';
import { MetalsService } from './metals.service';

/**
 * Server-Sent Events stream of spot prices.
 *
 * Why SSE over WebSockets:
 *  - One-way (server → client) is all we need for prices.
 *  - Plain HTTP — works through every reverse proxy/CDN without sticky sessions.
 *  - No extra dependencies.
 *
 * Cadence: emit on connect, then every 15s. Backend metals service caches
 * upstream for 30s, so half the emissions are cheap Redis reads.
 */
@Controller('sse')
export class MetalsSseController {
  constructor(private readonly metals: MetalsService) {}

  @Public()
  @Sse('prices')
  stream(): Observable<MessageEvent> {
    return interval(15_000).pipe(
      startWith(0),
      switchMap(() =>
        defer(() =>
          from(
            this.metals
              .getSpot()
              .then((data): MessageEvent => ({ type: 'price', data })),
          ),
        ),
      ),
    );
  }
}
