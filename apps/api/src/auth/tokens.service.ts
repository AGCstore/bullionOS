import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Kysely } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, UserRole } from '../db/types';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  typ: 'refresh';
}

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  access_expires_in: number; // seconds
}

/**
 * Tokens service — single source of truth for minting, rotating, and revoking.
 *
 * Design:
 *  - Access token: short-lived JWT (default 15m), stateless.
 *  - Refresh token: JWT containing a `jti`; we persist only SHA-256(token) keyed by jti row.
 *    Rotation on every use: old token is marked revoked and `replaced_by` the new row id.
 *    Reuse of a revoked refresh token triggers a full session revoke for that user.
 */
@Injectable()
export class TokensService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private parseTtlToMs(ttl: string): number {
    // Supports: s, m, h, d (e.g. "15m", "30d")
    const m = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!m) throw new Error(`Invalid TTL format: ${ttl}`);
    const n = Number(m[1]);
    const mult = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
    return n * mult;
  }

  async issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    ctx: { ip?: string | null; userAgent?: string | null },
  ): Promise<IssuedTokens> {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d');
    const refreshTtlMs = this.parseTtlToMs(refreshTtl);

    const accessPayload: AccessTokenPayload = { sub: userId, email, role, typ: 'access' };
    const access_token = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl,
      algorithm: 'HS256',
    });

    // Pre-generate the refresh row id so we can put it in the JWT jti.
    const jti = randomBytes(16).toString('hex');
    const refreshPayload: RefreshTokenPayload = { sub: userId, jti, typ: 'refresh' };
    const refresh_token = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshTtl,
      algorithm: 'HS256',
    });

    await this.db
      .insertInto('refresh_tokens')
      .values({
        user_id: userId,
        token_hash: this.sha256(refresh_token),
        user_agent: ctx.userAgent ?? null,
        ip_address: ctx.ip ?? null,
        expires_at: new Date(Date.now() + refreshTtlMs),
      })
      .execute();

    return {
      access_token,
      refresh_token,
      access_expires_in: Math.floor(this.parseTtlToMs(accessTtl) / 1000),
    };
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      algorithms: ['HS256'],
    });
    if (payload.typ !== 'refresh') throw new Error('Wrong token type');
    return payload;
  }

  /**
   * Rotate: consume an existing refresh token and issue a fresh pair.
   * Detects reuse: if the token is already revoked, revoke ALL sessions for the user.
   */
  async rotate(
    oldToken: string,
    user: { id: string; email: string; role: UserRole },
    ctx: { ip?: string | null; userAgent?: string | null },
  ): Promise<IssuedTokens> {
    const tokenHash = this.sha256(oldToken);
    const existing = await this.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();

    if (!existing) {
      // Unknown token — treat as compromise; revoke everything for this user.
      await this.revokeAllForUser(user.id);
      throw new Error('Refresh token not recognized');
    }
    if (existing.revoked_at) {
      // Replay of a rotated token → compromise.
      await this.revokeAllForUser(user.id);
      throw new Error('Refresh token reuse detected');
    }
    if (existing.expires_at.getTime() < Date.now()) {
      throw new Error('Refresh token expired');
    }
    if (existing.user_id !== user.id) {
      throw new Error('Token/user mismatch');
    }

    const newTokens = await this.issueTokens(user.id, user.email, user.role, ctx);

    // Find the newly inserted row so we can link replaced_by.
    const newRow = await this.db
      .selectFrom('refresh_tokens')
      .select('id')
      .where('token_hash', '=', this.sha256(newTokens.refresh_token))
      .executeTakeFirstOrThrow();

    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date(), replaced_by: newRow.id })
      .where('id', '=', existing.id)
      .execute();

    return newTokens;
  }

  async revoke(token: string): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', this.sha256(token))
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
