//! Charts as server-rendered SVG: this module computes the geometry, `_chart.html` draws it.
//!
//! WHY server-rendered SVG and not a vendored chart library: one implementation in Rust (tested
//! here, no license or checksum to track), it works without JavaScript, the strict CSP needs
//! nothing (SVG attributes aren't styles), and every chart ships its own data table as the text
//! alternative. Live updates re-render the fragment on the server and `dashboard.js` swaps it in;
//! the same script adds the hover readout from the `data-` attributes.

use super::series::Sample;
use super::web::{bytes, micros};

/// The plot area inside the SVG's viewBox.
pub const W: u32 = 640;
pub const H: u32 = 200;
const LEFT: f64 = 52.0;
const RIGHT: f64 = 8.0;
const TOP: f64 = 10.0;
const BOTTOM: f64 = 22.0;

/// How a chart's numbers read.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Bytes,
    Percent,
    PerSecond,
    Micros,
    Count,
}

impl Unit {
    pub fn format(self, v: f64) -> String {
        match self {
            Unit::Bytes => bytes(v.max(0.0) as u64),
            Unit::Percent => format!("{v:.0}%"),
            Unit::PerSecond => {
                if v >= 10.0 || v == 0.0 {
                    format!("{v:.0}/s")
                } else {
                    format!("{v:.1}/s")
                }
            }
            Unit::Micros => micros(v.max(0.0) as u64),
            Unit::Count => format!("{v:.0}"),
        }
    }
}

pub struct Tick {
    pub pos: String,
    pub label: String,
}

pub struct Line {
    pub name: &'static str,
    /// CSS class: `s1`…`s4` (colors per theme in dashboard.css).
    pub class: &'static str,
    pub d: String,
    pub area: String,
    pub last: String,
    /// Comma-separated values for the hover readout.
    pub values: String,
}

/// Everything `_chart.html` needs.
pub struct ChartView {
    pub key: &'static str,
    pub title: &'static str,
    pub summary: String,
    pub w: u32,
    pub h: u32,
    pub x0: String,
    pub x1: String,
    pub y0: String,
    pub y1: String,
    pub grid: Vec<Tick>,
    pub xticks: Vec<Tick>,
    pub lines: Vec<Line>,
    pub table_head: Vec<&'static str>,
    pub table: Vec<Vec<String>>,
    pub empty: bool,
    /// Unix seconds of the first point, and seconds per point (for the readout's time).
    pub t0: i64,
    pub step: i64,
    pub unit: &'static str,
}

/// A series to plot: name and one value per sample.
pub struct SeriesSpec {
    pub name: &'static str,
    pub value: fn(&Sample) -> f64,
}

/// 1, 2, 2.5 or 5 × 10^k at or above `v`.
pub fn nice_ceiling(v: f64) -> f64 {
    if v <= 0.0 || !v.is_finite() {
        return 1.0;
    }
    let mag = 10_f64.powf(v.log10().floor());
    for m in [1.0, 2.0, 2.5, 5.0, 10.0] {
        if v <= m * mag {
            return m * mag;
        }
    }
    10.0 * mag
}

/// At most `max` points, each the largest in its bucket (spikes survive downsampling).
pub fn downsample(samples: &[Sample], max: usize) -> Vec<Sample> {
    if samples.len() <= max || max == 0 {
        return samples.to_vec();
    }
    let per = samples.len().div_ceil(max);
    samples
        .chunks(per)
        .filter_map(|c| {
            let mut s = *c.last()?;
            s.rss = c.iter().map(|x| x.rss).max().unwrap_or(s.rss);
            s.cpu = c.iter().map(|x| x.cpu).fold(0.0, f32::max);
            s.req = c.iter().map(|x| x.req).fold(0.0, f32::max);
            s.e4 = c.iter().map(|x| x.e4).fold(0.0, f32::max);
            s.e5 = c.iter().map(|x| x.e5).fold(0.0, f32::max);
            s.p50 = c.iter().map(|x| x.p50).max().unwrap_or(s.p50);
            s.p95 = c.iter().map(|x| x.p95).max().unwrap_or(s.p95);
            s.p99 = c.iter().map(|x| x.p99).max().unwrap_or(s.p99);
            s.sql = c.iter().map(|x| x.sql).fold(0.0, f32::max);
            s.tasks = c.iter().map(|x| x.tasks).max().unwrap_or(s.tasks);
            Some(s)
        })
        .collect()
}

fn ago(secs: i64) -> String {
    match secs {
        0 => "now".to_owned(),
        s if s < 3_600 => format!("-{}m", s / 60),
        s => format!("-{}h", s / 3_600),
    }
}

/// A line chart of `series` over `samples` (oldest first), spanning `span` seconds to `now`.
pub fn line_chart(
    key: &'static str,
    title: &'static str,
    unit: Unit,
    samples: &[Sample],
    series: &[SeriesSpec],
    span: i64,
    now: i64,
) -> ChartView {
    let (pw, ph) = (f64::from(W) - LEFT - RIGHT, f64::from(H) - TOP - BOTTOM);
    let max = samples
        .iter()
        .flat_map(|s| series.iter().map(move |spec| (spec.value)(s)))
        .fold(0.0, f64::max);
    // Bytes get binary steps (10 MiB, not 9.5 MiB).
    let ymax = if unit == Unit::Bytes {
        let mib = 1024.0 * 1024.0;
        nice_ceiling(max / mib) * mib
    } else {
        nice_ceiling(max)
    };
    let start = now - span;
    let x = |t: i64| LEFT + ((t - start).clamp(0, span) as f64 / span.max(1) as f64) * pw;
    let y = |v: f64| TOP + ph - (v / ymax).clamp(0.0, 1.0) * ph;
    let grid = (0..=5)
        .map(|i| {
            let v = ymax * f64::from(i) / 5.0;
            Tick {
                pos: format!("{:.1}", y(v)),
                label: unit.format(v),
            }
        })
        .collect();
    let xticks = (0..=4)
        .map(|i| {
            let back = span - span * i / 4;
            Tick {
                pos: format!("{:.1}", x(now - back)),
                label: ago(back),
            }
        })
        .collect();
    let classes = palette(key);
    let lines = series
        .iter()
        .enumerate()
        .map(|(i, spec)| {
            let mut d = String::new();
            for (n, s) in samples.iter().enumerate() {
                let cmd = if n == 0 { 'M' } else { 'L' };
                d.push_str(&format!("{cmd}{:.1},{:.1}", x(s.t), y((spec.value)(s))));
            }
            let area = match (samples.first(), samples.last()) {
                (Some(a), Some(b)) => format!(
                    "{d}L{:.1},{:.1}L{:.1},{:.1}Z",
                    x(b.t),
                    TOP + ph,
                    x(a.t),
                    TOP + ph
                ),
                _ => String::new(),
            };
            Line {
                name: spec.name,
                class: classes[i % classes.len()],
                d,
                area,
                last: samples
                    .last()
                    .map(|s| unit.format((spec.value)(s)))
                    .unwrap_or_else(|| "–".to_owned()),
                values: samples
                    .iter()
                    .map(|s| format!("{:.2}", (spec.value)(s)))
                    .collect::<Vec<_>>()
                    .join(","),
            }
        })
        .collect::<Vec<_>>();
    // The text alternative: about 12 rows across the range.
    let every = samples.len().div_ceil(12).max(1);
    let table = samples
        .iter()
        .rev()
        .step_by(every)
        .take(12)
        .map(|s| {
            let mut row = vec![ago(now - s.t)];
            row.extend(series.iter().map(|spec| unit.format((spec.value)(s))));
            row
        })
        .collect();
    let mut table_head = vec!["When"];
    table_head.extend(series.iter().map(|s| s.name));
    let summary = if samples.is_empty() {
        format!("{title}: no data yet")
    } else {
        let parts: Vec<String> = lines
            .iter()
            .map(|l| {
                let peak = samples
                    .iter()
                    .map(|s| {
                        series
                            .iter()
                            .find(|sp| sp.name == l.name)
                            .map_or(0.0, |sp| (sp.value)(s))
                    })
                    .fold(0.0, f64::max);
                format!("{} now {}, peak {}", l.name, l.last, unit.format(peak))
            })
            .collect();
        format!("{title}: {}", parts.join("; "))
    };
    ChartView {
        key,
        title,
        summary,
        w: W,
        h: H,
        x0: format!("{LEFT:.1}"),
        x1: format!("{:.1}", f64::from(W) - RIGHT),
        y0: format!("{TOP:.1}"),
        y1: format!("{:.1}", TOP + ph),
        grid,
        xticks,
        lines,
        table_head,
        table,
        empty: samples.is_empty(),
        t0: samples.first().map_or(now, |s| s.t),
        step: samples
            .get(1)
            .zip(samples.first())
            .map_or(1, |(b, a)| (b.t - a.t).max(1)),
        unit: match unit {
            Unit::Bytes => "bytes",
            Unit::Percent => "percent",
            Unit::PerSecond => "rate",
            Unit::Micros => "micros",
            Unit::Count => "count",
        },
    }
}

/// Series colors per chart: errors are amber and red, everything else starts with the accent.
fn palette(key: &str) -> [&'static str; 4] {
    match key {
        "errors" => ["s3", "s4", "s1", "s2"],
        "latency" => ["s2", "s1", "s4", "s3"],
        _ => ["s1", "s2", "s3", "s4"],
    }
}

/// A sparkline for an overview card (viewBox 0 0 120 32).
pub struct Spark {
    pub d: String,
    pub area: String,
}

pub fn sparkline(values: &[f64]) -> Spark {
    let max = nice_ceiling(values.iter().copied().fold(0.0, f64::max));
    let n = values.len().max(2) - 1;
    let mut d = String::new();
    for (i, v) in values.iter().enumerate() {
        let x = i as f64 * 120.0 / n as f64;
        let y = 30.0 - (v / max).clamp(0.0, 1.0) * 28.0;
        d.push_str(&format!("{}{x:.1},{y:.1}", if i == 0 { 'M' } else { 'L' }));
    }
    let area = if values.is_empty() {
        String::new()
    } else {
        format!(
            "{d}L{:.1},32L0,32Z",
            (values.len() - 1) as f64 * 120.0 / n as f64
        )
    };
    Spark { d, area }
}

/// A bar chart of values (oldest first) in a 0 0 W H viewBox: (x, y, width, height, class).
pub struct Bar {
    pub x: String,
    pub y: String,
    pub w: String,
    pub h: String,
    pub class: &'static str,
    pub label: String,
}

/// Bars for a trend: each value with its class (`ok`, `bad`, `warn`), scaled to the largest.
pub fn bars(values: &[(f64, &'static str, String)], w: f64, h: f64) -> Vec<Bar> {
    let max = nice_ceiling(values.iter().map(|v| v.0).fold(0.0, f64::max));
    let n = values.len().max(1) as f64;
    let slot = w / n;
    values
        .iter()
        .enumerate()
        .map(|(i, (v, class, label))| {
            let bh = (v / max).clamp(0.0, 1.0) * (h - 2.0);
            Bar {
                x: format!("{:.1}", i as f64 * slot + slot * 0.15),
                y: format!("{:.1}", h - bh),
                w: format!("{:.1}", slot * 0.7),
                h: format!("{:.1}", bh.max(1.0)),
                class,
                label: label.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axes_round_up_to_nice_numbers() {
        assert_eq!(nice_ceiling(0.0), 1.0);
        assert_eq!(nice_ceiling(7.0), 10.0);
        assert_eq!(nice_ceiling(180.0), 200.0);
        assert_eq!(nice_ceiling(2_100.0), 2_500.0);
        assert_eq!(nice_ceiling(42_000_000.0), 50_000_000.0);
    }

    #[test]
    fn a_chart_has_a_text_alternative_and_stays_in_its_box() {
        let samples: Vec<Sample> = (0..60)
            .map(|t| Sample {
                t: 1_000 + t,
                req: (t % 7) as f32,
                ..Sample::default()
            })
            .collect();
        let c = line_chart(
            "req",
            "Requests",
            Unit::PerSecond,
            &samples,
            &[SeriesSpec {
                name: "req/s",
                value: |s| f64::from(s.req),
            }],
            60,
            1_060,
        );
        assert!(!c.empty);
        assert!(c.summary.contains("req/s now"), "{}", c.summary);
        assert!(c.table.len() <= 12 && !c.table.is_empty());
        assert_eq!(c.table_head, ["When", "req/s"]);
        for num in c.lines[0]
            .d
            .split(['M', 'L', ','])
            .filter(|s| !s.is_empty())
        {
            let v: f64 = num.parse().unwrap();
            assert!((0.0..=f64::from(W)).contains(&v), "{v}");
        }
        assert_eq!(downsample(&samples, 10).len(), 10);
    }
}
