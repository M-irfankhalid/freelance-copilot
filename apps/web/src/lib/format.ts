/**
 * Display formatters shared across the app. All money is USD for now; the
 * currency handling will widen once platforms return their own currencies.
 */
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatMoney(amount: number): string {
  return usd.format(amount);
}
