import { useMemo, useState, useRef, useCallback } from 'react';
import type { Data, Layout, PlotSelectionEvent } from 'plotly.js';
import { Plot } from '../lib/plotly';
import { BASE_LAYOUT, BASE_CONFIG, THEME } from '../lib/plotlyTheme';
import { useLiveReadings } from '../hooks/useLiveReadings';
import { useLiveStatus } from '../hooks/useLiveStatus';
import { AccelReading } from '../types';
import { formatDateTimeShortET } from '../lib/time';
import './LiveCharts.css';

/* ── baseline helpers ─────────────────────────────────────── */

function meanBaseline(readings: AccelReading[]): { x: number; y: number; z: number } {
  if (readings.length === 0) return { x: 0, y: 0, z: 0 };
  const n = readings.length;
  return {
    x: readings.reduce((s, r) => s + r.x_raw, 0) / n,
    y: readings.reduce((s, r) => s + r.y_raw, 0) / n,
    z: readings.reduce((s, r) => s + r.z_raw, 0) / n,
  };
}

const AUTO_WINDOW = 50;
function autoBaseline(readings: AccelReading[]) {
  return meanBaseline(readings.slice(-AUTO_WINDOW));
}

/* ── Plotly helpers ──────────────────────────────────────── */

/**
 * Convert an ISO-8601 UTC timestamp to a number that, when Plotly formats it
 * as UTC on the axis, reads as Eastern wall-clock time. We read the ET
 * date/time components via Intl.DateTimeFormat (deterministic across browsers
 * and DST-aware) and repack them as if they were UTC.
 */
const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false,
});

function etAxisValue(iso: string): number {
  const d = new Date(iso);
  const parts = ET_PARTS.formatToParts(d);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  // ET wall clock expressed as if it were UTC
  const etAsUtcMs = Date.UTC(
    get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'),
  );
  // Real ET offset (ms the real UTC is ahead of ET). For EDT: +14400000.
  const etOffsetMs = d.getTime() - etAsUtcMs;
  // Browser's own offset (ms it is behind UTC). For ET browser in EDT: +14400000.
  const browserOffsetMs = d.getTimezoneOffset() * 60_000;
  // Plotly renders tick labels in LOCAL browser time. Shift the x-value so
  // local-time rendering produces ET wall clock regardless of where the user
  // is: result = actual_ms + (browser_offset − et_offset).
  return d.getTime() + browserOffsetMs - etOffsetMs;
}

/* ── component ────────────────────────────────────────────── */

export function LiveCharts() {
  const { readings, loading, lastUpdated } = useLiveReadings();
  const { rows: statusRows } = useLiveStatus();

  const [calStart, setCalStart] = useState<number | null>(null);
  const [calEnd, setCalEnd] = useState<number | null>(null);
  const isManual = calStart !== null && calEnd !== null;

  // Pin auto-baseline to the first computation so it doesn't drift with new data
  const autoBaselineRef = useRef<{ x: number; y: number; z: number } | null>(null);
  if (!autoBaselineRef.current && readings.length > 0) {
    autoBaselineRef.current = autoBaseline(readings);
  }

  const baseline = useMemo(() => {
    if (isManual) {
      const lo = Math.min(calStart, calEnd);
      const hi = Math.max(calStart, calEnd);
      return meanBaseline(readings.slice(lo, hi + 1));
    }
    return autoBaselineRef.current ?? { x: 0, y: 0, z: 0 };
  }, [readings, calStart, calEnd, isManual]);

  const countsPerG = Math.sqrt(baseline.x ** 2 + baseline.y ** 2 + baseline.z ** 2) || 1;

  /**
   * Split a time-series at gaps larger than GAP_BREAK_MS by inserting null,
   * which Plotly uses to break the line (no interpolation across the gap).
   * Each burst of 100 samples at 25 Hz is ~4 s; POST cadence is 5 min; so any
   * gap > 30 s is clearly a between-batch gap.
   */
  const GAP_BREAK_MS = 30_000;

  const breakGapsX = useMemo(() => {
    const src = readings.map((r) => etAxisValue(r.ts));
    const src_unshifted = readings.map((r) => new Date(r.ts).getTime());
    const out: (number | null)[] = [];
    for (let i = 0; i < src.length; i++) {
      if (i > 0 && src_unshifted[i]! - src_unshifted[i - 1]! > GAP_BREAK_MS) out.push(null);
      out.push(src[i]!);
    }
    return out;
  }, [readings]);

  const breakGapsXStatus = useMemo(() => {
    const src = statusRows.map((r) => etAxisValue(r.ts));
    const src_unshifted = statusRows.map((r) => new Date(r.ts).getTime());
    const out: (number | null)[] = [];
    for (let i = 0; i < src.length; i++) {
      if (i > 0 && src_unshifted[i]! - src_unshifted[i - 1]! > GAP_BREAK_MS) out.push(null);
      out.push(src[i]!);
    }
    return out;
  }, [statusRows]);

  // Helper to align a y-series with the gap-broken x by inserting null at same positions
  function injectGaps<T>(values: T[], gapIndices: number[]): (T | null)[] {
    const out: (T | null)[] = [];
    let g = 0;
    for (let i = 0; i < values.length; i++) {
      if (g < gapIndices.length && gapIndices[g] === i) {
        out.push(null);
        g++;
      }
      out.push(values[i]!);
    }
    return out;
  }

  const gapIndices = useMemo(() => {
    const idx: number[] = [];
    for (let i = 1; i < readings.length; i++) {
      const prev = new Date(readings[i - 1]!.ts).getTime();
      const curr = new Date(readings[i]!.ts).getTime();
      if (curr - prev > GAP_BREAK_MS) idx.push(i);
    }
    return idx;
  }, [readings]);

  // Aliases for legacy naming used below.
  const xAxis = breakGapsX;
  const xStatus = breakGapsXStatus;

  const magnitudes = useMemo(
    () => injectGaps(
      readings.map((r) => Math.sqrt(r.x_raw ** 2 + r.y_raw ** 2 + r.z_raw ** 2)),
      gapIndices,
    ),
    [readings, gapIndices],
  );

  const relativeData = useMemo(() => {
    return {
      dx: injectGaps(readings.map((r) => ((r.x_raw - baseline.x) / countsPerG) * 1000), gapIndices),
      dy: injectGaps(readings.map((r) => ((r.y_raw - baseline.y) / countsPerG) * 1000), gapIndices),
      dz: injectGaps(readings.map((r) => ((r.z_raw - baseline.z) / countsPerG) * 1000), gapIndices),
    };
  }, [readings, baseline, countsPerG, gapIndices]);

  const xRawForY = readings.map((r) => r.x_raw);
  const yRawForY = readings.map((r) => r.y_raw);
  const zRawForY = readings.map((r) => r.z_raw);
  const batteryForY = readings.map((r) => r.battery_v);
  const xRawGapped = useMemo(() => injectGaps(xRawForY, gapIndices), [readings, gapIndices]);
  const yRawGapped = useMemo(() => injectGaps(yRawForY, gapIndices), [readings, gapIndices]);
  const zRawGapped = useMemo(() => injectGaps(zRawForY, gapIndices), [readings, gapIndices]);
  const batteryGapped = useMemo(() => injectGaps(batteryForY, gapIndices), [readings, gapIndices]);

  /* ── selection handler for calibration (raw chart) ── */
  const handleSelected = useCallback(
    (event: Readonly<PlotSelectionEvent> | undefined) => {
      const xr = event?.range?.x;
      if (!xr || xr.length < 2) return;
      const x0 = xr[0];
      const x1 = xr[1];
      if (x0 == null || x1 == null) return;
      const toMs = (v: number | string | Date): number =>
        typeof v === 'number' ? v : new Date(v as string | Date).getTime();
      const lo = Math.min(toMs(x0), toMs(x1));
      const hi = Math.max(toMs(x0), toMs(x1));
      let startIdx = -1;
      let endIdx = -1;
      for (let i = 0; i < xAxis.length; i++) {
        const v = xAxis[i];
        if (v == null) continue;
        if (startIdx === -1 && v >= lo) startIdx = i;
        if (v <= hi) endIdx = i;
      }
      if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
        setCalStart(startIdx);
        setCalEnd(endIdx);
      }
    },
    [xAxis],
  );

  const handleReset = useCallback(() => {
    setCalStart(null);
    setCalEnd(null);
  }, []);

  if (loading) {
    return (
      <div className="live-charts">
        <h2 className="live-charts__heading">Charts</h2>
        <p className="live-charts__loading">Loading…</p>
      </div>
    );
  }

  /* ── Layouts ── */
  const xAxisCommon = {
    ...BASE_LAYOUT.xaxis,
    type: 'date' as const,
    tickformat: '%H:%M:%S',
  };

  // Highlight shape for committed calibration window.
  const calShape =
    isManual && calStart !== null && calEnd !== null
      ? [
          {
            type: 'rect' as const,
            xref: 'x' as const,
            yref: 'paper' as const,
            x0: xAxis[Math.min(calStart, calEnd)],
            x1: xAxis[Math.max(calStart, calEnd)],
            y0: 0,
            y1: 1,
            fillcolor: THEME.blue,
            opacity: 0.15,
            line: { width: 0 },
          },
        ]
      : [];

  const rawLayout: Partial<Layout> = {
    ...BASE_LAYOUT,
    height: 260,
    xaxis: { ...xAxisCommon },
    yaxis: { ...BASE_LAYOUT.yaxis, title: { text: 'counts', font: { color: THEME.muted } } },
    dragmode: 'select',
    selectdirection: 'h',
    shapes: calShape,
  };

  const relLayout: Partial<Layout> = {
    ...BASE_LAYOUT,
    height: 320,
    xaxis: { ...xAxisCommon },
    yaxis: { ...BASE_LAYOUT.yaxis, title: { text: 'mg', font: { color: THEME.muted } } },
    dragmode: 'zoom',
    shapes: calShape,
  };

  const battLayout: Partial<Layout> = {
    ...BASE_LAYOUT,
    height: 260,
    xaxis: { ...xAxisCommon },
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      title: { text: 'V', font: { color: THEME.muted } },
      range: [3, 4.5],
    },
    dragmode: 'zoom',
  };

  const chgLayout: Partial<Layout> = {
    ...BASE_LAYOUT,
    height: 260,
    xaxis: { ...xAxisCommon },
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      title: { text: 'IBAT (mA)', font: { color: THEME.muted } },
    },
    yaxis2: {
      ...BASE_LAYOUT.yaxis,
      title: { text: 'VBUS', font: { color: THEME.muted } },
      overlaying: 'y',
      side: 'right',
      range: [-0.1, 1.1],
      tickvals: [0, 1],
    },
    dragmode: 'zoom',
  };

  /* ── Traces ── */
  const rawData: Data[] = [
    { x: xAxis, y: xRawGapped, name: 'X', type: 'scatter', mode: 'lines', line: { color: THEME.red, width: 1 }, connectgaps: false },
    { x: xAxis, y: yRawGapped, name: 'Y', type: 'scatter', mode: 'lines', line: { color: THEME.green, width: 1 }, connectgaps: false },
    { x: xAxis, y: zRawGapped, name: 'Z', type: 'scatter', mode: 'lines', line: { color: THEME.blue, width: 1 }, connectgaps: false },
    { x: xAxis, y: magnitudes, name: '|a|', type: 'scatter', mode: 'lines', line: { color: THEME.amber, width: 1.5, dash: 'dash' }, connectgaps: false },
  ];

  const relData: Data[] = [
    { x: xAxis, y: relativeData.dx, name: 'dX', type: 'scatter', mode: 'lines', line: { color: THEME.red, width: 1.5 }, connectgaps: false },
    { x: xAxis, y: relativeData.dy, name: 'dY', type: 'scatter', mode: 'lines', line: { color: THEME.green, width: 1.5 }, connectgaps: false },
    { x: xAxis, y: relativeData.dz, name: 'dZ', type: 'scatter', mode: 'lines', line: { color: THEME.blue, width: 1.5 }, connectgaps: false },
  ];

  const battData: Data[] = [
    { x: xAxis, y: batteryGapped, name: 'V', type: 'scatter', mode: 'lines', line: { color: THEME.amber, width: 1.5 }, connectgaps: false },
  ];

  const chgData: Data[] = [
    {
      x: xStatus,
      y: statusRows.map((r) => r.ibat_ma ?? 0),
      name: 'IBAT',
      type: 'scatter',
      mode: 'lines+markers',
      line: { color: THEME.green, width: 1.5, shape: 'hv' },
      marker: { size: 4, color: THEME.green },
    },
    {
      x: xStatus,
      y: statusRows.map((r) => (r.vbus_present ? 1 : 0)),
      name: 'VBUS',
      yaxis: 'y2',
      type: 'scatter',
      mode: 'lines',
      line: { color: THEME.blue, width: 1, dash: 'dot', shape: 'hv' },
    },
  ];

  return (
    <div className="live-charts">
      <div className="live-charts__header">
        <h2 className="live-charts__heading">Charts</h2>
        <span className="live-charts__status">
          {lastUpdated && (
            <>
              <span className="live-charts__pulse" />
              Last updated {formatDateTimeShortET(lastUpdated.toISOString())}
            </>
          )}
        </span>
      </div>

      {/* ── RAW OVERVIEW / CALIBRATION SELECTOR ── */}
      <section className="live-charts__section">
        <h3 className="live-charts__label">
          RAW DATA — BOX-SELECT A WINDOW TO SET CALIBRATION (TOOLBAR: ZOOM, PAN, AUTOSCALE, PNG)
        </h3>
        <div className="live-charts__chart-wrapper">
          <Plot
            data={rawData}
            layout={rawLayout}
            config={BASE_CONFIG}
            onSelected={handleSelected}
            useResizeHandler
            style={{ width: '100%' }}
          />
        </div>
      </section>

      {/* ── CALIBRATION INFO ── */}
      <div className="live-charts__cal-bar">
        <span className="live-charts__cal-mode">
          {isManual ? 'MANUAL CALIBRATION' : 'AUTO CALIBRATION'}
        </span>
        <span className="live-charts__cal-info">
          Baseline X: {baseline.x.toFixed(0)} &nbsp; Y: {baseline.y.toFixed(0)} &nbsp; Z: {baseline.z.toFixed(0)}
          &nbsp; | &nbsp; |g| = {countsPerG.toFixed(0)} counts
        </span>
        {isManual && calStart !== null && calEnd !== null && (
          <>
            <span className="live-charts__cal-info">
              {formatDateTimeShortET(readings[Math.min(calStart, calEnd)]?.ts ?? '')}
              {' → '}
              {formatDateTimeShortET(readings[Math.max(calStart, calEnd)]?.ts ?? '')}
              {' '}({Math.abs(calEnd - calStart) + 1} samples)
            </span>
            <button className="live-charts__cal-reset" onClick={handleReset}>
              Reset
            </button>
          </>
        )}
      </div>

      {/* ── NORMALIZED ACCEL CHART ── */}
      <section className="live-charts__section">
        <h3 className="live-charts__label">RELATIVE ACCELERATION (mg)</h3>
        <div className="live-charts__chart-wrapper">
          <Plot
            data={relData}
            layout={relLayout}
            config={BASE_CONFIG}
            useResizeHandler
            style={{ width: '100%' }}
          />
        </div>
      </section>

      {/* ── BATTERY CHART ── */}
      <section className="live-charts__section">
        <h3 className="live-charts__label">BATTERY VOLTAGE</h3>
        <div className="live-charts__chart-wrapper">
          <Plot
            data={battData}
            layout={battLayout}
            config={BASE_CONFIG}
            useResizeHandler
            style={{ width: '100%' }}
          />
        </div>
      </section>

      {/* ── CHARGER TELEMETRY ── */}
      <section className="live-charts__section">
        <h3 className="live-charts__label">CHARGER TELEMETRY (IBAT + VBUS)</h3>
        <div className="live-charts__chart-wrapper">
          <Plot
            data={chgData}
            layout={chgLayout}
            config={BASE_CONFIG}
            useResizeHandler
            style={{ width: '100%' }}
          />
        </div>
      </section>
    </div>
  );
}
