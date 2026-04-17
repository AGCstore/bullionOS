// Pure-function carrier → internal-status mapping. No DB, no network.
import { describe, expect, it } from 'vitest';
import { _ups } from '../../src/integrations/adapters/ups.adapter';
import { _fedex } from '../../src/integrations/adapters/fedex.adapter';
import { _usps } from '../../src/integrations/adapters/usps.adapter';

describe('UPS status mapping', () => {
  it('maps delivered', () => {
    expect(_ups.mapUpsStatus('D')).toBe('delivered');
  });
  it('maps out-for-delivery', () => {
    expect(_ups.mapUpsStatus('O')).toBe('out_for_delivery');
  });
  it('maps in-transit (I and P)', () => {
    expect(_ups.mapUpsStatus('I')).toBe('in_transit');
    expect(_ups.mapUpsStatus('P')).toBe('in_transit');
  });
  it('maps exception', () => {
    expect(_ups.mapUpsStatus('X')).toBe('exception');
  });
  it('maps returned', () => {
    expect(_ups.mapUpsStatus('RS')).toBe('returned');
  });
  it('is case-insensitive', () => {
    expect(_ups.mapUpsStatus('d')).toBe('delivered');
  });
  it('falls back to label_created on unknown codes', () => {
    expect(_ups.mapUpsStatus('WAT')).toBe('label_created');
    expect(_ups.mapUpsStatus('')).toBe('label_created');
  });
});

describe('UPS date parsing', () => {
  it('parses YYYYMMDD', () => {
    const d = _ups.parseYmd('20260115');
    expect(d?.toISOString().startsWith('2026-01-15')).toBe(true);
  });
  it('rejects malformed', () => {
    expect(_ups.parseYmd('2026-01-15')).toBeNull();
    expect(_ups.parseYmd('badstring')).toBeNull();
  });

  it('parses GMT timestamps', () => {
    const d = _ups.parseUpsTimestamp('20260115', '143022');
    expect(d?.toISOString()).toBe('2026-01-15T14:30:22.000Z');
  });
});

describe('FedEx status mapping', () => {
  it('maps delivered / out-for-delivery / in-transit', () => {
    expect(_fedex.mapFedexStatus('DL')).toBe('delivered');
    expect(_fedex.mapFedexStatus('OD')).toBe('out_for_delivery');
    expect(_fedex.mapFedexStatus('IT')).toBe('in_transit');
    expect(_fedex.mapFedexStatus('AR')).toBe('in_transit');
    expect(_fedex.mapFedexStatus('DP')).toBe('in_transit');
  });
  it('maps exception (DE, CA)', () => {
    expect(_fedex.mapFedexStatus('DE')).toBe('exception');
    expect(_fedex.mapFedexStatus('CA')).toBe('exception');
  });
  it('falls back to label_created', () => {
    expect(_fedex.mapFedexStatus('XYZ')).toBe('label_created');
  });
});

describe('USPS status mapping', () => {
  it('maps common categories', () => {
    expect(_usps.mapUspsStatus('DELIVERED')).toBe('delivered');
    expect(_usps.mapUspsStatus('OUT_FOR_DELIVERY')).toBe('out_for_delivery');
    expect(_usps.mapUspsStatus('IN_TRANSIT')).toBe('in_transit');
    expect(_usps.mapUspsStatus('ACCEPTED')).toBe('in_transit');
  });
  it('maps exception (ALERT, FAILURE)', () => {
    expect(_usps.mapUspsStatus('ALERT')).toBe('exception');
    expect(_usps.mapUspsStatus('FAILURE')).toBe('exception');
  });
  it('falls back to label_created on unknown', () => {
    expect(_usps.mapUspsStatus('UNKNOWN')).toBe('label_created');
  });
});
