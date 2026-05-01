import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, PointerEvent, WheelEvent } from 'react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

const SAMPLE_LIMIT = 100_000;
const SUPABASE_PAGE_SIZE = 500;
const SUPABASE_RPC_PAGE_SIZE = 1000;
const PLOT_POINT_LIMIT = 10_000;
const BIG_SAMPLE_TARGET = 10_000;
const SAMPLES_TABLE = 'accel_batches';
const SAMPLE_INTERVAL_MS = 40;
const TIMELINE_CORRECTION_INTERVAL_MS = 2 * 60 * 1000;
const TIMELINE_DRIFT_THRESHOLD_MS = 2 * 1000;
const POLL_INTERVAL_MS = 12_000;

type AxisKey = 'x' | 'y' | 'z';
type Vector3 = { x: number; y: number; z: number };
type ViewerMode = 'big' | 'small';

interface AccelReading {
  ts: string;
  x: number;
  y: number;
  z: number;
  batteryPct: number | null;
  batteryVoltage: number | null;
}

interface AccelBatchRow {
  id: number;
  ts: string;
  battery_pct: number | null;
  x: number[];
  y: number[];
  z: number[];
  battery_voltage?: number | null;
  voltage?: number | null;
  vbat?: number | null;
  vbat_mv?: number | null;
  battery_mv?: number | null;
  battery_v?: number | null;
}

interface AxisPlotProps {
  label: string;
  stroke: string;
  timestamps: string[];
  values: number[];
  xDomain?: { start: string; end: string } | null;
  yDomain?: [number, number];
  yTicks?: number[];
  valueSuffix?: string;
  zoomRange: IndexRange | null;
  onZoomChange: (range: IndexRange | null) => void;
  calibrationRange?: { start: number; end: number } | null;
  onScrubIndexChange?: (index: number | null) => void;
  scrubEnabled?: boolean;
  secondarySeries?: {
    label: string;
    stroke: string;
    values: Array<number | null>;
    valueSuffix: string;
    usePrimaryDomain?: boolean;
  };
  showCalibrationRange?: boolean;
}

type IntervalUnit = 'minutes' | 'hours';
type IndexRange = { start: number; end: number };

interface BigSampleSummaryRow {
  bucket_index: number;
  ts: string;
  start_ts: string;
  end_ts: string;
  batch_count: number;
  sample_count: number;
  x_mean: number;
  y_mean: number;
  z_mean: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  z_min: number;
  z_max: number;
  battery_pct: number | null;
  total_batches: number;
}

function buildSupabaseBatchesUrl(startIso: string, endIso: string, offset: number) {
  if (!supabaseUrl) return null;

  const url = new URL(`/rest/v1/${SAMPLES_TABLE}`, supabaseUrl);
  url.searchParams.set('select', 'id,ts,battery_pct,x,y,z');
  url.searchParams.append('ts', `gte.${startIso}`);
  url.searchParams.append('ts', `lte.${endIso}`);
  url.searchParams.set('order', 'ts.asc');
  url.searchParams.set('limit', String(SUPABASE_PAGE_SIZE));
  url.searchParams.set('offset', String(offset));
  return url.toString();
}

function expandBatchRows(batches: AccelBatchRow[]): AccelReading[] {
  const readings: AccelReading[] = [];
  let nextSampleMs: number | null = null;
  let lastCorrectionCheckMs: number | null = null;

  batches.forEach((batch) => {
    const sampleCount = Math.min(batch.x.length, batch.y.length, batch.z.length);
    const observedBatchMs = new Date(batch.ts).getTime();
    if (!Number.isFinite(observedBatchMs) || sampleCount === 0) return;

    if (nextSampleMs === null) {
      nextSampleMs = observedBatchMs;
      lastCorrectionCheckMs = observedBatchMs;
    } else if (
      lastCorrectionCheckMs === null ||
      observedBatchMs - lastCorrectionCheckMs >= TIMELINE_CORRECTION_INTERVAL_MS
    ) {
      const driftMs = observedBatchMs - nextSampleMs;
      if (Math.abs(driftMs) > TIMELINE_DRIFT_THRESHOLD_MS) {
        nextSampleMs = observedBatchMs;
      }
      lastCorrectionCheckMs = observedBatchMs;
    }

    const batchStartMs = nextSampleMs;

    for (let index = 0; index < sampleCount; index += 1) {
      readings.push({
        ts: new Date(batchStartMs + index * SAMPLE_INTERVAL_MS).toISOString(),
        x: batch.x[index]!,
        y: batch.y[index]!,
        z: batch.z[index]!,
        batteryPct: batch.battery_pct,
        batteryVoltage: getBatteryVoltage(batch),
      });
    }

    nextSampleMs = batchStartMs + sampleCount * SAMPLE_INTERVAL_MS;
  });

  return readings;
}

async function fetchReadingsFromBatches(startIso: string, endIso: string) {
  const rows: AccelBatchRow[] = [];

  while (rows.length < SAMPLE_LIMIT) {
    const batchesUrl = buildSupabaseBatchesUrl(startIso, endIso, rows.length);
    if (!batchesUrl || !supabaseAnonKey) {
      throw new Error('Supabase URL or anon key is not configured.');
    }

    const response = await fetch(batchesUrl, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase returned ${response.status}`);
    }

    const page = (await response.json()) as AccelBatchRow[];
    rows.push(...page);

    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return expandBatchRows(rows).slice(0, SAMPLE_LIMIT);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  if (!supabaseAnonKey) {
    throw new Error('Supabase URL or anon key is not configured.');
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

async function fetchDownsampledFullHistory(target = BIG_SAMPLE_TARGET) {
  if (!supabaseUrl) throw new Error('Supabase URL is not configured.');
  if (!supabaseAnonKey) throw new Error('Supabase URL or anon key is not configured.');

  const url = new URL('/rest/v1/rpc/big_sample_summary', supabaseUrl);
  const rows: BigSampleSummaryRow[] = [];

  while (rows.length < target) {
    url.searchParams.set('limit', String(SUPABASE_RPC_PAGE_SIZE));
    url.searchParams.set('offset', String(rows.length));

    const page = await fetchJson<BigSampleSummaryRow[]>(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_points: target }),
    });

    rows.push(...page);
    if (page.length < SUPABASE_RPC_PAGE_SIZE) break;
  }

  const readings = rows.map((row) => ({
    ts: row.ts,
    x: row.x_mean,
    y: row.y_mean,
    z: row.z_mean,
    batteryPct: row.battery_pct,
    batteryVoltage: null,
  }));

  return {
    totalBatches: rows[0]?.total_batches ?? 0,
    selectedBatches: rows.length,
    readings,
  };
}

function compactNumber(value: number) {
  const normalizedValue = Math.abs(value) < 0.005 ? 0 : value;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(normalizedValue);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dot(a: Vector3, b: Vector3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function magnitude(vector: Vector3) {
  return Math.sqrt(dot(vector, vector));
}

function scale(vector: Vector3, scalar: number): Vector3 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function normalize(vector: Vector3): Vector3 {
  const length = magnitude(vector);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return scale(vector, 1 / length);
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function formatInterval(amount: string, unit: IntervalUnit) {
  const displayAmount = amount || '1';
  const parsedAmount = Number.parseFloat(displayAmount);
  const displayUnit = parsedAmount === 1 ? unit.slice(0, -1) : unit;
  return `${displayAmount} ${displayUnit}`;
}

function clampIndex(value: number, maxIndex: number) {
  return Math.min(Math.max(value, 0), Math.max(maxIndex, 0));
}

function downsampleSeries(timestamps: string[], values: number[], maxPoints: number) {
  if (values.length <= maxPoints) {
    return values.map((value, index) => ({
      timestamp: timestamps[index]!,
      value,
      index,
    }));
  }

  const step = Math.ceil(values.length / maxPoints);
  const sampled: Array<{ timestamp: string; value: number; index: number }> = [];
  for (let index = 0; index < values.length; index += step) {
    sampled.push({
      timestamp: timestamps[index]!,
      value: values[index]!,
      index,
    });
  }

  const last = values[values.length - 1];
  if (last !== undefined && sampled[sampled.length - 1]?.index !== values.length - 1) {
    sampled.push({
      timestamp: timestamps[timestamps.length - 1]!,
      value: last,
      index: values.length - 1,
    });
  }

  return sampled;
}

function downsampleNullableSeries(
  timestamps: string[],
  values: Array<number | null>,
  maxPoints: number,
) {
  if (values.length <= maxPoints) {
    return values.map((value, index) => ({
      timestamp: timestamps[index]!,
      value,
      index,
    }));
  }

  const step = Math.ceil(values.length / maxPoints);
  const sampled: Array<{ timestamp: string; value: number | null; index: number }> = [];
  for (let index = 0; index < values.length; index += step) {
    sampled.push({
      timestamp: timestamps[index]!,
      value: values[index] ?? null,
      index,
    });
  }

  const last = values[values.length - 1];
  if (sampled[sampled.length - 1]?.index !== values.length - 1) {
    sampled.push({
      timestamp: timestamps[timestamps.length - 1]!,
      value: last ?? null,
      index: values.length - 1,
    });
  }

  return sampled;
}

function getPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return '';

  return points
    .map((point, index) => {
      return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(' ');
}

function getSegmentedPath(points: Array<{ x: number; y: number } | null>) {
  let started = false;

  return points
    .map((point) => {
      if (!point) {
        started = false;
        return '';
      }

      const command = started ? 'L' : 'M';
      started = true;
      return `${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(' ');
}

function getNumericValues(values: Array<number | null>) {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function getTime(timestamps: string[], index: number) {
  return new Date(timestamps[index] ?? 0).getTime();
}

function getNearestIndexByTime(timestamps: string[], targetTime: number) {
  if (timestamps.length === 0) return 0;

  let bestIndex = 0;
  let bestDistance = Math.abs(getTime(timestamps, 0) - targetTime);
  for (let index = 1; index < timestamps.length; index++) {
    const distance = Math.abs(getTime(timestamps, index) - targetTime);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function getTicks(timestamps: string[], maxTicks = 4) {
  if (timestamps.length === 0) return [];
  if (timestamps.length === 1) {
    return [{ time: getTime(timestamps, 0), label: formatTime(timestamps[0]!) }];
  }

  const startTime = getTime(timestamps, 0);
  const endTime = getTime(timestamps, timestamps.length - 1);
  const tickCount = Math.min(maxTicks, Math.max(2, timestamps.length));
  const ticks: Array<{ time: number; label: string }> = [];
  const usedLabels = new Set<string>();

  for (let tickIndex = 0; tickIndex < tickCount; tickIndex++) {
    const time = startTime + ((endTime - startTime) * tickIndex) / (tickCount - 1);
    let label = formatTime(new Date(time).toISOString());
    if (usedLabels.has(label)) {
      const date = new Date(time);
      label = `${formatTime(date.toISOString())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
    }
    usedLabels.add(label);
    ticks.push({ time, label });
  }

  return ticks;
}

function buildPlotPoints(
  series: Array<{ timestamp: string; value: number; index: number }>,
  startTime: number,
  endTime: number,
  width: number,
  height: number,
  yDomain?: [number, number],
) {
  if (series.length === 0) return [];

  const values = series.map((point) => point.value);
  const min = yDomain ? yDomain[0] : Math.min(...values);
  const max = yDomain ? yDomain[1] : Math.max(...values);
  const span = max - min || 1;
  const timeSpan = endTime - startTime || 1;

  return series.map((point) => {
    const x = ((new Date(point.timestamp).getTime() - startTime) / timeSpan) * width;
    const y = height - ((point.value - min) / span) * height;
    return { x, y };
  });
}

function buildNullablePlotPoints(
  series: Array<{ timestamp: string; value: number | null; index: number }>,
  startTime: number,
  endTime: number,
  width: number,
  height: number,
  yDomain?: [number, number],
) {
  const values = getNumericValues(series.map((point) => point.value));
  if (series.length === 0 || values.length === 0) return [];

  const min = yDomain ? yDomain[0] : Math.min(...values);
  const max = yDomain ? yDomain[1] : Math.max(...values);
  const span = max - min || 1;
  const timeSpan = endTime - startTime || 1;

  return series.map((point) => {
    if (point.value === null || !Number.isFinite(point.value)) return null;

    const x = ((new Date(point.timestamp).getTime() - startTime) / timeSpan) * width;
    const y = height - ((point.value - min) / span) * height;
    return { x, y };
  });
}

function getBatteryVoltage(row: AccelBatchRow) {
  const rawVoltage =
    row.battery_voltage ??
    row.voltage ??
    row.vbat ??
    row.battery_v ??
    row.vbat_mv ??
    row.battery_mv ??
    null;

  if (rawVoltage === null) return null;
  const voltage = Number(rawVoltage);
  if (!Number.isFinite(voltage)) return null;
  return voltage > 20 ? voltage / 1000 : voltage;
}

function AxisPlot({
  label,
  stroke,
  timestamps,
  values,
  xDomain,
  yDomain,
  yTicks,
  valueSuffix = '',
  zoomRange,
  onZoomChange,
  calibrationRange,
  onScrubIndexChange,
  scrubEnabled = false,
  secondarySeries,
  showCalibrationRange = false,
}: AxisPlotProps) {
  const width = 760;
  const height = 120;
  const axisHeight = 28;
  const svgHeight = height + axisHeight;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragEndX, setDragEndX] = useState<number | null>(null);
  const maxIndex = Math.max(values.length - 1, 0);
  const visibleStart = zoomRange ? clampIndex(zoomRange.start, maxIndex) : 0;
  const visibleEnd = zoomRange ? clampIndex(zoomRange.end, maxIndex) : maxIndex;
  const domainStart = Math.min(visibleStart, visibleEnd);
  const domainEnd = Math.max(visibleStart, visibleEnd);
  const visibleTimestamps = timestamps.slice(domainStart, domainEnd + 1);
  const visibleValues = values.slice(domainStart, domainEnd + 1);
  const requestedStartTime = xDomain ? new Date(xDomain.start).getTime() : null;
  const requestedEndTime = xDomain ? new Date(xDomain.end).getTime() : null;
  const visibleStartTime = zoomRange
    ? visibleTimestamps.length
      ? getTime(visibleTimestamps, 0)
      : requestedStartTime ?? 0
    : requestedStartTime ?? (visibleTimestamps.length ? getTime(visibleTimestamps, 0) : 0);
  const visibleEndTime = zoomRange
    ? visibleTimestamps.length
      ? getTime(visibleTimestamps, visibleTimestamps.length - 1)
      : requestedEndTime ?? visibleStartTime
    : requestedEndTime ??
      (visibleTimestamps.length
        ? getTime(visibleTimestamps, visibleTimestamps.length - 1)
        : visibleStartTime);
  const visibleTimeSpan = visibleEndTime - visibleStartTime || 1;
  const sampledSeries = downsampleSeries(
    visibleTimestamps,
    visibleValues,
    PLOT_POINT_LIMIT,
  );
  const secondaryVisibleValues = secondarySeries
    ? secondarySeries.values.slice(domainStart, domainEnd + 1)
    : [];
  const sampledSecondarySeries =
    secondarySeries && secondaryVisibleValues.length
      ? downsampleNullableSeries(
          visibleTimestamps,
          secondaryVisibleValues,
          PLOT_POINT_LIMIT,
        )
      : [];
  const secondaryVisibleNumbers = getNumericValues(secondaryVisibleValues);
  const plottedValues = sampledSeries.map((point) => point.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const visibleMin = visibleValues.length ? Math.min(...visibleValues) : 0;
  const visibleMax = visibleValues.length ? Math.max(...visibleValues) : 0;
  const axisMin = yDomain ? yDomain[0] : min;
  const axisMax = yDomain ? yDomain[1] : max;
  const secondaryVisibleMin = secondaryVisibleNumbers.length
    ? Math.min(...secondaryVisibleNumbers)
    : null;
  const secondaryVisibleMax = secondaryVisibleNumbers.length
    ? Math.max(...secondaryVisibleNumbers)
    : null;
  const plotPoints = buildPlotPoints(
    sampledSeries,
    visibleStartTime,
    visibleEndTime,
    width,
    height,
    yDomain,
  );
  const secondaryPlotPoints = secondarySeries
    ? buildNullablePlotPoints(
        sampledSecondarySeries,
        visibleStartTime,
        visibleEndTime,
        width,
        height,
        secondarySeries.usePrimaryDomain ? yDomain : undefined,
      )
    : [];
  const path = getPath(plotPoints);
  const secondaryPath = getSegmentedPath(secondaryPlotPoints);
  const rangeStart = calibrationRange
    ? Math.min(calibrationRange.start, calibrationRange.end)
    : 0;
  const rangeEnd = calibrationRange
    ? Math.max(calibrationRange.start, calibrationRange.end)
    : 0;
  const selectionStartTime = timestamps[rangeStart]
    ? new Date(timestamps[rangeStart]!).getTime()
    : visibleStartTime;
  const selectionEndTime = timestamps[rangeEnd]
    ? new Date(timestamps[rangeEnd]!).getTime()
    : visibleEndTime;
  const rangeX =
    ((Math.max(selectionStartTime, visibleStartTime) - visibleStartTime) / visibleTimeSpan) *
    width;
  const rangeEndX =
    ((Math.min(selectionEndTime, visibleEndTime) - visibleStartTime) / visibleTimeSpan) *
    width;
  const rangeWidth = Math.max(rangeEndX - rangeX, 1);
  const ticks = getTicks(visibleTimestamps);
  const hoverPoint = hoverIndex === null ? null : sampledSeries[hoverIndex];
  const hoverSecondaryPoint =
    hoverIndex === null ? null : sampledSecondarySeries[hoverIndex] ?? null;
  const hoverCoords =
    hoverIndex === null || !plotPoints[hoverIndex] ? null : plotPoints[hoverIndex];
  const dragLeft =
    dragStartX === null || dragEndX === null ? null : Math.min(dragStartX, dragEndX);
  const dragWidth =
    dragStartX === null || dragEndX === null ? null : Math.abs(dragStartX - dragEndX);

  const indexFromClientX = useCallback(
    (clientX: number, element: SVGSVGElement) => {
      const rect = element.getBoundingClientRect();
      const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
      let bestIndex = 0;
      let bestDistance = Infinity;
      plotPoints.forEach((point, index) => {
        const distance = Math.abs(point.x - (x / rect.width) * width);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return bestIndex;
    },
    [plotPoints],
  );

  const sourceIndexFromClientX = useCallback(
    (clientX: number, element: SVGSVGElement) => {
      const rect = element.getBoundingClientRect();
      const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
      const ratio = rect.width === 0 ? 0 : x / rect.width;
      const targetTime = visibleStartTime + ratio * visibleTimeSpan;
      return domainStart + getNearestIndexByTime(visibleTimestamps, targetTime);
    },
    [domainStart, visibleStartTime, visibleTimeSpan, visibleTimestamps],
  );

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const nextHoverIndex = indexFromClientX(event.clientX, event.currentTarget);
    setHoverIndex(nextHoverIndex);
    if (scrubEnabled) {
      const sourceIndex = sampledSeries[nextHoverIndex]
        ? domainStart + sampledSeries[nextHoverIndex]!.index
        : null;
      onScrubIndexChange?.(sourceIndex);
    }
    if (dragStartX !== null) {
      const rect = event.currentTarget.getBoundingClientRect();
      setDragEndX(Math.min(Math.max(event.clientX - rect.left, 0), rect.width));
    }
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    setDragStartX(x);
    setDragEndX(x);
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (dragStartX === null || dragEndX === null) return;

    const dragDistance = Math.abs(dragEndX - dragStartX);
    if (dragDistance > 8) {
      const startClientX =
        event.currentTarget.getBoundingClientRect().left + Math.min(dragStartX, dragEndX);
      const endClientX =
        event.currentTarget.getBoundingClientRect().left + Math.max(dragStartX, dragEndX);
      const start = sourceIndexFromClientX(startClientX, event.currentTarget);
      const end = sourceIndexFromClientX(endClientX, event.currentTarget);
      if (end > start) onZoomChange({ start, end });
    }

    setDragStartX(null);
    setDragEndX(null);
  };

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    if (values.length < 2) return;
    event.preventDefault();

    const center = sourceIndexFromClientX(event.clientX, event.currentTarget);
    const currentSpan = domainEnd - domainStart || 1;
    const zoomFactor = event.deltaY > 0 ? 1.35 : 0.72;
    const nextSpan = Math.min(Math.max(Math.round(currentSpan * zoomFactor), 8), maxIndex);
    const ratio = currentSpan === 0 ? 0.5 : (center - domainStart) / currentSpan;
    const nextStart = clampIndex(Math.round(center - nextSpan * ratio), maxIndex);
    const nextEnd = clampIndex(nextStart + nextSpan, maxIndex);
    onZoomChange({ start: Math.min(nextStart, nextEnd), end: Math.max(nextStart, nextEnd) });
  };

  return (
    <section className="plot" aria-label={`${label} plot`}>
      <div className="plot__header">
        <h3>{label}</h3>
        <span>
          visible {compactNumber(visibleMin)} to {compactNumber(visibleMax)}
          {valueSuffix} / full {compactNumber(min)} to {compactNumber(max)}
          {valueSuffix}
          {yDomain && ` / axis ${compactNumber(axisMin)} to ${compactNumber(axisMax)}${valueSuffix}`}
          {secondarySeries &&
            (secondaryVisibleMin === null || secondaryVisibleMax === null
              ? ` / ${secondarySeries.label} overlay: unavailable`
              : ` / ${secondarySeries.label} overlay: ${compactNumber(secondaryVisibleMin)} to ${compactNumber(secondaryVisibleMax)}${secondarySeries.valueSuffix}`)}
          {values.length > plottedValues.length &&
            ` / plotted ${compactNumber(plottedValues.length)} of ${compactNumber(values.length)}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${svgHeight}`}
        role="img"
        onDoubleClick={() => onZoomChange(null)}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          setHoverIndex(null);
          if (scrubEnabled) onScrubIndexChange?.(null);
          setDragStartX(null);
          setDragEndX(null);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        {showCalibrationRange && calibrationRange && values.length > 0 && (
          <rect className="plot__selection" x={rangeX} y="0" width={rangeWidth} height={height} />
        )}
        {yTicks?.map((tick) => {
          const y = height - ((tick - axisMin) / (axisMax - axisMin || 1)) * height;
          return (
            <g key={`y-${tick}`}>
              <line className="plot__y-guide" x1="0" x2={width} y1={y} y2={y} />
              <text className="plot__y-label" x="4" y={Math.min(Math.max(y + 4, 10), height - 4)}>
                {compactNumber(tick)}
                {valueSuffix}
              </text>
            </g>
          );
        })}
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} />
        {path && <path d={path} stroke={stroke} />}
        {secondaryPath && <path d={secondaryPath} stroke={secondarySeries?.stroke} />}
        {hoverPoint && hoverCoords && (
          <>
            <line className="plot__cursor" x1={hoverCoords.x} x2={hoverCoords.x} y1="0" y2={height} />
            <circle className="plot__point" cx={hoverCoords.x} cy={hoverCoords.y} r="3.5" />
          </>
        )}
        {dragLeft !== null && dragWidth !== null && dragWidth > 0 && (
          <rect className="plot__drag" x={dragLeft} y="0" width={dragWidth} height={height} />
        )}
        <line className="plot__axis" x1="0" x2={width} y1={height} y2={height} />
        {ticks.map((tick) => {
          const x = ((tick.time - visibleStartTime) / visibleTimeSpan) * width;
          return (
            <g key={`${tick.time}-${tick.label}`}>
              <line className="plot__tick" x1={x} x2={x} y1={height} y2={height + 5} />
              <text x={x} y={height + 20} textAnchor={x === 0 ? 'start' : x === width ? 'end' : 'middle'}>
                {tick.label}
              </text>
            </g>
          );
        })}
        <text className="plot__axis-label plot__axis-label--left" x="4" y="12">
          {valueSuffix || label}
        </text>
        {secondarySeries && (
          <text className="plot__axis-label plot__axis-label--right" x={width - 4} y="12" textAnchor="end">
            {secondarySeries.label} overlay ({secondarySeries.valueSuffix})
          </text>
        )}
      </svg>
      <div className="plot__footer">
        <span>
          {visibleTimestamps[0] && visibleTimestamps[visibleTimestamps.length - 1]
            ? `${formatDateTime(new Date(visibleStartTime).toISOString())} to ${formatDateTime(new Date(visibleEndTime).toISOString())}`
            : xDomain
              ? `${formatDateTime(xDomain.start)} to ${formatDateTime(xDomain.end)}`
            : 'No samples loaded'}
        </span>
        <button type="button" onClick={() => onZoomChange(null)}>
          Reset zoom
        </button>
      </div>
      {hoverPoint && (
        <div className="plot__readout">
          sample {domainStart + hoverPoint.index + 1} / {formatDateTime(hoverPoint.timestamp)} /{' '}
          {compactNumber(hoverPoint.value)}
          {valueSuffix}
          {secondarySeries &&
            ` / ${secondarySeries.label}: ${
              hoverSecondaryPoint?.value === null || hoverSecondaryPoint?.value === undefined
                ? 'unavailable'
                : `${compactNumber(hoverSecondaryPoint.value)}${secondarySeries.valueSuffix}`
            }`}
        </div>
      )}
    </section>
  );
}

interface PendulumProps {
  angle: number | null;
  label: string;
  scrubEnabled?: boolean;
}

function Pendulum({ angle, label, scrubEnabled = false }: PendulumProps) {
  const displayAngle = angle ?? 0;
  const clampedAngle = Math.max(Math.min(displayAngle, 45), -45);
  const radians = (clampedAngle * Math.PI) / 180;
  const pivotX = 70;
  const pivotY = 28;
  const length = 82;
  const bobX = pivotX + Math.sin(radians) * length;
  const bobY = pivotY + Math.cos(radians) * length;

  return (
    <aside className="pendulum" aria-label={`${label} pendulum`}>
      <div className="pendulum__label">{label}</div>
      <svg viewBox="0 0 140 140" role="img">
        <line className="pendulum__vertical" x1={pivotX} x2={pivotX} y1={pivotY} y2={118} />
        <line className="pendulum__rod" x1={pivotX} x2={bobX} y1={pivotY} y2={bobY} />
        <circle className="pendulum__pivot" cx={pivotX} cy={pivotY} r="4" />
        <circle className="pendulum__bob" cx={bobX} cy={bobY} r="10" />
      </svg>
      <strong>{angle === null ? '--' : `${compactNumber(angle)}°`}</strong>
      <span>{scrubEnabled ? 'Scrub graph' : 'Mean zeroed'}</span>
    </aside>
  );
}

interface InclineRowProps {
  label: string;
  onZoomChange: (range: IndexRange | null) => void;
  onScrubIndexChange: (index: number | null) => void;
  pendulumAngle: number | null;
  scrubEnabled: boolean;
  stroke: string;
  timestamps: string[];
  values: number[];
  xDomain?: { start: string; end: string } | null;
  zoomRange: IndexRange | null;
}

function InclineRow({
  label,
  onZoomChange,
  onScrubIndexChange,
  pendulumAngle,
  scrubEnabled,
  stroke,
  timestamps,
  values,
  xDomain,
  zoomRange,
}: InclineRowProps) {
  return (
    <div className="incline-row">
      <AxisPlot
        label={`${label} (deg)`}
        stroke={stroke}
        timestamps={timestamps}
        values={values}
        xDomain={xDomain}
        zoomRange={zoomRange}
        onZoomChange={onZoomChange}
        scrubEnabled={scrubEnabled}
        onScrubIndexChange={onScrubIndexChange}
      />
      <Pendulum angle={pendulumAngle} label={label} scrubEnabled={scrubEnabled} />
    </div>
  );
}

function EmptyPlot({ label }: { label: string }) {
  return (
    <div className="plot plot--empty">
      <div className="plot__header">
        <h3>{label}</h3>
        <span>No data loaded</span>
      </div>
      <div className="plot__empty" aria-hidden="true" />
    </div>
  );
}

function BigSampleViewerShell() {
  const [bigReadings, setBigReadings] = useState<AccelReading[]>([]);
  const [loadingBig, setLoadingBig] = useState(false);
  const [bigError, setBigError] = useState<string | null>(null);
  const [totalBatches, setTotalBatches] = useState(0);
  const [selectedBatches, setSelectedBatches] = useState(0);

  const loadFullHistory = useCallback(async () => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setBigError('Supabase URL or anon key is not configured.');
      return;
    }

    setLoadingBig(true);
    setBigError(null);

    try {
      const result = await fetchDownsampledFullHistory();
      setBigReadings(result.readings);
      setTotalBatches(result.totalBatches);
      setSelectedBatches(result.selectedBatches);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setBigError(
        message.includes('big_sample_summary')
          ? 'Supabase RPC big_sample_summary is not installed yet. Run supabase_big_sample_summary.sql in the Supabase SQL Editor.'
          : message.includes('statement timeout')
            ? 'Supabase RPC big_sample_summary timed out. Re-run the latest supabase_big_sample_summary.sql version in the Supabase SQL Editor.'
          : 'Unable to load downsampled full-history data.',
      );
    } finally {
      setLoadingBig(false);
    }
  }, []);

  useEffect(() => {
    void loadFullHistory();
  }, [loadFullHistory]);

  const bigTimestamps = useMemo(
    () => bigReadings.map((reading) => reading.ts),
    [bigReadings],
  );
  const bigSeries = useMemo(
    () =>
      ({
        x: bigReadings.map((reading) => reading.x),
        y: bigReadings.map((reading) => reading.y),
        z: bigReadings.map((reading) => reading.z),
      }) satisfies Record<AxisKey, number[]>,
    [bigReadings],
  );
  const bigBatteryReadings = useMemo(
    () =>
      bigReadings.filter(
        (reading): reading is AccelReading & { batteryPct: number } =>
          reading.batteryPct !== null,
      ),
    [bigReadings],
  );
  const bigBatteryPercentSeries = useMemo(
    () => bigBatteryReadings.map((reading) => reading.batteryPct),
    [bigBatteryReadings],
  );
  const bigBatteryTimestamps = useMemo(
    () => bigBatteryReadings.map((reading) => reading.ts),
    [bigBatteryReadings],
  );
  const bigLatest = bigReadings[bigReadings.length - 1];
  const bigLatestBattery = bigBatteryReadings[bigBatteryReadings.length - 1];
  const bigPlotTimeDomain =
    bigReadings.length > 0
      ? { start: bigReadings[0]!.ts, end: bigReadings[bigReadings.length - 1]!.ts }
      : null;
  const bigBatteryPlotTimeDomain =
    bigBatteryTimestamps.length > 0
      ? {
          start: bigBatteryTimestamps[0]!,
          end: bigBatteryTimestamps[bigBatteryTimestamps.length - 1]!,
        }
      : null;

  return (
    <>
      <header className="hero">
        <h1>Broad Sample Data Viewer</h1>
      </header>

      <section className="raw-panel" aria-label="Full-history raw accelerometer data">
        <button className="raw-panel__toggle" type="button" aria-expanded="true">
          <span>Collapse raw accelerometer data</span>
          <span>full history</span>
        </button>

        <div className="raw-panel__body">
          <div className="toolbar">
            <div className="interval-form">
              <label>
                Show
                <select value="full-history" disabled>
                  <option value="full-history">entire database history</option>
                </select>
              </label>
              <label>
                Plot target
                <input type="number" value={BIG_SAMPLE_TARGET} disabled />
              </label>
              <button type="button" onClick={loadFullHistory} disabled={loadingBig}>
                {loadingBig ? 'Loading history...' : 'Reload history'}
              </button>
            </div>
          </div>

          <div className="calibration-note">
            Full-history charts show one averaged point from a strided subset of batches,
            capped near {BIG_SAMPLE_TARGET.toLocaleString()} points per chart.
          </div>

          {loadingBig && <p className="state">Loading downsampled full history...</p>}
          {bigError && <p className="state state--error">{bigError}</p>}

          <div className="summary">
            <span>Source table: {SAMPLES_TABLE}</span>
            <span>Window: full history</span>
            <span>Start: {bigPlotTimeDomain?.start ?? 'none'}</span>
            <span>End: {bigPlotTimeDomain?.end ?? 'none'}</span>
            <span>Total batches: {totalBatches.toLocaleString()}</span>
            <span>Loaded samples: {bigReadings.length.toLocaleString()}</span>
            <span>Selected batches: {selectedBatches.toLocaleString()}</span>
            <span>Latest sample: {bigLatest?.ts ?? 'none'}</span>
          </div>

          <div className="plots">
            {bigReadings.length > 0 ? (
              <>
                <AxisPlot
                  label="X acceleration"
                  stroke="#0f766e"
                  timestamps={bigTimestamps}
                  values={bigSeries.x}
                  xDomain={bigPlotTimeDomain}
                  zoomRange={null}
                  onZoomChange={() => undefined}
                />
                <AxisPlot
                  label="Y acceleration"
                  stroke="#b45309"
                  timestamps={bigTimestamps}
                  values={bigSeries.y}
                  xDomain={bigPlotTimeDomain}
                  zoomRange={null}
                  onZoomChange={() => undefined}
                />
                <AxisPlot
                  label="Z acceleration"
                  stroke="#1d4ed8"
                  timestamps={bigTimestamps}
                  values={bigSeries.z}
                  xDomain={bigPlotTimeDomain}
                  zoomRange={null}
                  onZoomChange={() => undefined}
                />
              </>
            ) : (
              <>
                <EmptyPlot label="X acceleration" />
                <EmptyPlot label="Y acceleration" />
                <EmptyPlot label="Z acceleration" />
              </>
            )}
          </div>
        </div>
      </section>

      <section className="raw-panel" aria-label="Full-history gravity-normalized acceleration data">
        <div className="raw-panel__header">
          <button className="raw-panel__toggle" type="button" aria-expanded="false">
            <span>Expand gravity-normalized acceleration</span>
            <span>0 samples</span>
          </button>
          <a
            className="whitepaper-link"
            href="/whitepapers/gravity-normalization.pdf"
            download="gravity-normalization.pdf"
          >
            Math PDF
          </a>
        </div>
      </section>

      <section className="raw-panel" aria-label="Full-history battery data">
        <button className="raw-panel__toggle" type="button" aria-expanded="true">
          <span>Collapse battery</span>
          <span>
            {bigBatteryPercentSeries.length
              ? `${bigBatteryPercentSeries.length.toLocaleString()} samples`
              : '0 samples'}
          </span>
        </button>
        <div className="raw-panel__body">
          <div className="summary">
            <span>Window: full history</span>
            <span>Percent samples: {bigBatteryPercentSeries.length.toLocaleString()}</span>
            <span>
              Latest battery:{' '}
              {bigLatestBattery?.batteryPct === null || bigLatestBattery?.batteryPct === undefined
                ? 'none'
                : `${compactNumber(bigLatestBattery.batteryPct)}%`}
            </span>
          </div>
          <div className="plots">
            {bigBatteryPercentSeries.length > 0 ? (
              <AxisPlot
                label="Battery"
                stroke="#0f766e"
                timestamps={bigBatteryTimestamps}
                values={bigBatteryPercentSeries}
                xDomain={bigBatteryPlotTimeDomain}
                yDomain={[0, 100]}
                yTicks={[0, 50, 100]}
                valueSuffix="%"
                zoomRange={null}
                onZoomChange={() => undefined}
              />
            ) : (
              <EmptyPlot label="Battery" />
            )}
          </div>
        </div>
      </section>
    </>
  );
}

export function App() {
  const [viewerMode, setViewerMode] = useState<ViewerMode>('big');
  const [expanded, setExpanded] = useState(true);
  const [relativeExpanded, setRelativeExpanded] = useState(false);
  const [inclinometerExpanded, setInclinometerExpanded] = useState(false);
  const [batteryExpanded, setBatteryExpanded] = useState(false);
  const [intervalAmount, setIntervalAmount] = useState('5');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('minutes');
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [windowEnd, setWindowEnd] = useState<string | null>(null);
  const [readings, setReadings] = useState<AccelReading[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalibrationData, setShowCalibrationData] = useState(false);
  const [selectingCalibration, setSelectingCalibration] = useState(false);
  const [calibrationStart, setCalibrationStart] = useState(0);
  const [calibrationEnd, setCalibrationEnd] = useState(0);
  const [rawZoomRange, setRawZoomRange] = useState<IndexRange | null>(null);
  const [normalizedZoomRange, setNormalizedZoomRange] = useState<IndexRange | null>(null);
  const [inclinometerZoomRange, setInclinometerZoomRange] = useState<IndexRange | null>(null);
  const [batteryZoomRange, setBatteryZoomRange] = useState<IndexRange | null>(null);
  const [inclinometerScrubEnabled, setInclinometerScrubEnabled] = useState(false);
  const [inclinometerScrubIndex, setInclinometerScrubIndex] = useState<number | null>(null);

  const fetchReadings = useCallback(async () => {
    const parsedAmount = Number.parseFloat(intervalAmount);
    const safeAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 1;
    const intervalMs =
      safeAmount * (intervalUnit === 'hours' ? 60 * 60 * 1000 : 60 * 1000);

    if (!supabaseUrl || !supabaseAnonKey) {
      setError('Supabase URL or anon key is not configured.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const end = new Date();
      const start = new Date(end.getTime() - intervalMs);
      const readingsFromSamples = await fetchReadingsFromBatches(
        start.toISOString(),
        end.toISOString(),
      );
      setReadings(readingsFromSamples);
      setCalibrationStart(0);
      setCalibrationEnd(Math.max(readingsFromSamples.length - 1, 0));
      setRawZoomRange(null);
      setNormalizedZoomRange(null);
      setInclinometerZoomRange(null);
      setBatteryZoomRange(null);
      setInclinometerScrubIndex(null);
      setWindowStart(start.toISOString());
      setWindowEnd(end.toISOString());
    } catch {
      setError('Unable to reach Supabase with the configured environment values.');
    } finally {
      setLoading(false);
    }
  }, [intervalAmount, intervalUnit]);

  useEffect(() => {
    if (viewerMode !== 'small') return;

    void fetchReadings();
    const intervalId = window.setInterval(() => {
      void fetchReadings();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [fetchReadings, viewerMode]);

  const handleIntervalSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void fetchReadings();
    },
    [fetchReadings],
  );

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      if (next && readings.length === 0 && !loading) {
        void fetchReadings();
      }
      return next;
    });
  }, [fetchReadings, loading, readings.length]);

  const toggleRelativeExpanded = useCallback(() => {
    setRelativeExpanded((current) => {
      const next = !current;
      if (next && readings.length === 0 && !loading) {
        void fetchReadings();
      }
      return next;
    });
  }, [fetchReadings, loading, readings.length]);

  const toggleInclinometerExpanded = useCallback(() => {
    setInclinometerExpanded((current) => {
      const next = !current;
      if (next && readings.length === 0 && !loading) {
        void fetchReadings();
      }
      return next;
    });
  }, [fetchReadings, loading, readings.length]);

  const toggleBatteryExpanded = useCallback(() => {
    setBatteryExpanded((current) => {
      const next = !current;
      if (next && readings.length === 0 && !loading) {
        void fetchReadings();
      }
      return next;
    });
  }, [fetchReadings, loading, readings.length]);

  const series = useMemo(
    () =>
      ({
        x: readings.map((reading) => reading.x),
        y: readings.map((reading) => reading.y),
        z: readings.map((reading) => reading.z),
      }) satisfies Record<AxisKey, number[]>,
    [readings],
  );
  const timestamps = useMemo(
    () => readings.map((reading) => reading.ts),
    [readings],
  );
  const batteryPercentSeries = useMemo(
    () => readings.map((reading) => reading.batteryPct ?? 0),
    [readings],
  );
  const batteryVoltageSeries = useMemo(
    () => readings.map((reading) => reading.batteryVoltage),
    [readings],
  );
  const voltageSampleCount = useMemo(
    () => getNumericValues(batteryVoltageSeries).length,
    [batteryVoltageSeries],
  );

  const latest = readings[readings.length - 1];
  const intervalLabel = formatInterval(intervalAmount, intervalUnit);
  const plotTimeDomain =
    windowStart && windowEnd ? { start: windowStart, end: windowEnd } : null;
  const maxCalibrationIndex = Math.max(readings.length - 1, 0);
  const normalizedCalibrationStart = clampIndex(
    Math.min(calibrationStart, calibrationEnd),
    maxCalibrationIndex,
  );
  const normalizedCalibrationEnd = clampIndex(
    Math.max(calibrationStart, calibrationEnd),
    maxCalibrationIndex,
  );
  const calibrationReadings = readings.slice(
    normalizedCalibrationStart,
    normalizedCalibrationEnd + 1,
  );
  const calibrationRange =
    readings.length > 0
      ? { start: normalizedCalibrationStart, end: normalizedCalibrationEnd }
      : null;
  const calibrationFirst = calibrationReadings[0];
  const calibrationLast = calibrationReadings[calibrationReadings.length - 1];

  const calibrationSeries = useMemo(
    () =>
      ({
        x: calibrationReadings.map((reading) => reading.x),
        y: calibrationReadings.map((reading) => reading.y),
        z: calibrationReadings.map((reading) => reading.z),
      }) satisfies Record<AxisKey, number[]>,
    [calibrationReadings],
  );

  const averages = useMemo(
    () => ({
      x: average(calibrationSeries.x),
      y: average(calibrationSeries.y),
      z: average(calibrationSeries.z),
    }),
    [calibrationSeries],
  );

  const gravityModel = useMemo(() => {
    const gravity = averages;
    const countsPerG = magnitude(gravity) || 1;
    const down = normalize(gravity);
    const sensorX = { x: 1, y: 0, z: 0 };
    const sensorY = { x: 0, y: 1, z: 0 };
    const projectedX = subtract(sensorX, scale(down, dot(sensorX, down)));
    const fallbackX = subtract(sensorY, scale(down, dot(sensorY, down)));
    const horizontalX =
      magnitude(projectedX) > 0.0001 ? normalize(projectedX) : normalize(fallbackX);
    const horizontalY = normalize(cross(down, horizontalX));

    return {
      countsPerG,
      down,
      horizontalX,
      horizontalY,
    };
  }, [averages]);

  const normalizedSeries = useMemo(
    () => ({
      x: readings.map((reading) =>
        dot(reading, gravityModel.horizontalX) / gravityModel.countsPerG,
      ),
      z: readings.map((reading) =>
        dot(reading, gravityModel.down) / gravityModel.countsPerG - 1,
      ),
    }),
    [readings, gravityModel],
  );

  const rawInclineSeries = useMemo(
    () => ({
      fromX: readings.map((reading) => {
        const vertical = dot(reading, gravityModel.down) / gravityModel.countsPerG;
        const transverse = dot(reading, gravityModel.horizontalY) / gravityModel.countsPerG;
        return radiansToDegrees(Math.atan2(transverse, vertical));
      }),
      fromY: readings.map((reading) => {
        const vertical = dot(reading, gravityModel.down) / gravityModel.countsPerG;
        const longitudinal = dot(reading, gravityModel.horizontalX) / gravityModel.countsPerG;
        return radiansToDegrees(Math.atan2(longitudinal, vertical));
      }),
    }),
    [readings, gravityModel],
  );
  const calibrationInclineFromX = rawInclineSeries.fromX.slice(
    normalizedCalibrationStart,
    normalizedCalibrationEnd + 1,
  );
  const calibrationInclineFromY = rawInclineSeries.fromY.slice(
    normalizedCalibrationStart,
    normalizedCalibrationEnd + 1,
  );
  const inclineBaseline = useMemo(
    () => ({
      fromX: average(calibrationInclineFromX),
      fromY: average(calibrationInclineFromY),
    }),
    [calibrationInclineFromX, calibrationInclineFromY],
  );
  const inclineSeries = useMemo(
    () => ({
      fromX: rawInclineSeries.fromX.map((value) => value - inclineBaseline.fromX),
      fromY: rawInclineSeries.fromY.map((value) => value - inclineBaseline.fromY),
    }),
    [rawInclineSeries, inclineBaseline],
  );
  const calibrationMeanTilt = useMemo(
    () => ({
      fromX: average(
        inclineSeries.fromX.slice(normalizedCalibrationStart, normalizedCalibrationEnd + 1),
      ),
      fromY: average(
        inclineSeries.fromY.slice(normalizedCalibrationStart, normalizedCalibrationEnd + 1),
      ),
    }),
    [inclineSeries, normalizedCalibrationStart, normalizedCalibrationEnd],
  );
  const scrubInclineFromX =
    inclinometerScrubIndex === null ? null : inclineSeries.fromX[inclinometerScrubIndex] ?? null;
  const scrubInclineFromY =
    inclinometerScrubIndex === null ? null : inclineSeries.fromY[inclinometerScrubIndex] ?? null;
  const scrubTimestamp =
    inclinometerScrubIndex === null ? null : timestamps[inclinometerScrubIndex] ?? null;

  return (
    <main className="page">
      <nav className="viewer-tabs" aria-label="Data viewers">
        <button
          type="button"
          className={`viewer-tabs__tab ${
            viewerMode === 'big' ? 'viewer-tabs__tab--active' : ''
          }`}
          aria-pressed={viewerMode === 'big'}
          onClick={() => setViewerMode('big')}
        >
          Broad Sample Data Viewer
        </button>
        <button
          type="button"
          className={`viewer-tabs__tab ${
            viewerMode === 'small' ? 'viewer-tabs__tab--active' : ''
          }`}
          aria-pressed={viewerMode === 'small'}
          onClick={() => setViewerMode('small')}
        >
          Detail Sample Data Viewer
        </button>
      </nav>

      {viewerMode === 'big' && <BigSampleViewerShell />}

      {viewerMode === 'small' && (
        <>
          <header className="hero">
            <h1>Detail Sample Data Viewer</h1>
          </header>

      <section className="raw-panel" aria-label="Raw accelerometer data">
        <button
          className="raw-panel__toggle"
          type="button"
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          <span>{expanded ? 'Collapse' : 'Expand'} raw accelerometer data</span>
          <span>{readings.length ? `${readings.length} samples` : 'collapsed'}</span>
        </button>

        {expanded && (
          <div className="raw-panel__body">
            <div className="toolbar">
              <form className="interval-form" onSubmit={handleIntervalSubmit}>
                <label>
                  Show last
                  <input
                    min="0.1"
                    step="0.1"
                    type="number"
                    value={intervalAmount}
                    onChange={(event) => setIntervalAmount(event.target.value)}
                  />
                </label>
                <select
                  value={intervalUnit}
                  onChange={(event) => setIntervalUnit(event.target.value as IntervalUnit)}
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
                <button type="submit">Apply interval</button>
              </form>
              <button
                type="button"
                aria-pressed={showCalibrationData}
                onClick={() => setShowCalibrationData((current) => !current)}
              >
                {showCalibrationData ? 'Hide' : 'Show'} data used for calibration
              </button>
              <button
                type="button"
                aria-pressed={selectingCalibration}
                onClick={() => {
                  setSelectingCalibration((current) => !current);
                  setShowCalibrationData(true);
                }}
              >
                {selectingCalibration ? 'Done selecting' : 'Select'} calibration data
              </button>
            </div>

            {loading && <p className="state">Loading recent samples...</p>}
            {error && <p className="state state--error">{error}</p>}

            <div className="calibration-note">
              Calibration window: samples {normalizedCalibrationStart + 1}-
              {normalizedCalibrationEnd + 1} of {readings.length || 0}
              {calibrationFirst && calibrationLast &&
                ` (${calibrationFirst.ts} to ${calibrationLast.ts})`}
            </div>

            {selectingCalibration && (
              <div className="calibration-controls">
                <label>
                  Start sample
                  <input
                    min="1"
                    max={Math.max(readings.length, 1)}
                    type="number"
                    value={normalizedCalibrationStart + 1}
                    onChange={(event) =>
                      setCalibrationStart(
                        clampIndex(Number(event.target.value) - 1, maxCalibrationIndex),
                      )
                    }
                  />
                </label>
                <label>
                  End sample
                  <input
                    min="1"
                    max={Math.max(readings.length, 1)}
                    type="number"
                    value={normalizedCalibrationEnd + 1}
                    onChange={(event) =>
                      setCalibrationEnd(
                        clampIndex(Number(event.target.value) - 1, maxCalibrationIndex),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setCalibrationStart(0);
                    setCalibrationEnd(maxCalibrationIndex);
                  }}
                >
                  Use full interval
                </button>
              </div>
            )}

            {!loading && (!error || readings.length > 0) && (
              <>
                <div className="summary">
                  <span>Source table: {SAMPLES_TABLE}</span>
                  <span>Window: last {intervalLabel}</span>
                  <span>Start: {windowStart ?? 'none'}</span>
                  <span>End: {windowEnd ?? 'none'}</span>
                  <span>Calibration samples: {calibrationReadings.length}</span>
                  <span>Latest sample: {latest?.ts ?? 'none'}</span>
                </div>

                <div className="plots">
                  <AxisPlot
                    label="X acceleration"
                    stroke="#0f766e"
                    timestamps={timestamps}
                    values={series.x}
                    xDomain={plotTimeDomain}
                    zoomRange={rawZoomRange}
                    onZoomChange={setRawZoomRange}
                    calibrationRange={calibrationRange}
                    showCalibrationRange={showCalibrationData}
                  />
                  <AxisPlot
                    label="Y acceleration"
                    stroke="#b45309"
                    timestamps={timestamps}
                    values={series.y}
                    xDomain={plotTimeDomain}
                    zoomRange={rawZoomRange}
                    onZoomChange={setRawZoomRange}
                    calibrationRange={calibrationRange}
                    showCalibrationRange={showCalibrationData}
                  />
                  <AxisPlot
                    label="Z acceleration"
                    stroke="#1d4ed8"
                    timestamps={timestamps}
                    values={series.z}
                    xDomain={plotTimeDomain}
                    zoomRange={rawZoomRange}
                    onZoomChange={setRawZoomRange}
                    calibrationRange={calibrationRange}
                    showCalibrationRange={showCalibrationData}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="raw-panel" aria-label="Gravity-normalized acceleration data">
        <div className="raw-panel__header">
          <button
            className="raw-panel__toggle"
            type="button"
            aria-expanded={relativeExpanded}
            onClick={toggleRelativeExpanded}
          >
            <span>
              {relativeExpanded ? 'Collapse' : 'Expand'} gravity-normalized acceleration
            </span>
            <span>{readings.length ? `${readings.length} samples` : 'collapsed'}</span>
          </button>
          <a
            className="whitepaper-link"
            href="/whitepapers/gravity-normalization.pdf"
            download="gravity-normalization.pdf"
          >
            Math PDF
          </a>
        </div>

        {relativeExpanded && (
          <div className="raw-panel__body">
            {loading && <p className="state">Loading recent samples...</p>}
            {error && <p className="state state--error">{error}</p>}

            <div className="calibration-note">
              Output uses the selected static calibration window to estimate down and scale
              counts into g. X is the sensor x-axis projected perpendicular to down; Z is
              vertical acceleration with 1g removed.
            </div>

            {!loading && (!error || readings.length > 0) && (
              <>
                <div className="summary">
                  <span>Window: last {intervalLabel}</span>
                  <span>Start: {windowStart ?? 'none'}</span>
                  <span>End: {windowEnd ?? 'none'}</span>
                  <span>Calibration samples: {calibrationReadings.length}</span>
                  <span>Counts per g: {compactNumber(gravityModel.countsPerG)}</span>
                  <span>
                    Down vector: {compactNumber(gravityModel.down.x)},{' '}
                    {compactNumber(gravityModel.down.y)},{' '}
                    {compactNumber(gravityModel.down.z)}
                  </span>
                  <span>Latest sample: {latest?.ts ?? 'none'}</span>
                </div>

                <div className="plots">
                  <AxisPlot
                    label="Relative X acceleration (g)"
                    stroke="#0f766e"
                    timestamps={timestamps}
                    values={normalizedSeries.x}
                    xDomain={plotTimeDomain}
                    zoomRange={normalizedZoomRange}
                    onZoomChange={setNormalizedZoomRange}
                  />
                  <AxisPlot
                    label="Relative Z acceleration (g)"
                    stroke="#1d4ed8"
                    timestamps={timestamps}
                    values={normalizedSeries.z}
                    xDomain={plotTimeDomain}
                    zoomRange={normalizedZoomRange}
                    onZoomChange={setNormalizedZoomRange}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="raw-panel" aria-label="Inclinometer data">
        <div className="raw-panel__header">
          <button
            className="raw-panel__toggle"
            type="button"
            aria-expanded={inclinometerExpanded}
            onClick={toggleInclinometerExpanded}
          >
            <span>{inclinometerExpanded ? 'Collapse' : 'Expand'} inclinometer</span>
            <span>{readings.length ? `${readings.length} samples` : 'collapsed'}</span>
          </button>
          <a
            className="whitepaper-link"
            href="/whitepapers/inclinometer.pdf"
            download="inclinometer.pdf"
          >
            Math PDF
          </a>
        </div>

        {inclinometerExpanded && (
          <div className="raw-panel__body">
            {loading && <p className="state">Loading recent samples...</p>}
            {error && <p className="state state--error">{error}</p>}

            <div className="calibration-note">
              Inclinometer output is zeroed to the selected calibration window. Enable
              scrub tilt, then move over either graph to drive the pendulums.
            </div>

            {!loading && (!error || readings.length > 0) && (
              <>
                <div className="toolbar">
                  <button
                    type="button"
                    aria-pressed={inclinometerScrubEnabled}
                    onClick={() => {
                      setInclinometerScrubEnabled((current) => !current);
                      setInclinometerScrubIndex(null);
                    }}
                  >
                    {inclinometerScrubEnabled ? 'Stop scrub tilt' : 'Scrub tilt'}
                  </button>
                </div>

                <div className="summary">
                  <span>Window: last {intervalLabel}</span>
                  <span>Start: {windowStart ?? 'none'}</span>
                  <span>End: {windowEnd ?? 'none'}</span>
                  <span>Calibration samples: {calibrationReadings.length}</span>
                  <span>Mean tilt X: {compactNumber(calibrationMeanTilt.fromX)}°</span>
                  <span>Mean tilt Y: {compactNumber(calibrationMeanTilt.fromY)}°</span>
                  <span>
                    Scrub sample:{' '}
                    {scrubTimestamp ? formatDateTime(scrubTimestamp) : 'not selected'}
                  </span>
                  <span>Latest sample: {latest?.ts ?? 'none'}</span>
                </div>

                <div className="plots">
                  <InclineRow
                    label="View from X"
                    onScrubIndexChange={setInclinometerScrubIndex}
                    stroke="#7c3aed"
                    pendulumAngle={scrubInclineFromX}
                    scrubEnabled={inclinometerScrubEnabled}
                    timestamps={timestamps}
                    values={inclineSeries.fromX}
                    xDomain={plotTimeDomain}
                    zoomRange={inclinometerZoomRange}
                    onZoomChange={setInclinometerZoomRange}
                  />
                  <InclineRow
                    label="View from Y"
                    onScrubIndexChange={setInclinometerScrubIndex}
                    stroke="#be123c"
                    pendulumAngle={scrubInclineFromY}
                    scrubEnabled={inclinometerScrubEnabled}
                    timestamps={timestamps}
                    values={inclineSeries.fromY}
                    xDomain={plotTimeDomain}
                    zoomRange={inclinometerZoomRange}
                    onZoomChange={setInclinometerZoomRange}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="raw-panel" aria-label="Battery data">
        <button
          className="raw-panel__toggle"
          type="button"
          aria-expanded={batteryExpanded}
          onClick={toggleBatteryExpanded}
        >
          <span>{batteryExpanded ? 'Collapse' : 'Expand'} battery</span>
          <span>{readings.length ? `${readings.length} samples` : 'collapsed'}</span>
        </button>

        {batteryExpanded && (
          <div className="raw-panel__body">
            {loading && <p className="state">Loading recent samples...</p>}
            {error && <p className="state state--error">{error}</p>}

            <div className="calibration-note">
              Battery percent comes from {SAMPLES_TABLE}. The right axis will draw
              voltage when the sample rows include a voltage field.
            </div>

            {!loading && (!error || readings.length > 0) && (
              <>
                <div className="summary">
                  <span>Window: last {intervalLabel}</span>
                  <span>Start: {windowStart ?? 'none'}</span>
                  <span>End: {windowEnd ?? 'none'}</span>
                  <span>Percent samples: {batteryPercentSeries.length}</span>
                  <span>
                    Voltage samples:{' '}
                    {voltageSampleCount ? voltageSampleCount : 'not available'}
                  </span>
                  <span>
                    Latest battery:{' '}
                    {latest?.batteryPct === null || latest?.batteryPct === undefined
                      ? 'none'
                      : `${compactNumber(latest.batteryPct)}%`}
                  </span>
                </div>

                <div className="plots">
                  <AxisPlot
                    label="Battery"
                    stroke="#0f766e"
                    timestamps={timestamps}
                    values={batteryPercentSeries}
                    xDomain={plotTimeDomain}
                    yDomain={[0, 100]}
                    yTicks={[0, 50, 100]}
                    valueSuffix="%"
                    zoomRange={batteryZoomRange}
                    onZoomChange={setBatteryZoomRange}
                    secondarySeries={{
                      label: 'Voltage',
                      stroke: '#7c3aed',
                      values: batteryVoltageSeries,
                      valueSuffix: 'V',
                      usePrimaryDomain: true,
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </section>
        </>
      )}
    </main>
  );
}
