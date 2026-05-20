from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
FINAL_DIR = Path(
    "/Users/gabe/Library/Mobile Documents/com~apple~CloudDocs/Desktop/BIBLE/NYU/puerto-rico/final-report"
)

LORD_CSV = ROOT / "exports/sensorconnect_alignment_day2/sensorconnect_day2_30s_clean.csv"
THINGY_CSV = ROOT / "exports/sensorconnect_alignment_day2/thingy_peak_aligned_30s_rawmag.csv"

OUT_HTML = FINAL_DIR / "accelerometer_viability_axis_calibrated_plotly.html"
OUT_CSV = FINAL_DIR / "axis_separated_native25hz_dynamic.csv"
OUT_METRICS = FINAL_DIR / "axis_separation_native25hz_metrics.json"


def corr(a: np.ndarray, b: np.ndarray) -> float:
    if np.std(a) == 0 or np.std(b) == 0:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


def rmse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((a - b) ** 2)))


def round_list(a: np.ndarray, digits: int = 6) -> list[float]:
    return np.round(a.astype(float), digits).tolist()


def build() -> None:
    lord = pd.read_csv(LORD_CSV)
    thingy = pd.read_csv(THINGY_CSV)
    thingy = thingy[
        (thingy["relative_time_s"] >= lord["relative_time_s"].min())
        & (thingy["relative_time_s"] <= lord["relative_time_s"].max())
    ].copy()

    t = thingy["relative_time_s"].to_numpy(float)
    lord_abs = np.column_stack(
        [
            np.interp(t, lord["relative_time_s"], lord[col])
            for col in ("sensor_ch1_g", "sensor_ch2_g", "sensor_ch3_g")
        ]
    )
    thingy_counts = thingy[["x_raw", "y_raw", "z_raw"]].to_numpy(float)

    baseline_mask = (t >= 0.5) & (t <= 3.5)
    lord_baseline = lord_abs[baseline_mask].mean(axis=0)
    thingy_baseline_counts = thingy_counts[baseline_mask].mean(axis=0)

    # ADXL counts are first converted with the static gravity magnitude so the
    # subsequent fit is a physical rotation plus one scalar, not an arbitrary
    # shear that can overfit correlated axes.
    count_per_g = float(
        np.linalg.norm(thingy_baseline_counts) / np.linalg.norm(lord_baseline)
    )
    thingy_abs_g = thingy_counts / count_per_g
    thingy_dyn_input = thingy_abs_g - thingy_abs_g[baseline_mask].mean(axis=0)
    lord_dyn = lord_abs - lord_baseline

    # Orthogonal Procrustes: find a uniform scale and 3D rotation mapping the
    # Thingy dynamic vector into the LORD channel frame.
    m = thingy_dyn_input.T @ lord_dyn
    u, singular_values, vt = np.linalg.svd(m)
    rotation = u @ vt
    if np.linalg.det(rotation) < 0:
        u[:, -1] *= -1
        rotation = u @ vt
    scale = float(np.sum(singular_values) / np.sum(thingy_dyn_input * thingy_dyn_input))
    thingy_dyn = scale * thingy_dyn_input @ rotation
    residual = thingy_dyn - lord_dyn

    lord_mag = np.linalg.norm(lord_dyn, axis=1)
    thingy_mag = np.linalg.norm(thingy_dyn, axis=1)
    mag_residual = thingy_mag - lord_mag

    axis_metrics = []
    axis_labels = ["X / LORD ch1", "Y / LORD ch2", "Z / LORD ch3"]
    for i, label in enumerate(axis_labels):
        axis_metrics.append(
            {
                "axis": label,
                "pearson_r": corr(lord_dyn[:, i], thingy_dyn[:, i]),
                "rmse_g": rmse(thingy_dyn[:, i], lord_dyn[:, i]),
                "lord_rms_g": float(np.sqrt(np.mean(lord_dyn[:, i] ** 2))),
                "lord_peak_to_peak_g": float(np.ptp(lord_dyn[:, i])),
                "nrmse_by_lord_range_pct": float(
                    100 * rmse(thingy_dyn[:, i], lord_dyn[:, i]) / np.ptp(lord_dyn[:, i])
                ),
            }
        )

    raw_axis_corr = np.corrcoef(np.column_stack([thingy_dyn_input, lord_dyn]).T)[:3, 3:]

    def eval_split(train_mask: np.ndarray, test_mask: np.ndarray) -> list[dict[str, float | str]]:
        mm = thingy_dyn_input[train_mask].T @ lord_dyn[train_mask]
        uu, ss, vv = np.linalg.svd(mm)
        rr = uu @ vv
        if np.linalg.det(rr) < 0:
            uu[:, -1] *= -1
            rr = uu @ vv
        sc = float(np.sum(ss) / np.sum(thingy_dyn_input[train_mask] ** 2))
        pred = sc * thingy_dyn_input[test_mask] @ rr
        truth = lord_dyn[test_mask]
        rows = []
        for j, label in enumerate(axis_labels):
            rows.append(
                {
                    "axis": label,
                    "pearson_r": corr(truth[:, j], pred[:, j]),
                    "rmse_g": rmse(pred[:, j], truth[:, j]),
                    "nrmse_by_lord_range_pct": float(
                        100 * rmse(pred[:, j], truth[:, j]) / np.ptp(truth[:, j])
                    ),
                }
            )
        return rows

    even_mask = np.arange(len(t)) % 2 == 0
    impulse_mask = (t >= 4.0) & (t <= 8.0)
    ring_mask = (t >= 8.0) & (t <= 20.0)

    metrics = {
        "method": "Native 25 Hz Thingy samples; LORD interpolated to Thingy timestamps; quiet-window baseline removed; Thingy axes mapped to LORD frame with uniform scale plus 3D rotation.",
        "thingy_sample_count": int(len(t)),
        "duration_s": float(t[-1] - t[0]),
        "baseline_window_s": [0.5, 3.5],
        "count_per_g_from_static_baseline": count_per_g,
        "procrustes_dynamic_scale": scale,
        "rotation_rows_thingy_xyz_cols_lord_ch1_ch2_ch3": rotation.tolist(),
        "axis_metrics": axis_metrics,
        "magnitude_pearson_r": corr(lord_mag, thingy_mag),
        "magnitude_rmse_g": rmse(thingy_mag, lord_mag),
        "raw_axis_correlation_rows_thingy_xyz_cols_lord_ch1_ch2_ch3": raw_axis_corr.tolist(),
        "audit_even_train_odd_validate": eval_split(even_mask, ~even_mask),
        "audit_impulse_train_ring_validate": eval_split(impulse_mask, ring_mask),
    }

    out = pd.DataFrame(
        {
            "relative_time_s": t,
            "lord_x_ch1_dynamic_g": lord_dyn[:, 0],
            "lord_y_ch2_dynamic_g": lord_dyn[:, 1],
            "lord_z_ch3_dynamic_g": lord_dyn[:, 2],
            "thingy_x_ch1_dynamic_g": thingy_dyn[:, 0],
            "thingy_y_ch2_dynamic_g": thingy_dyn[:, 1],
            "thingy_z_ch3_dynamic_g": thingy_dyn[:, 2],
            "residual_x_ch1_g": residual[:, 0],
            "residual_y_ch2_g": residual[:, 1],
            "residual_z_ch3_g": residual[:, 2],
            "lord_dynamic_magnitude_g": lord_mag,
            "thingy_dynamic_magnitude_g": thingy_mag,
            "magnitude_residual_g": mag_residual,
        }
    )
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_CSV, index=False)
    OUT_METRICS.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    data = {
        "t": round_list(t, 5),
        "lord": {
            "x": round_list(lord_dyn[:, 0]),
            "y": round_list(lord_dyn[:, 1]),
            "z": round_list(lord_dyn[:, 2]),
            "mag": round_list(lord_mag),
        },
        "thingy": {
            "x": round_list(thingy_dyn[:, 0]),
            "y": round_list(thingy_dyn[:, 1]),
            "z": round_list(thingy_dyn[:, 2]),
            "mag": round_list(thingy_mag),
        },
        "residual": {
            "x": round_list(residual[:, 0]),
            "y": round_list(residual[:, 1]),
            "z": round_list(residual[:, 2]),
            "mag": round_list(mag_residual),
        },
        "rawCorr": np.round(raw_axis_corr, 4).tolist(),
        "metrics": metrics,
    }

    axis_metric_cards = "\n".join(
        f"""  <div class="metric"><div class="label">{m['axis']} r</div><div class="value">{m['pearson_r']:.3f}</div></div>
  <div class="metric"><div class="label">{m['axis']} RMSE</div><div class="value">{m['rmse_g']:.4f} g</div></div>"""
        for m in axis_metrics
    )
    rotation_rows = "\n".join(
        "<tr>"
        + "".join(f"<td>{rotation[i, j]:.4f}</td>" for j in range(3))
        + "</tr>"
        for i in range(3)
    )
    audit_rows = "\n".join(
        f"<tr><td>{m['axis']}</td><td>{m['pearson_r']:.3f}</td><td>{m['rmse_g']:.4f} g</td><td>{m['nrmse_by_lord_range_pct']:.1f}%</td></tr>"
        for m in metrics["audit_even_train_odd_validate"]
    )

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Axis-Separated Accelerometer Viability Test</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; color: #17202a; background: #f7f8fa; }}
    header {{ padding: 24px 32px 12px; background: #fff; border-bottom: 1px solid #d9dee7; }}
    h1 {{ margin: 0 0 8px; font-size: 26px; font-weight: 700; }}
    h2 {{ margin: 28px 32px 8px; font-size: 18px; }}
    p {{ margin: 0 32px 14px; line-height: 1.45; max-width: 1180px; }}
    .metrics {{ display: grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); gap: 12px; margin: 18px 32px; }}
    .metric {{ background: #fff; border: 1px solid #d9dee7; border-radius: 6px; padding: 12px; }}
    .metric .label {{ font-size: 12px; color: #596579; text-transform: uppercase; letter-spacing: .04em; }}
    .metric .value {{ margin-top: 4px; font-size: 20px; font-weight: 700; }}
    .plot {{ margin: 0 20px 28px; background: #fff; border: 1px solid #d9dee7; border-radius: 6px; padding: 8px; }}
    table {{ border-collapse: collapse; margin: 0 32px 24px; background: #fff; border: 1px solid #d9dee7; }}
    th, td {{ border-bottom: 1px solid #e4e8ef; padding: 8px 12px; text-align: right; font-size: 13px; }}
    th:first-child, td:first-child {{ text-align: left; }}
    code {{ background: #edf1f7; padding: 2px 5px; border-radius: 4px; }}
  </style>
</head>
<body>
<header>
  <h1>Accelerometer Viability Test: Axis-Separated ADXL vs LORD Reference</h1>
  <p>Workflow: use the Thingy ADXL at its native 25 Hz timestamps, interpolate LORD onto those timestamps, remove the quiet mounted baseline, and map Thingy X/Y/Z into the LORD frame with one physical 3D rotation plus one scale. These are dynamic acceleration comparisons only.</p>
</header>

<section class="metrics">
  <div class="metric"><div class="label">Thingy Samples</div><div class="value">25 Hz native</div></div>
  <div class="metric"><div class="label">Baseline Zero</div><div class="value">0.5-3.5 s</div></div>
  <div class="metric"><div class="label">Magnitude r</div><div class="value">{metrics['magnitude_pearson_r']:.3f}</div></div>
  <div class="metric"><div class="label">Magnitude RMSE</div><div class="value">{metrics['magnitude_rmse_g']:.4f} g</div></div>
{axis_metric_cards}
</section>

<h2>1. Axis-separated dynamic acceleration</h2>
<p>Each panel compares the LORD channel to the calibrated Thingy estimate in the same LORD frame. The transform is constrained to rotation plus scale, so the plot is not using an arbitrary per-axis shear to make the traces match.</p>
<div id="axisCompare" class="plot"></div>

<h2>2. Axis residuals</h2>
<p>Residuals are Thingy minus LORD after quiet-window zeroing and axis-frame alignment.</p>
<div id="axisResidual" class="plot"></div>

<h2>3. Dynamic magnitude check</h2>
<p>This is the magnitude of the baseline-removed X/Y/Z dynamic acceleration vectors, computed from the same native 25 Hz comparison.</p>
<div id="magCompare" class="plot"></div>

<h2>4. Axis-separation audit</h2>
<p>The rotation matrix below maps Thingy X/Y/Z rows into LORD ch1/ch2/ch3 columns. The strong off-diagonal X/Y terms are expected because the two sensors were not mounted with identical yaw; Thingy Z stays mostly aligned to LORD ch3.</p>
<table>
  <thead><tr><th>Thingy axis</th><th>LORD ch1</th><th>LORD ch2</th><th>LORD ch3</th></tr></thead>
  <tbody>
    <tr><td>X row</td>{''.join(f'<td>{rotation[0, j]:.4f}</td>' for j in range(3))}</tr>
    <tr><td>Y row</td>{''.join(f'<td>{rotation[1, j]:.4f}</td>' for j in range(3))}</tr>
    <tr><td>Z row</td>{''.join(f'<td>{rotation[2, j]:.4f}</td>' for j in range(3))}</tr>
  </tbody>
</table>
<p>Even/odd validation retrains on alternating native samples and tests on the held-out samples. It checks that the result is not just a visual overlay from reused samples.</p>
<table>
  <thead><tr><th>Axis</th><th>Held-out r</th><th>Held-out RMSE</th><th>Held-out NRMSE / range</th></tr></thead>
  <tbody>{audit_rows}</tbody>
</table>
<div id="corrHeatmap" class="plot"></div>

<script>
const D = {json.dumps(data, separators=(',', ':'))};
const config = {{responsive: true, displaylogo: false}};
const layoutBase = {{
  template: 'plotly_white',
  hovermode: 'x unified',
  margin: {{l: 72, r: 32, t: 36, b: 54}},
  legend: {{orientation: 'h', y: 1.08}}
}};

Plotly.newPlot('axisCompare', [
  {{x: D.t, y: D.lord.x, name: 'LORD X / ch1', type: 'scatter', mode: 'lines', xaxis: 'x', yaxis: 'y', line: {{color: '#2563eb'}}}},
  {{x: D.t, y: D.thingy.x, name: 'Thingy X in LORD frame', type: 'scatter', mode: 'lines', xaxis: 'x', yaxis: 'y', line: {{color: '#f97316'}}}},
  {{x: D.t, y: D.lord.y, name: 'LORD Y / ch2', type: 'scatter', mode: 'lines', xaxis: 'x2', yaxis: 'y2', line: {{color: '#2563eb'}}}},
  {{x: D.t, y: D.thingy.y, name: 'Thingy Y in LORD frame', type: 'scatter', mode: 'lines', xaxis: 'x2', yaxis: 'y2', line: {{color: '#f97316'}}}},
  {{x: D.t, y: D.lord.z, name: 'LORD Z / ch3', type: 'scatter', mode: 'lines', xaxis: 'x3', yaxis: 'y3', line: {{color: '#2563eb'}}}},
  {{x: D.t, y: D.thingy.z, name: 'Thingy Z in LORD frame', type: 'scatter', mode: 'lines', xaxis: 'x3', yaxis: 'y3', line: {{color: '#f97316'}}}},
], {{
  ...layoutBase,
  height: 820,
  grid: {{rows: 3, columns: 1, pattern: 'independent'}},
  xaxis: {{title: 'Time (s)'}},
  yaxis: {{title: 'X / ch1 dynamic g'}},
  xaxis2: {{title: 'Time (s)'}},
  yaxis2: {{title: 'Y / ch2 dynamic g'}},
  xaxis3: {{title: 'Time (s)'}},
  yaxis3: {{title: 'Z / ch3 dynamic g'}},
}}, config);

Plotly.newPlot('axisResidual', [
  {{x: D.t, y: D.residual.x, name: 'X / ch1 residual', type: 'scatter', mode: 'lines'}},
  {{x: D.t, y: D.residual.y, name: 'Y / ch2 residual', type: 'scatter', mode: 'lines'}},
  {{x: D.t, y: D.residual.z, name: 'Z / ch3 residual', type: 'scatter', mode: 'lines'}},
], {{
  ...layoutBase,
  height: 420,
  xaxis: {{title: 'Time (s)'}},
  yaxis: {{title: 'Thingy - LORD error (g)'}},
  shapes: [{{type: 'line', x0: D.t[0], x1: D.t[D.t.length - 1], y0: 0, y1: 0, line: {{color: '#6b7280', width: 1, dash: 'dot'}}}}],
}}, config);

Plotly.newPlot('magCompare', [
  {{x: D.t, y: D.lord.mag, name: 'LORD dynamic magnitude', type: 'scatter', mode: 'lines'}},
  {{x: D.t, y: D.thingy.mag, name: 'Thingy dynamic magnitude', type: 'scatter', mode: 'lines'}},
  {{x: D.t, y: D.residual.mag, name: 'Magnitude residual', type: 'scatter', mode: 'lines', visible: 'legendonly'}},
], {{
  ...layoutBase,
  height: 460,
  xaxis: {{title: 'Time (s)'}},
  yaxis: {{title: 'Dynamic acceleration magnitude (g)'}},
}}, config);

Plotly.newPlot('corrHeatmap', [{{
  z: D.rawCorr,
  x: ['LORD ch1', 'LORD ch2', 'LORD ch3'],
  y: ['Thingy X', 'Thingy Y', 'Thingy Z'],
  type: 'heatmap',
  zmin: -1,
  zmax: 1,
  colorscale: 'RdBu',
  reversescale: true,
  text: D.rawCorr.map(row => row.map(v => v.toFixed(3))),
  texttemplate: '%{{text}}',
  hovertemplate: '%{{y}} vs %{{x}}<br>r=%{{z:.3f}}<extra></extra>',
}}], {{
  ...layoutBase,
  height: 360,
  title: {{text: 'Raw dynamic-axis correlation before rotation', x: 0.02, xanchor: 'left'}},
  xaxis: {{side: 'top'}},
  yaxis: {{autorange: 'reversed'}},
}}, config);
</script>
</body>
</html>
"""
    OUT_HTML.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    build()
