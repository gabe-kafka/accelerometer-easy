import type { Layout, Config } from 'plotly.js';

/**
 * Cockpit-flat theme matching index.css :root custom properties.
 * Plotly renders SVG which can't resolve CSS vars, so we duplicate
 * the palette here as literal hex.
 */
export const THEME = {
  bg: '#0A0A0A',
  surface: '#141414',
  border: '#2A2A2A',
  text: '#E0E0E0',
  muted: '#757575',
  green: '#4CAF50',
  amber: '#FFC107',
  red: '#C62828',
  blue: '#42A5F5',
};

export const BASE_LAYOUT: Partial<Layout> = {
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  font: {
    color: THEME.text,
    family: "'JetBrains Mono', monospace",
    size: 11,
  },
  margin: { l: 55, r: 30, t: 20, b: 55 },
  hovermode: 'x unified',
  showlegend: true,
  legend: {
    orientation: 'h',
    y: -0.22,
    x: 0,
    font: { color: THEME.text, size: 11 },
  },
  // (No uirevision: we prefer autorange-extends-to-new-data over preserving
  // user zoom across polls. User can re-zoom any time.)
  xaxis: {
    color: THEME.muted,
    gridcolor: THEME.border,
    zerolinecolor: THEME.border,
    linecolor: THEME.border,
    tickfont: { color: THEME.muted, size: 10 },
    type: 'date',
    autorange: true,
  },
  yaxis: {
    color: THEME.muted,
    gridcolor: THEME.border,
    zerolinecolor: THEME.border,
    linecolor: THEME.border,
    tickfont: { color: THEME.muted, size: 10 },
    autorange: true,
  },
};

export const BASE_CONFIG: Partial<Config> = {
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'sendDataToCloud'],
  responsive: true,
  displaylogo: false,
  toImageButtonOptions: {
    format: 'png',
    filename: 'shm-chart',
    scale: 2,
  },
};
