import { createSign, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

/**
 * DocuSign client.
 *
 * Auth: JWT Grant (server-to-server). We sign a JWT with the admin-provided
 * RSA private key, exchange for an OAuth access token, then call the REST API.
 *
 * Scope kept small for now — `testConnection()` + envelope-creation stub.
 * Full workflow (template fill, webhook verification) lands once the admin
 * has successfully tested credentials in the UI.
 */
@Injectable()
export class DocuSignService {
  private readonly logger = new Logger(DocuSignService.name);
  // Cache the OAuth token until ~1 minute before expiry.
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly integrations: IntegrationsService) {}

  async isAvailable(): Promise<boolean> {
    return this.integrations.isAvailable('docusign');
  }

  /** Exchange the RSA key + user_id for an OAuth token. Throws on failure. */
  async getAccessToken(): Promise<string> {
    const creds = await this.integrations.getCredentials('docusign');
    if (!creds) throw new Error('DocuSign is not configured');

    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }

    const { user_id, integration_key, private_key_pem, base_path } = creds;
    const authHost = base_path.includes('demo') ? 'account-d.docusign.com' : 'account.docusign.com';

    // Build + sign the JWT (RS256). otplib/passport-jwt aren't set up for
    // asymmetric signing here, so we use node crypto directly — keeps deps lean.
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: integration_key,
      sub: user_id,
      aud: authHost,
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation',
    };
    const encode = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const signingInput = `${encode(header)}.${encode(payload)}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer
      .sign(private_key_pem)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const assertion = `${signingInput}.${signature}`;

    const res = await fetch(`https://${authHost}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DocuSign token ${res.status}: ${text.slice(0, 400)}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const token = await this.getAccessToken();
      return { ok: true, message: `Token obtained (${token.length} chars)` };
    } catch (err) {
      return { ok: false, message: (err as Error).message.slice(0, 500) };
    }
  }

  /**
   * Verify a Connect webhook signature. DocuSign sends `X-DocuSign-Signature-1`
   * as base64 HMAC-SHA256 over the raw request body using the shared secret.
   */
  async verifyWebhook(rawBody: Buffer, signatureHeader: string): Promise<boolean> {
    const creds = await this.integrations.getCredentials('docusign');
    if (!creds?.webhook_secret) return false;
    const expected = createHmac('sha256', creds.webhook_secret).update(rawBody).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signatureHeader, 'base64');
    } catch {
      return false;
    }
    if (received.length !== expected.length) return false;
    return timingSafeEqual(received, expected);
  }

  // Placeholder for envelope creation. Shape will be finalized once the admin
  // has tested credentials and uploaded the first template.
  async createEnvelopeFromTemplate(args: {
    template_id: string;
    signer_email: string;
    signer_name: string;
    tab_values: Record<string, string>;
  }): Promise<{ envelope_id: string }> {
    const creds = await this.integrations.getCredentials('docusign');
    if (!creds) throw new Error('DocuSign is not configured');
    const token = await this.getAccessToken();

    const url = `${creds.base_path}/v2.1/accounts/${creds.account_id}/envelopes`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateId: args.template_id,
        status: 'sent',
        templateRoles: [
          {
            email: args.signer_email,
            name: args.signer_name,
            roleName: 'Signer',
            tabs: {
              textTabs: Object.entries(args.tab_values).map(([tabLabel, value]) => ({
                tabLabel,
                value,
              })),
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`DocuSign envelope ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const body = (await res.json()) as { envelopeId: string };
    return { envelope_id: body.envelopeId };
  }
}
