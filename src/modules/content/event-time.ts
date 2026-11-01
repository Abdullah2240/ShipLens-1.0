// Pure conversion between the editor's Pakistan wall-clock values and stored UTC instants.
// Pakistan Standard Time is UTC+5 all year (no daylight saving), so a fixed offset is exact.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

// A `datetime-local` value: YYYY-MM-DDTHH:mm, with optional seconds from some browsers.
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// An ISO-8601 instant with an explicit zone.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/**
 * '2026-11-15T14:30' (Pakistan time) -> '2026-11-15T09:30:00.000Z'.
 * Empty, malformed or impossible values (month 13, 30 February, 24:00) give null.
 */
export function pktLocalToUtcIso(local: string): string | null {
  const match = typeof local === 'string' ? LOCAL_RE.exec(local) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((part) => (part === undefined ? 0 : parseInt(part, 10))) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (wallClock.getUTCMonth() !== month - 1 || wallClock.getUTCDate() !== day) return null;

  return new Date(wallClock.getTime() - PKT_OFFSET_MS).toISOString();
}

/**
 * '2026-11-15T09:30:00.000Z' -> '2026-11-15T14:30' (Pakistan time, minute precision),
 * ready for a `datetime-local` input. Null, empty or unreadable values give ''.
 */
export function utcIsoToPktLocal(iso: string | null): string {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return '';
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return '';
  const pkt = new Date(instant + PKT_OFFSET_MS);
  return (
    `${pad(pkt.getUTCFullYear(), 4)}-${pad(pkt.getUTCMonth() + 1)}-${pad(pkt.getUTCDate())}` +
    `T${pad(pkt.getUTCHours())}:${pad(pkt.getUTCMinutes())}`
  );
}
