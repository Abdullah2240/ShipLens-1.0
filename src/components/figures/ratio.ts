// Ratios and chart scales for money figures. Amounts are decimal strings converted to
// BigInt minor units; only the final small basis-point integer becomes a number.
import { toMinor } from '@/platform/money';

const WHOLE = 10000n;
const MIN_SCALE = 100n;

/** Share of `part` in `total` in basis points (0..10000), floored. A total of 0 gives 0. */
export function basisPoints(part: string, total: string): number {
  const whole = toMinor(total);
  const share = toMinor(part);
  if (whole <= 0n || share <= 0n) return 0;
  const bp = (share * WHOLE) / whole;
  return Number(bp > WHOLE ? WHOLE : bp);
}

/** Same as basisPoints, on minor units already converted. */
export function basisPointsMinor(part: bigint, total: bigint): number {
  if (total <= 0n || part <= 0n) return 0;
  const bp = (part * WHOLE) / total;
  return Number(bp > WHOLE ? WHOLE : bp);
}

/** 8332 -> '83.32%'. Integer arithmetic only. */
export function bpToPercent(bp: number): string {
  const safe = Math.max(0, Math.min(10000, Math.trunc(bp)));
  return `${Math.trunc(safe / 100)}.${String(safe % 100).padStart(2, '0')}%`;
}

/** Smallest 1, 2, 2.5 or 5 x 10^n (minor units) that is >= max. At least 100 (PKR 1). */
export function niceCeiling(maxMinor: bigint): bigint {
  if (maxMinor <= MIN_SCALE) return MIN_SCALE;
  let power = 1n;
  while (power * 10n < maxMinor) power *= 10n;
  // Here power >= 100 and power < max <= 10 * power, so 2.5 x power is a whole number.
  for (const candidate of [power * 2n, (power * 5n) / 2n, power * 5n]) {
    if (candidate >= maxMinor) return candidate;
  }
  return power * 10n;
}

function leadingCount(ceiling: bigint): number {
  const digits = ceiling.toString();
  // 25 x 10^n and 5 x 10^n split into fifths, 1 and 2 x 10^n into quarters.
  return digits.startsWith('25') || digits.startsWith('5') ? 5 : 4;
}

/** Evenly spaced values from 0 to niceCeiling(max). Default count keeps labels round. */
export function ticks(maxMinor: bigint, count?: number): bigint[] {
  const ceiling = niceCeiling(maxMinor);
  const steps = BigInt(Math.max(1, Math.trunc(count ?? leadingCount(ceiling))));
  const out: bigint[] = [];
  for (let i = 0n; i <= steps; i += 1n) out.push((ceiling * i) / steps);
  return out;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function scaled(minor: bigint, unit: bigint, suffix: string): string {
  const whole = minor / unit;
  const fraction = (((minor % unit) * 100n) / unit).toString().padStart(2, '0').replace(/0+$/, '');
  return `${group(whole.toString())}${fraction ? `.${fraction}` : ''}${suffix}`;
}

/** Short axis label in rupees with Latin digits: 150000000n -> '1.5M', 5000000n -> '50k'. */
export function compactMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const sign = negative ? '-' : '';
  if (abs >= 100_000_000n) return sign + scaled(abs, 100_000_000n, 'M');
  if (abs >= 100_000n) return sign + scaled(abs, 100_000n, 'k');
  const rupees = abs / 100n;
  const paisa = abs % 100n;
  return `${sign}${group(rupees.toString())}${paisa === 0n ? '' : `.${paisa.toString().padStart(2, '0')}`}`;
}
