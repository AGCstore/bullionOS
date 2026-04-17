import Decimal from 'decimal.js';

// Configure once: 34 significant digits is safe for all money math in this app,
// and ROUND_HALF_EVEN (banker's rounding) is the least biased rounding mode.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

/** Safely parse numerics coming from Postgres (strings) or user input (numbers). */
export function d(value: Decimal.Value | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  return new Decimal(value);
}

/** Serialize for DB storage: full 8-decimal precision. */
export function toDbString(v: Decimal.Value): string {
  return d(v).toFixed(8);
}

/** Customer-facing rounding to cents. */
export function toDisplay(v: Decimal.Value, dp = 2): string {
  return d(v).toFixed(dp);
}

export { Decimal };
