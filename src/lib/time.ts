/**
 * Time formatters, Eastern-time-aware.
 * Uses America/New_York so EDT/EST transitions are handled automatically.
 * The timeZoneName: 'short' option produces "EDT" in summer and "EST" in winter.
 */

const ET_DATETIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

const ET_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const ET_DATETIME_SHORT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

export function formatET(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return ET_DATETIME.format(d);
}

export function formatTimeET(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return ET_TIME.format(d);
}

export function formatDateTimeShortET(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return ET_DATETIME_SHORT.format(d);
}

export function formatAge(isoDate: string): string {
  const ageMs = Date.now() - new Date(isoDate).getTime();
  const secs = Math.floor(ageMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = ageMs / 3_600_000;
  if (hrs < 24) return `${hrs.toFixed(1)} hr ago`;
  const days = hrs / 24;
  return `${days.toFixed(1)} days ago`;
}

/**
 * Start of the current field test. Hard-coded per user spec (7 PM Eastern,
 * 2026-04-21). All live-dashboard queries filter ts >= this moment.
 * 7 PM EDT (UTC-4 during DST) = 23:00 UTC.
 */
export const COLLECTION_START_ISO = '2026-04-21T23:00:00Z';
