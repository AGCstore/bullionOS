import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Twilio } from 'twilio';

export interface SendSmsInput {
  to: string; // E.164
  body: string; // keep short — 1 SMS = 160 chars
}

/**
 * SMS transport.
 *
 * When TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM are all set,
 * we use the Twilio SDK. Otherwise we log and no-op — symmetric to the
 * email dev transport, so every code path is exercised locally without
 * a live provider.
 *
 * Never throws from `send()` — a downstream SMS failure must not block
 * the business action (notification row is the source of truth).
 */
@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private mode: 'twilio' | 'dev' = 'dev';
  private client: Twilio | null = null;
  private from = '';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID', '');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN', '');
    const from = this.config.get<string>('TWILIO_FROM', '');
    if (sid && token && from) {
      // Dynamic import so the Twilio SDK (which pulls in request/http1.1)
      // isn't loaded in dev.
      const mod = (await import('twilio')) as unknown as {
        default: (sid: string, token: string) => Twilio;
      };
      this.client = mod.default(sid, token);
      this.from = from;
      this.mode = 'twilio';
      this.logger.log(`SMS transport: Twilio (from ${from})`);
    } else {
      this.mode = 'dev';
      this.logger.warn(
        'SMS transport: DEV (logging only). Set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM to send real SMS.',
      );
    }
  }

  async send(input: SendSmsInput): Promise<void> {
    if (!this.looksLikeE164(input.to)) {
      this.logger.warn(`Skipping SMS: ${input.to} is not E.164`);
      return;
    }

    try {
      if (this.mode === 'twilio' && this.client) {
        const msg = await this.client.messages.create({
          from: this.from,
          to: input.to,
          body: input.body.slice(0, 480), // ~3 SMS parts max
        });
        this.logger.log(`sms sent → ${input.to} sid=${msg.sid}`);
      } else {
        this.logger.log(`[dev sms] → ${input.to} · ${input.body.slice(0, 80)}`);
      }
    } catch (err) {
      this.logger.error(`sms send failed to ${input.to}: ${(err as Error).message}`);
    }
  }

  private looksLikeE164(s: string): boolean {
    return /^\+[1-9]\d{7,14}$/.test(s);
  }
}
