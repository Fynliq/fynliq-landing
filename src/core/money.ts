/** Formatting helpers. No arithmetic decisions live here. */

const whole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** `$2,555`. Whole dollars — the beta never shows cents. */
export function formatUSD(amount: number): string {
  return whole.format(Math.round(amount));
}

/**
 * `$5,562.84`, `$7,395`. Cents only when the document printed them: for a
 * tuition estimate the exact figure is the point.
 */
export function formatCents(amount: number, alwaysCents = false): string {
  const rounded = Math.round(amount * 100) / 100;
  return `${rounded < 0 ? '\u2212' : ''}$${Math.abs(rounded).toLocaleString('en-US', { minimumFractionDigits: alwaysCents || !Number.isInteger(rounded) ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** `−$6,400`. Uses a real minus sign, not a hyphen. */
export function formatDeduction(amount: number): string {
  return `\u2212${whole.format(Math.round(Math.abs(amount)))}`;
}

/** `$500–5,000`. Ranges keep one dollar sign, like the award documents do. */
export function formatRange(low: number, high: number): string {
  return `${whole.format(low)}\u2013${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(high)}`;
}
