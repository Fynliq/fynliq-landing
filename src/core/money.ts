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
