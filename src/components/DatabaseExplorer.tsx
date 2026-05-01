import { useState } from 'react';
import './DatabaseExplorer.css';
import { useAccelReadings, ExplorerFilters } from '../hooks/useAccelReadings';
import { AccelReading } from '../types';
import { formatET } from '../lib/time';

const formatTs = formatET;

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseHashParams(): Partial<{ from: string; to: string; page: number }> {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return {};
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return {
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    page: params.has('page') ? Number(params.get('page')) : undefined,
  };
}

type SortKey = ExplorerFilters['sortKey'];
type SortDir = ExplorerFilters['sortDir'];

export function DatabaseExplorer() {
  const hashParams = parseHashParams();

  const [from, setFrom] = useState(hashParams.from ?? defaultFrom());
  const [to, setTo] = useState(hashParams.to ?? today());
  const [page, setPage] = useState(hashParams.page ?? 1);
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filters: ExplorerFilters = { from, to, page, sortKey, sortDir };
  const { readings, total, totalPages, page: currentPage, loading } = useAccelReadings(filters);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function renderExpandedRow(r: AccelReading) {
    return (
      <tr className="explorer__detail-row" key={`detail-${r.id}`}>
        <td colSpan={7}>
          <div className="explorer__detail">
            <div>ID: {r.id}</div>
            <div>Node: {r.node_id}</div>
            <div>Timestamp: {formatTs(r.ts)}</div>
            <div>X: {r.x_raw} &nbsp; Y: {r.y_raw} &nbsp; Z: {r.z_raw}</div>
            <div>Voltage: {r.battery_v != null ? `${r.battery_v.toFixed(2)} V` : 'N/A'}</div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="explorer">
      <h2 className="explorer__heading">Database Explorer</h2>

      <div className="explorer__filters">
        <label className="explorer__filter">
          <span className="explorer__filter-label">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
          />
        </label>

        <label className="explorer__filter">
          <span className="explorer__filter-label">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
          />
        </label>
      </div>

      {loading ? (
        <p className="explorer__loading">Loading...</p>
      ) : (
        <>
          <table className="explorer__table">
            <thead>
              <tr>
                <th onClick={() => handleSort('ts')} className="explorer__sortable">
                  TS{sortIndicator('ts')}
                </th>
                <th onClick={() => handleSort('node_id')} className="explorer__sortable">
                  Node{sortIndicator('node_id')}
                </th>
                <th onClick={() => handleSort('x_raw')} className="explorer__sortable">
                  X raw{sortIndicator('x_raw')}
                </th>
                <th onClick={() => handleSort('y_raw')} className="explorer__sortable">
                  Y raw{sortIndicator('y_raw')}
                </th>
                <th onClick={() => handleSort('z_raw')} className="explorer__sortable">
                  Z raw{sortIndicator('z_raw')}
                </th>
                <th onClick={() => handleSort('battery_v')} className="explorer__sortable">
                  Voltage{sortIndicator('battery_v')}
                </th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => (
                <>
                  <tr
                    key={r.id}
                    className={`explorer__row ${expandedId === r.id ? 'explorer__row--expanded' : ''}`}
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <td>{formatTs(r.ts)}</td>
                    <td>{r.node_id}</td>
                    <td>{r.x_raw}</td>
                    <td>{r.y_raw}</td>
                    <td>{r.z_raw}</td>
                    <td>{r.battery_v != null ? r.battery_v.toFixed(2) : '—'}</td>
                  </tr>
                  {expandedId === r.id && renderExpandedRow(r)}
                </>
              ))}
              {readings.length === 0 && (
                <tr>
                  <td colSpan={7} className="explorer__empty">No readings found</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="explorer__pagination">
            <button
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              ◂ Prev
            </button>
            <span>
              Page {currentPage} of {totalPages} &nbsp; — &nbsp;{' '}
              {total > 0
                ? `Showing ${(currentPage - 1) * 50 + 1}–${Math.min(currentPage * 50, total)} of ${total.toLocaleString()}`
                : '0 results'}
            </span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next ▸
            </button>
          </div>
        </>
      )}
    </div>
  );
}
