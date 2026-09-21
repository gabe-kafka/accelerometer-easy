/**
 * Storm Index view models.
 *
 * TODO: forecast intensity — connect a forward weather feed (not wired).
 * TODO: historic log — connect a backwards wind/storm intensity source (not wired).
 * TODO: collection counts — connect per-node usable vs needed counts (not wired).
 * Leave numeric fields null until those feeds exist. Do not invent histories.
 */

/** One day in the forward 14-day storm-intensity strip. */
export interface ForecastDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Storm intensity for this day. Null until a forecast feed is connected. */
  intensity: number | null;
  /** Short feed label (watch, warning, etc.). Null until a forecast feed is connected. */
  label: string | null;
}

/** One backwards wind/storm intensity record. */
export interface HistoricStormRow {
  id: string;
  /** Observation time. Null on the layout-only example row. */
  observedAt: string | null;
  /** Peak wind. Null until the historic log feed is connected. */
  peakWind: number | null;
  /** Storm intensity. Null until the historic log feed is connected. */
  stormIntensity: number | null;
  /** True only for the muted layout example. Never treat as a recorded event. */
  example: boolean;
}

export type InstrumentSiteId = 'A' | 'B' | 'C';

/** One instrument site on PR Line 50200. */
export interface CollectionSite {
  id: InstrumentSiteId;
  name: string;
  /** What this site measures. */
  role: string;
  node: number;
  /** Usable samples collected. Null until the instrument feed is connected. */
  usable: number | null;
  /** Samples needed. Null until the requirement is connected. */
  needed: number | null;
}

/** Corridor collection rollup for PR Line 50200. */
export interface CorridorCollection {
  line: 'PR Line 50200';
  sites: readonly CollectionSite[];
  /** Overall percent collected, 0–100. Null until site counts exist. */
  overallPercent: number | null;
}
