import { encode } from 'uqr';

/** Quiet zone in modules on every side; scanners need at least four. */
export const QR_QUIET_ZONE = 4;

export type QrProps = {
  value: string;
  /** Accessible name, read instead of the drawing. */
  label: string;
  /** Rendered width and height in CSS pixels. */
  size?: number;
};

/** One SVG path of unit squares, offset by the quiet zone. */
export function qrModulesPath(value: string): { modules: number; d: string } {
  const { data, size } = encode(value, { ecc: 'M', border: 0 });
  const parts: string[] = [];
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h1v1h-1z`);
    });
  });
  return { modules: size + QR_QUIET_ZONE * 2, d: parts.join('') };
}

/**
 * Server-rendered QR code. Dark modules on a white field in every theme, because phone
 * cameras need the contrast; no script and no injected markup.
 */
export function Qr({ value, label, size = 176 }: QrProps) {
  const { modules, d } = qrModulesPath(value);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="block h-auto max-w-full"
    >
      <rect width={modules} height={modules} fill="#fff" />
      <path d={d} fill="#111" />
    </svg>
  );
}
