"""Generate the replay demo charts (gallery-1..5.png) and the frames of the demo video.

Illustrative numbers for the "make is_prime faster" story in fixtures/agent-demo.json, not real measurements.

    python make_charts.py OUT_DIR [--frames FRAMES_DIR]

Needs matplotlib. See README.md for the container command and the ffmpeg step that turns the frames into
demo.webm / demo.mp4.
"""

import argparse
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

INK = "#111827"
MUTED = "#6B7280"
GRID = "#E5E7EB"
GREY = "#CBD2DC"
ACCENT = "#4F46E5"
ACCENT_SOFT = "#E0E7FF"
TEAL = "#0D9488"
FOOTNOTE = "Illustrative benchmark, not measured results"

NAMES = ["Trial division", "√n trial division", "6k±1 wheel", "Miller-Rabin", "Sieve lookup"]
WINNER = 3  # Miller-Rabin: exact for every 64-bit n, tiny memory
MS_PER_MILLION = [2400, 620, 210, 95, 40]  # time per 1M checks, n < 2^32
SPEEDUP = [MS_PER_MILLION[0] / v for v in MS_PER_MILLION]
MEMORY_MB = [0.02, 0.02, 0.02, 0.05, 128]
RANGES = ["any n", "any n", "any n", "n < 2⁶⁴", "n < 10⁹"]

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "text.color": INK,
        "axes.labelcolor": MUTED,
        "xtick.color": MUTED,
        "ytick.color": INK,
        "axes.edgecolor": GRID,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "savefig.facecolor": "white",
    }
)


def colors(highlight: int | None = WINNER, soft: float = 1.0) -> list[str]:
    return [ACCENT if i == highlight else GREY for i in range(len(NAMES))]


def base(w: float, h: float, title: str, subtitle: str):
    fig = plt.figure(figsize=(w, h), dpi=100)
    fig.text(0.05, 0.94, title, fontsize=36, fontweight="bold", va="top")
    fig.text(0.05, 0.875, subtitle, fontsize=24, color=MUTED, va="top")
    fig.text(0.05, 0.03, FOOTNOTE, fontsize=20, color=MUTED, style="italic")
    return fig


def style_hbar(ax, xlabel: str):
    ax.grid(axis="x", color=GRID, linewidth=1.2)
    ax.set_axisbelow(True)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0, labelsize=28)
    ax.tick_params(axis="x", labelsize=24)
    ax.set_xlabel(xlabel, fontsize=26, labelpad=14)
    ax.invert_yaxis()


def chart_bars(path: Path) -> None:
    fig = base(16, 10, "Time per 1M checks", "Lower is better · n < 2³²")
    ax = fig.add_axes([0.27, 0.13, 0.66, 0.66])
    bars = ax.barh(NAMES, MS_PER_MILLION, color=colors(), height=0.62)
    for b, v in zip(bars, MS_PER_MILLION):
        note = "  (n < 10⁹ only)" if v == 40 else ""
        ax.text(v + 40, b.get_y() + b.get_height() / 2, f"{v:,} ms", va="center", fontsize=28, fontweight="bold" if v == 95 else "normal")
        if note:
            ax.text(v + 40 + 560, b.get_y() + b.get_height() / 2, note.strip(), va="center", fontsize=24, color=MUTED)
    ax.set_xlim(0, 2900)
    style_hbar(ax, "milliseconds")
    fig.savefig(path)
    plt.close(fig)


def chart_lines(path: Path) -> None:
    fig = base(16, 10, "Runtime vs input size", "Time per check, log-log · lower is better")
    ax = fig.add_axes([0.11, 0.15, 0.84, 0.64])
    n = np.logspace(2, 18, 200)
    series = {
        NAMES[0]: 2e-3 * n,
        NAMES[1]: 6e-3 * np.sqrt(n),
        NAMES[2]: 2e-3 * np.sqrt(n),
        NAMES[3]: 0.02 * np.log2(n) ** 2,
    }
    palette = ["#9CA3AF", "#60A5FA", TEAL, ACCENT]
    for (name, y), c in zip(series.items(), palette):
        ax.plot(n, y, color=c, linewidth=5 if name == NAMES[3] else 3.5, label=name)
    sieve_n = np.logspace(2, 9, 50)
    ax.plot(sieve_n, np.full_like(sieve_n, 0.04), color="#F59E0B", linewidth=3.5, label=NAMES[4])
    ax.scatter([1e9], [0.04], color="#F59E0B", s=140, zorder=5)
    ax.annotate("sieve stops at 10⁹", (1e9, 0.04), (3e10, 0.5), fontsize=22, color="#B45309", arrowprops={"arrowstyle": "-", "color": "#B45309"})
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_ylim(0.02, 1e9)
    ax.set_xlim(1e2, 1e18)
    ax.set_xticks([1e3, 1e6, 1e9, 1e12, 1e15, 1e18])
    ax.set_yticks([1e-1, 1e1, 1e3, 1e5, 1e7, 1e9])
    ax.grid(color=GRID, linewidth=1.2)
    ax.set_axisbelow(True)
    ax.tick_params(labelsize=22)
    ax.set_xlabel("n", fontsize=26)
    ax.set_ylabel("microseconds", fontsize=26)
    ax.legend(fontsize=22, frameon=False, loc="upper left")
    fig.savefig(path)
    plt.close(fig)


def chart_speedup(path: Path) -> None:
    fig = base(16, 10, "Speedup", "× faster than trial division")
    ax = fig.add_axes([0.27, 0.13, 0.66, 0.66])
    bars = ax.barh(NAMES, SPEEDUP, color=colors(), height=0.62)
    for b, v in zip(bars, SPEEDUP):
        label = "baseline" if v == 1 else f"{v:.0f}×" if v >= 10 else f"{v:.1f}×"
        ax.text(v + 1, b.get_y() + b.get_height() / 2, label, va="center", fontsize=28, fontweight="bold" if b is bars[WINNER] else "normal")
    ax.text(SPEEDUP[4] / 2, 4, "n < 10⁹ only", ha="center", va="center", fontsize=24, color=INK, alpha=0.7)
    ax.set_xlim(0, 75)
    style_hbar(ax, "speedup")
    fig.savefig(path)
    plt.close(fig)


def chart_memory(path: Path) -> None:
    fig = base(16, 10, "Memory use", "Working set, log scale · lower is better")
    ax = fig.add_axes([0.27, 0.13, 0.66, 0.66])
    cols = [GREY] * 5
    cols[WINNER] = ACCENT
    cols[4] = "#F59E0B"
    bars = ax.barh(NAMES, MEMORY_MB, color=cols, height=0.62)
    labels = ["20 KB", "20 KB", "20 KB", "50 KB", "128 MB"]
    for b, v, lab in zip(bars, MEMORY_MB, labels):
        ax.text(v * 1.6, b.get_y() + b.get_height() / 2, lab, va="center", fontsize=28)
    ax.set_xscale("log")
    ax.set_xlim(0.005, 3000)
    ax.set_xticks([0.01, 0.1, 1, 10, 100, 1000])
    ax.set_xticklabels(["10 KB", "100 KB", "1 MB", "10 MB", "100 MB", "1 GB"])
    style_hbar(ax, "memory")
    fig.savefig(path)
    plt.close(fig)


def chart_summary(path: Path) -> None:
    fig = base(16, 10, "Summary", "Best choice for the full 64-bit range")
    ax = fig.add_axes([0.05, 0.1, 0.9, 0.68])
    ax.axis("off")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    cols = {"name": 0.03, "speed": 0.50, "mem": 0.68, "range": 0.86}
    ax.text(cols["speed"], 1.0, "Speedup", fontsize=26, color=MUTED, ha="right", va="center")
    ax.text(cols["mem"] + 0.05, 1.0, "Memory", fontsize=26, color=MUTED, ha="right", va="center")
    ax.text(cols["range"] + 0.1, 1.0, "Range", fontsize=26, color=MUTED, ha="right", va="center")
    row_h = 0.18
    for i, name in enumerate(NAMES):
        y = 0.80 - i * row_h
        win = i == WINNER
        ax.add_patch(
            FancyBboxPatch((0.0, y - row_h / 2 + 0.012), 0.99, row_h - 0.024, boxstyle="round,pad=0,rounding_size=0.02",
                           facecolor=ACCENT_SOFT if win else "#F9FAFB", edgecolor=ACCENT if win else GRID, linewidth=3 if win else 1.5)
        )
        w = "bold" if win else "normal"
        ax.text(cols["name"], y, name, fontsize=30, fontweight=w, va="center", color=ACCENT if win else INK)
        sp = "1×" if i == 0 else f"{SPEEDUP[i]:.0f}×" if SPEEDUP[i] >= 10 else f"{SPEEDUP[i]:.1f}×"
        ax.text(cols["speed"], y, sp, fontsize=30, fontweight=w, va="center", ha="right")
        mem = ["20 KB", "20 KB", "20 KB", "50 KB", "128 MB"][i]
        ax.text(cols["mem"] + 0.05, y, mem, fontsize=30, fontweight=w, va="center", ha="right")
        ax.text(cols["range"] + 0.1, y, RANGES[i], fontsize=30, fontweight=w, va="center", ha="right")
        if win:
            ax.add_patch(FancyBboxPatch((0.285, y - 0.035), 0.1, 0.07, boxstyle="round,pad=0,rounding_size=0.03", facecolor=ACCENT, edgecolor="none"))
            ax.text(0.335, y, "BEST", fontsize=24, color="white", va="center", ha="center", fontweight="bold")
    fig.savefig(path)
    plt.close(fig)


# --- video ----------------------------------------------------------------------------------------

FPS, SECONDS = 24, 6


def ease(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) ** 3


def render_frame(t: float, path: Path) -> None:
    """t in seconds: bars grow 0.4-3.0 s, winner highlights 3.4-4.4 s, then holds."""
    fig = plt.figure(figsize=(12.8, 7.2), dpi=100)
    fig.text(0.05, 0.93, "is_prime: how much faster?", fontsize=32, fontweight="bold", va="top")
    fig.text(0.05, 0.855, "× faster than trial division", fontsize=22, color=MUTED, va="top")
    fig.text(0.05, 0.035, FOOTNOTE, fontsize=16, color=MUTED, style="italic")
    ax = fig.add_axes([0.285, 0.22, 0.65, 0.54])
    hl = ease((t - 3.4) / 1.0)
    vals = [v * ease((t - 0.4 - 0.12 * i) / 2.2) for i, v in enumerate(SPEEDUP)]
    cols = []
    for i in range(5):
        if i == WINNER:
            a = hl
            cols.append(tuple(np.array(matplotlib.colors.to_rgb(GREY)) * (1 - a) + np.array(matplotlib.colors.to_rgb(ACCENT)) * a))
        else:
            cols.append(matplotlib.colors.to_rgb(GREY))
    bars = ax.barh(NAMES, vals, color=cols, height=0.62)
    for i, (b, v) in enumerate(zip(bars, vals)):
        if v > 0.05:
            ax.text(v + 1, b.get_y() + b.get_height() / 2, "1×" if i == 0 else f"{v:.0f}×" if v >= 9.95 else f"{v:.1f}×", va="center", fontsize=24,
                    fontweight="bold" if i == WINNER and hl > 0.5 else "normal")
    ax.set_xlim(0, 75)
    ax.grid(axis="x", color=GRID, linewidth=1.2)
    ax.set_axisbelow(True)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0, labelsize=24)
    ax.tick_params(axis="x", labelsize=20)
    ax.invert_yaxis()
    if hl > 0.01:
        fig.text(0.285, 0.105, "Best for 64-bit: Miller-Rabin", fontsize=26, color=ACCENT, fontweight="bold", alpha=hl)
    fig.savefig(path)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--frames", type=Path, help="also write frame_0000.png... for the video")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for i, fn in enumerate([chart_bars, chart_lines, chart_speedup, chart_memory, chart_summary], start=1):
        fn(args.out / f"gallery-{i}.png")
    if args.frames:
        args.frames.mkdir(parents=True, exist_ok=True)
        for f in range(FPS * SECONDS):
            render_frame(f / FPS, args.frames / f"frame_{f:04d}.png")


if __name__ == "__main__":
    main()
