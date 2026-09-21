import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  collectionRatio,
  CORRIDOR_COLLECTION,
  emptyForecastWindow,
  FORECAST_EMPTY_MESSAGE,
  formatUsableNeeded,
  HISTORIC_EXAMPLE_ROW,
  HISTORIC_LOG_HEADERS,
} from '../lib/stormIndexPlaceholders';
import type { CollectionSite, ForecastDay } from '../lib/stormIndexTypes';
import './StormIndexPage.css';

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

function formatForecastDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map((part) => Number(part));
  if (!year || !month || !day) return isoDate;
  return DAY_FORMAT.format(new Date(year, month - 1, day));
}

function formatCount(value: number | null) {
  return value === null ? '—' : String(value);
}

function formatObservedAt(value: string | null) {
  return value ?? '—';
}

function CollectionMeter({ site }: { site: CollectionSite }) {
  const ratio = collectionRatio(site.usable, site.needed);
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * ratio;

  return (
    <article className="storm-site" aria-label={`${site.name}, ${site.role}, node ${site.node}`}>
      <div className="storm-site__meter">
        <svg className="storm-ring" viewBox="0 0 72 72" aria-hidden="true">
          <circle className="storm-ring__track" cx="36" cy="36" r={radius} />
          <circle
            className="storm-ring__value"
            cx="36"
            cy="36"
            r={radius}
            strokeDasharray={`${dash} ${circumference}`}
          />
        </svg>
        <span className="storm-site__ratio">{formatUsableNeeded(site.usable, site.needed)}</span>
      </div>
      <div className="storm-site__copy">
        <h3>{site.name}</h3>
        <p>{site.role}</p>
        <p className="storm-site__node">node {site.node}</p>
        <div className="storm-bar" aria-hidden="true">
          <span style={{ width: `${ratio * 100}%` }} />
        </div>
        <p className="storm-site__caption">usable vs needed</p>
      </div>
    </article>
  );
}

function ForecastCard({ day }: { day: ForecastDay }) {
  return (
    <article className="storm-day" role="listitem">
      <span className="storm-day__date">{formatForecastDate(day.date)}</span>
      <strong className="storm-day__value">{formatCount(day.intensity)}</strong>
      <span className="storm-day__unit">{day.label ?? 'intensity'}</span>
    </article>
  );
}

export function StormIndexPage() {
  const forecastDays = useMemo(() => emptyForecastWindow(new Date(), 14), []);
  const overall =
    CORRIDOR_COLLECTION.overallPercent === null
      ? '—'
      : `${CORRIDOR_COLLECTION.overallPercent}%`;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Storm Index';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="page storm">
      <nav className="viewer-tabs" aria-label="App sections">
        <Link className="viewer-tabs__tab viewer-tabs__link" to="/">
          Data viewers
        </Link>
        <Link
          className="viewer-tabs__tab viewer-tabs__tab--active viewer-tabs__link"
          to="/storm-index"
          aria-current="page"
        >
          Storm Index
        </Link>
      </nav>

      <header className="hero">
        <h1>Storm Index</h1>
        <p>PR Line 50200 · placeholder panels · feeds not connected</p>
      </header>

      <section className="raw-panel" aria-labelledby="storm-forecast-heading">
        <div className="raw-panel__toggle" role="presentation">
          <span id="storm-forecast-heading">2-week forecast</span>
          <span>forward storm intensity</span>
        </div>
        <div className="raw-panel__body">
          <p className="state">{FORECAST_EMPTY_MESSAGE}</p>
          <div className="storm-strip" role="list" aria-label="14-day forecast strip">
            {forecastDays.map((day) => (
              <ForecastCard key={day.date} day={day} />
            ))}
          </div>
        </div>
      </section>

      <section className="raw-panel" aria-labelledby="storm-historic-heading">
        <div className="raw-panel__toggle" role="presentation">
          <span id="storm-historic-heading">Historic log</span>
          <span>backwards wind / storm intensity</span>
        </div>
        <div className="raw-panel__body">
          <div className="storm-table-wrap">
            <table className="storm-table">
              <thead>
                <tr>
                  {HISTORIC_LOG_HEADERS.map((header) => (
                    <th key={header} scope="col">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="storm-table__example">
                  <td>{formatObservedAt(HISTORIC_EXAMPLE_ROW.observedAt)}</td>
                  <td>{formatCount(HISTORIC_EXAMPLE_ROW.peakWind)}</td>
                  <td>{formatCount(HISTORIC_EXAMPLE_ROW.stormIntensity)}</td>
                  <td>
                    <span className="storm-chip storm-chip--muted">EXAMPLE</span>
                    Layout only. Not a recorded event.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="calibration-note">
            Historic log feed not connected. The row above is a muted layout example only.
          </p>
        </div>
      </section>

      <section className="raw-panel" aria-labelledby="storm-collected-heading">
        <div className="raw-panel__toggle" role="presentation">
          <span id="storm-collected-heading">% collected</span>
          <span>{CORRIDOR_COLLECTION.line}</span>
        </div>
        <div className="raw-panel__body">
          <div className="storm-collected__head">
            <p className="calibration-note">
              Instrument collection feed not connected. Counts stay blank until usable and needed
              values are available.
            </p>
            <span className="storm-chip" aria-label="Overall corridor collection">
              {CORRIDOR_COLLECTION.line} · overall {overall}
            </span>
          </div>
          <div className="storm-sites">
            {CORRIDOR_COLLECTION.sites.map((site) => (
              <CollectionMeter key={site.id} site={site} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
