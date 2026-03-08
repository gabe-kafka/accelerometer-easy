import gradio as gr
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyArrowPatch
import matplotlib.patheffects as pe
from matplotlib.colors import LinearSegmentedColormap
import requests
from datetime import datetime, timedelta
import time

# ── Power Law constants ──────────────────────────────────────────────────────
GENESIS = datetime(2009, 1, 3)
A = -17.351   # intercept in log10 space
B = 5.84      # slope in log10 space


def days_since_genesis(dt: datetime) -> float:
    return (dt - GENESIS).total_seconds() / 86400


def power_law_price(dt: datetime) -> float:
    d = days_since_genesis(dt)
    if d <= 0:
        return np.nan
    return 10 ** (A + B * np.log10(d))


def years_ahead(price: float, dt: datetime) -> float:
    """How many years ahead of the power curve is the current price?"""
    d = days_since_genesis(dt)
    if d <= 0 or price <= 0:
        return 0.0
    # solve: log10(price) = A + B*log10(d_curve)  =>  d_curve = 10^((log10(price)-A)/B)
    d_curve = 10 ** ((np.log10(price) - A) / B)
    return (d_curve - d) / 365.25


# ── Fear & Greed score (0-100) from years_ahead ──────────────────────────────
def fg_score(ya: float) -> float:
    """Map years-ahead to 0-100 Fear & Greed score."""
    # Calibrated so ~0 ya → 50 (neutral), ~4 ya → 100 (extreme greed), ~-1 ya → 0 (extreme fear)
    score = 50 + ya * 12.5
    return float(np.clip(score, 0, 100))


# ── Price thresholds shown on the gauge ──────────────────────────────────────
def gauge_price_labels(dt: datetime):
    """Return (score, price_str) pairs for gauge tick labels."""
    pairs = []
    for score in [0, 20, 40, 60, 80, 100]:
        ya = (score - 50) / 12.5
        d_target = days_since_genesis(dt) + ya * 365.25
        if d_target > 0:
            p = 10 ** (A + B * np.log10(d_target))
        else:
            p = 0
        if p >= 1_000:
            label = f"${p/1000:.0f}k"
        else:
            label = f"${p:.0f}"
        pairs.append((score, label))
    return pairs


# ── CoinGecko data fetch ─────────────────────────────────────────────────────
def fetch_coingecko_history(days: int = 5000):
    url = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart"
    params = {"vs_currency": "usd", "days": str(days), "interval": "daily"}
    for attempt in range(4):
        try:
            r = requests.get(url, params=params, timeout=20)
            if r.status_code == 200:
                data = r.json()["prices"]
                df = pd.DataFrame(data, columns=["ts", "price"])
                df["date"] = pd.to_datetime(df["ts"], unit="ms")
                df = df[["date", "price"]].drop_duplicates("date")
                df = df[df["date"] >= pd.Timestamp("2010-07-17")]
                return df
            time.sleep(2 ** attempt)
        except Exception:
            time.sleep(2 ** attempt)
    return None


def fetch_current_price():
    url = "https://api.coingecko.com/api/v3/simple/price"
    params = {"ids": "bitcoin", "vs_currencies": "usd"}
    try:
        r = requests.get(url, params=params, timeout=10)
        if r.status_code == 200:
            return r.json()["bitcoin"]["usd"]
    except Exception:
        pass
    return None


# ── Color mapping for price line ──────────────────────────────────────────────
ZONE_COLORS = {
    "extreme_fear":  "#E05C3A",
    "fear":          "#F0A45A",
    "neutral":       "#F5D76E",
    "greed":         "#82C9A0",
    "extreme_greed": "#3EC9C9",
}

def score_to_color(score: float) -> str:
    if score < 20:
        return ZONE_COLORS["extreme_fear"]
    elif score < 40:
        return ZONE_COLORS["fear"]
    elif score < 60:
        return ZONE_COLORS["neutral"]
    elif score < 80:
        return ZONE_COLORS["greed"]
    else:
        return ZONE_COLORS["extreme_greed"]


# ── Draw semicircular gauge ───────────────────────────────────────────────────
def draw_gauge(ax, score: float, price: float, dt: datetime):
    ax.set_xlim(-1.4, 1.4)
    ax.set_ylim(-0.5, 1.4)
    ax.set_aspect("equal")
    ax.axis("off")

    # Zone definitions: (start_angle_deg, end_angle_deg, label, color)
    zones = [
        (0,   36,  "EXTREME\nFEAR",  ZONE_COLORS["extreme_fear"]),
        (36,  72,  "FEAR",           ZONE_COLORS["fear"]),
        (72,  108, "NEUTRAL",        ZONE_COLORS["neutral"]),
        (108, 144, "GREED",          ZONE_COLORS["greed"]),
        (144, 180, "EXTREME\nGREED", ZONE_COLORS["extreme_greed"]),
    ]

    outer_r = 1.2
    inner_r = 0.65

    for (a0, a1, label, color) in zones:
        theta = np.linspace(np.radians(180 - a1), np.radians(180 - a0), 60)
        xs = np.concatenate([outer_r * np.cos(theta), inner_r * np.cos(theta[::-1])])
        ys = np.concatenate([outer_r * np.sin(theta), inner_r * np.sin(theta[::-1])])
        ax.fill(xs, ys, color=color, zorder=2)

        # Zone label
        mid_a = np.radians(180 - (a0 + a1) / 2)
        mid_r = (outer_r + inner_r) / 2 + 0.04
        ax.text(mid_r * np.cos(mid_a), mid_r * np.sin(mid_a), label,
                ha="center", va="center", fontsize=5.5, fontweight="bold",
                color="white", zorder=5)

    # Tick marks and price labels
    price_labels = gauge_price_labels(dt)
    for (tick_score, plabel) in price_labels:
        angle_deg = 180 - tick_score * 1.8  # map 0-100 → 180-0 degrees
        angle = np.radians(angle_deg)
        tx = outer_r * 1.08 * np.cos(angle)
        ty = outer_r * 1.08 * np.sin(angle)
        ax.text(tx, ty, plabel, ha="center", va="center",
                fontsize=4.5, color="#cccccc", zorder=6)

    # Needle
    needle_angle = np.radians(180 - score * 1.8)
    needle_len = inner_r - 0.05
    ax.annotate("", xy=(needle_len * np.cos(needle_angle), needle_len * np.sin(needle_angle)),
                xytext=(0, 0),
                arrowprops=dict(arrowstyle="-|>", color="white", lw=1.5,
                                mutation_scale=10), zorder=8)

    # Center circle with score
    circle = plt.Circle((0, 0), 0.22, color="#1e1e2e", zorder=9)
    ax.add_patch(circle)
    ax.text(0, 0.04, f"{score:.0f}", ha="center", va="center",
            fontsize=16, fontweight="bold", color=score_to_color(score), zorder=10)

    # Price display
    ax.text(0, -0.3, f"${price:,.0f}", ha="center", va="center",
            fontsize=11, fontweight="bold", color="#F5A623", zorder=10)
    ax.text(0, -0.42, "Price, USD", ha="center", va="center",
            fontsize=7, color="#aaaaaa", zorder=10)

    # Title
    ax.text(0, 1.38, "Bitcoin Power Curve\nFear & Greed Index", ha="center", va="top",
            fontsize=9, fontweight="bold", color="white", zorder=10)
    ax.text(0, 1.22, f"x.com/apsk32  |  {dt.strftime('%b %d, %Y')}", ha="center", va="top",
            fontsize=5.5, color="#888888", zorder=10)


# ── Draw price chart ──────────────────────────────────────────────────────────
def draw_price_chart(ax, df: pd.DataFrame, current_price: float, now: datetime):
    ax.set_facecolor("#0d0d1a")

    # Power curve line
    curve_dates = pd.date_range("2010-01-01", now + timedelta(days=365), freq="ME")
    curve_prices = [power_law_price(d.to_pydatetime()) for d in curve_dates]
    ax.semilogy(curve_dates, curve_prices, color="white", lw=1.2, alpha=0.8, zorder=3)

    # Price line colored by score
    dates = df["date"].tolist()
    prices = df["price"].tolist()
    for i in range(1, len(dates)):
        ya = years_ahead(prices[i], dates[i].to_pydatetime())
        sc = fg_score(ya)
        c = score_to_color(sc)
        ax.semilogy([dates[i - 1], dates[i]], [prices[i - 1], prices[i]],
                    color=c, lw=0.9, alpha=0.9, zorder=4)

    # Current price dot
    ax.semilogy([now], [current_price], "o", color="white", ms=4, zorder=6)

    ax.set_xlim(pd.Timestamp("2010-01-01"), pd.Timestamp(now) + timedelta(days=400))
    ax.set_ylim(0.08, 200_000)
    ax.set_title("Bitcoin Price, USD", color="white", fontsize=8, pad=4)
    ax.tick_params(colors="#aaaaaa", labelsize=6.5)
    for spine in ax.spines.values():
        spine.set_edgecolor("#333355")
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(
        lambda x, _: f"${x:,.0f}" if x >= 1 else f"${x:.1f}"))
    ax.xaxis.set_major_locator(matplotlib.dates.YearLocator(2))
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%Y"))
    ax.grid(True, color="#1a1a2e", linewidth=0.5, zorder=1)


# ── Draw years-ahead oscillator ───────────────────────────────────────────────
def draw_oscillator(ax, df: pd.DataFrame, current_price: float, now: datetime):
    ax.set_facecolor("#0d0d1a")

    dates = df["date"].tolist()
    prices = df["price"].tolist()
    ya_vals = [years_ahead(p, d.to_pydatetime()) for p, d in zip(prices, dates)]

    for i in range(1, len(dates)):
        c = score_to_color(fg_score(ya_vals[i]))
        ax.plot([dates[i - 1], dates[i]], [ya_vals[i - 1], ya_vals[i]],
                color=c, lw=0.9, alpha=0.9, zorder=3)

    # Current dot
    ya_now = years_ahead(current_price, now)
    ax.plot([now], [ya_now], "o", color="white", ms=4, zorder=5)

    ax.set_xlim(pd.Timestamp("2010-01-01"), pd.Timestamp(now) + timedelta(days=400))
    ax.set_ylim(-1, 6)
    ax.set_title("Years Ahead of the Power Curve", color="white", fontsize=8, pad=4)
    ax.tick_params(colors="#aaaaaa", labelsize=6.5)
    for spine in ax.spines.values():
        spine.set_edgecolor("#333355")
    ax.xaxis.set_major_locator(matplotlib.dates.YearLocator(2))
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%Y"))
    ax.grid(True, color="#1a1a2e", linewidth=0.5, zorder=1)
    ax.axhline(0, color="#555577", lw=0.8, zorder=2)


# ── Main build function ───────────────────────────────────────────────────────
def build_chart():
    now = datetime.utcnow()

    current_price = fetch_current_price()
    if current_price is None:
        current_price = 66_648  # fallback from image

    df = fetch_coingecko_history(days=5500)
    if df is None or df.empty:
        return None, "Failed to fetch historical data from CoinGecko."

    ya_now = years_ahead(current_price, now)
    score_now = fg_score(ya_now)

    fig = plt.figure(figsize=(12, 6), facecolor="#0d0d1a")
    gs = fig.add_gridspec(2, 2, width_ratios=[1, 1.6],
                          hspace=0.35, wspace=0.18,
                          left=0.04, right=0.98, top=0.96, bottom=0.06)

    ax_gauge = fig.add_subplot(gs[:, 0])
    ax_price = fig.add_subplot(gs[0, 1])
    ax_osc   = fig.add_subplot(gs[1, 1])

    draw_gauge(ax_gauge, score_now, current_price, now)
    draw_price_chart(ax_price, df, current_price, now)
    draw_oscillator(ax_osc, df, current_price, now)

    # Legend
    legend_patches = [
        mpatches.Patch(color=ZONE_COLORS["extreme_fear"],  label="Extreme Fear"),
        mpatches.Patch(color=ZONE_COLORS["fear"],          label="Fear"),
        mpatches.Patch(color=ZONE_COLORS["neutral"],       label="Neutral"),
        mpatches.Patch(color=ZONE_COLORS["greed"],         label="Greed"),
        mpatches.Patch(color=ZONE_COLORS["extreme_greed"], label="Extreme Greed"),
    ]
    fig.legend(handles=legend_patches, loc="lower center", ncol=5,
               facecolor="#0d0d1a", edgecolor="#333355",
               labelcolor="white", fontsize=7, framealpha=0.7,
               bbox_to_anchor=(0.75, -0.01))

    status = (
        f"**Current BTC Price:** ${current_price:,.0f}  |  "
        f"**F&G Score:** {score_now:.0f}  |  "
        f"**Years Ahead:** {ya_now:.2f}  |  "
        f"*Data: CoinGecko — updated {now.strftime('%Y-%m-%d %H:%M UTC')}*"
    )
    return fig, status


# ── Gradio UI ─────────────────────────────────────────────────────────────────
def refresh():
    fig, status = build_chart()
    return fig, status


with gr.Blocks(
    theme=gr.themes.Base(primary_hue="slate"),
    css="""
    body { background: #0d0d1a; }
    .gradio-container { background: #0d0d1a; color: white; }
    footer { display: none !important; }
    """,
    title="Bitcoin Power Curve Fear & Greed Index",
) as demo:
    gr.Markdown("## Bitcoin Power Curve Fear & Greed Index")
    gr.Markdown(
        "Visualizes Bitcoin's price relative to its long-term power law trajectory. "
        "The Fear & Greed score reflects how many *years ahead* of the power curve BTC is trading."
    )

    with gr.Row():
        refresh_btn = gr.Button("Refresh", variant="primary", scale=0)

    chart_out  = gr.Plot(label="", show_label=False)
    status_out = gr.Markdown()

    refresh_btn.click(fn=refresh, outputs=[chart_out, status_out])
    demo.load(fn=refresh, outputs=[chart_out, status_out])

demo.launch()
