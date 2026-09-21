import type {
  CollectionSite,
  CorridorCollection,
  ForecastDay,
  HistoricStormRow,
} from './stormIndexTypes';

/** Shown in the 2-week forecast panel until a weather feed is connected. */
export const FORECAST_EMPTY_MESSAGE = 'Forecast feed not connected yet.';

/**
 * Empty forward window. Dates are structural only — intensity stays null.
 * TODO: replace with a forecast feed. Do not hard-code storm intensities.
 */
export function emptyForecastWindow(start: Date, days = 14): ForecastDay[] {
  const windowStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(windowStart);
    date.setDate(windowStart.getDate() + offset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return {
      date: `${year}-${month}-${day}`,
      intensity: null,
      label: null,
    };
  });
}

export const HISTORIC_LOG_HEADERS = ['When', 'Peak wind', 'Storm intensity', 'Notes'] as const;

/**
 * Single muted layout row. Not a recorded storm.
 * TODO: replace this list with the historic wind/storm log. Do not add fake events.
 */
export const HISTORIC_EXAMPLE_ROW: HistoricStormRow = {
  id: 'example',
  observedAt: null,
  peakWind: null,
  stormIntensity: null,
  example: true,
};

const COLLECTION_SITES: readonly CollectionSite[] = [
  {
    id: 'A',
    name: 'Site A',
    role: 'ridge / topo wind',
    node: 2,
    usable: null,
    needed: null,
  },
  {
    id: 'B',
    name: 'Site B',
    role: 'soil type 1',
    node: 1,
    usable: null,
    needed: null,
  },
  {
    id: 'C',
    name: 'Site C',
    role: 'soil type 2',
    node: 3,
    usable: null,
    needed: null,
  },
];

/**
 * PR Line 50200 collection scaffold.
 * TODO: fill usable/needed from the instrument feed, then derive overallPercent.
 */
export const CORRIDOR_COLLECTION: CorridorCollection = {
  line: 'PR Line 50200',
  sites: COLLECTION_SITES,
  overallPercent: null,
};

/** "— / —" when either count is still unconnected. */
export function formatUsableNeeded(usable: number | null, needed: number | null) {
  const usableLabel = usable === null ? '—' : String(usable);
  const neededLabel = needed === null ? '—' : String(needed);
  return `${usableLabel} / ${neededLabel}`;
}

/** 0–1 fill for the ring/bar. Stays empty while either count is null. */
export function collectionRatio(usable: number | null, needed: number | null) {
  if (usable === null || needed === null || needed <= 0) return 0;
  return Math.min(usable / needed, 1);
}
