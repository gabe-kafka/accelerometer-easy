from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "exports" / "final_report"
PNG_PATH = OUTPUT_DIR / "battery_7day_trend.png"
SVG_PATH = OUTPUT_DIR / "battery_7day_trend.svg"
CSV_PATH = OUTPUT_DIR / "battery_7day_15min.csv"
TABLE = "accel_batches"
LOCAL_TZ = ZoneInfo("America/New_York")


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (PROJECT_ROOT / ".env").read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key] = value
    return values


def fetch_battery_rows() -> pd.DataFrame:
    env = read_env()
    supabase_url = env["VITE_SUPABASE_URL"].rstrip("/")
    supabase_key = env["VITE_SUPABASE_ANON_KEY"]
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
    }

    rows: list[dict[str, object]] = []
    last_id = 0

    while True:
        params = {
            "select": "id,ts,battery_pct",
            "order": "id.asc",
            "limit": "1000",
            "id": f"gt.{last_id}",
        }
        url = f"{supabase_url}/rest/v1/{TABLE}?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            page = json.loads(response.read())

        if not page:
            break

        rows.extend(page)
        last_id = int(page[-1]["id"])

    frame = pd.DataFrame(rows)
    frame = frame.dropna(subset=["battery_pct"]).copy()
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True)
    frame["battery_pct"] = frame["battery_pct"].astype(float)
    return frame.sort_values("ts")


def make_plot(frame: pd.DataFrame) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    local_time = frame["ts"].dt.tz_convert(LOCAL_TZ)
    series = pd.Series(frame["battery_pct"].to_numpy(), index=local_time)
    battery_15min = series.resample("15min").median().dropna()
    battery_15min.to_frame("battery_pct").to_csv(CSV_PATH, index_label="time_et")

    start = battery_15min.index.min()
    observed_end = battery_15min.index.max()
    seven_day_end = start + pd.Timedelta(days=7)
    end = max(observed_end, seven_day_end)
    duration_hours = (observed_end - start).total_seconds() / 3600

    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 13.5,
            "axes.labelsize": 14.5,
            "xtick.labelsize": 12.5,
            "ytick.labelsize": 12.5,
        }
    )

    fig, ax = plt.subplots(figsize=(9.2, 5.15), dpi=240)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("#FBFBF8")

    ax.fill_between(
        battery_15min.index,
        battery_15min.to_numpy(),
        0,
        color="#D8EAD7",
        alpha=0.55,
        linewidth=0,
    )
    ax.plot(
        battery_15min.index,
        battery_15min.to_numpy(),
        color="#1B7F5A",
        linewidth=2.4,
        solid_capstyle="round",
        label="15-minute median",
    )

    fig.text(
        0.08,
        0.97,
        "Thingy Internal Battery",
        ha="left",
        va="top",
        fontsize=18,
        weight="bold",
        color="#111111",
    )
    fig.text(
        0.08,
        0.92,
        f"{start:%b %-d} to {observed_end:%b %-d, %Y} ET ({duration_hours / 24:.1f} days observed)",
        ha="left",
        va="top",
        fontsize=12.5,
        color="#4A4A4A",
    )

    ax.set_ylabel("Battery (%)")
    ax.set_xlabel("Date / time (ET)")
    ax.set_ylim(-4, 104)
    ax.set_xlim(start, end)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    ax.xaxis.set_major_locator(mdates.DayLocator(tz=LOCAL_TZ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %-d", tz=LOCAL_TZ))
    ax.grid(axis="y", color="#D9D9D9", linewidth=0.9)
    ax.grid(axis="x", color="#E8E8E8", linewidth=0.7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#666666")
    ax.spines["bottom"].set_color("#666666")
    ax.tick_params(colors="#333333")

    ax.text(
        0,
        -0.2,
        "Telemetry is the Thingy internal battery, not direct external 10 Ah buffer state of charge.",
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=10.5,
        color="#555555",
    )

    fig.tight_layout(rect=(0, 0.08, 1, 0.89))
    fig.savefig(PNG_PATH, bbox_inches="tight", facecolor="white")
    fig.savefig(SVG_PATH, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def main() -> None:
    frame = fetch_battery_rows()
    make_plot(frame)
    print(PNG_PATH)
    print(SVG_PATH)
    print(CSV_PATH)


if __name__ == "__main__":
    main()
