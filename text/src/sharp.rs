//! Glyph outlines drawn sharp: smoothed coverage through a steep curve, so a
//! letter is mostly solid pixels with a thin soft rim, close to the game's
//! bitmap font and still smooth where a stroke is thinner than a pixel.
//!
//! Coverage is a pixel's share inside the outline (nonzero winding), exact
//! along rows and sampled at [`COVER_ROWS`] lines down them. A quarter or less
//! is clear, three quarters or more solid, and the half between ramps
//! (`STEEP_FROM`, `STEEP_TO`). Plain smoothing at the game's size blurs Thai;
//! whole pixels alone (ink or not) lose details thinner than a pixel, such as
//! the tick that tells ซ from ช. The curve keeps those as a faint pixel.

use swash::scale::outline::Outline;
use swash::zeno::{Command, PathData as _};

/// Straight segments each curve is split into.
const CURVE_STEPS: u32 = 8;
/// Rows sampled per pixel.
const COVER_ROWS: usize = 4;
/// Coverage at or under this is clear.
const STEEP_FROM: f32 = 0.25;
/// Coverage at or over this is solid.
const STEEP_TO: f32 = 0.75;

/// A glyph's mask: `width * height` coverage bytes, its top-left pixel at
/// (`left`, `top`) in the layout's pixel grid.
pub(crate) struct Mask {
    pub left: i32,
    pub top: i32,
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

/// `outline` (pixels, y up, the pen at the origin) with its pen at (`pen_x`,
/// `pen_y`) of the layout's grid (y down), drawn sharp. `None` when it covers
/// nothing. `max_pixels` bounds the mask's area.
pub(crate) fn rasterize(
    outline: &Outline,
    pen_x: f32,
    pen_y: f32,
    max_pixels: usize,
) -> Option<Mask> {
    let segments = segments(outline, pen_x, pen_y);
    if segments.is_empty() {
        return None;
    }
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for s in &segments {
        x0 = x0.min(s[0]).min(s[2]);
        x1 = x1.max(s[0]).max(s[2]);
        y0 = y0.min(s[1]).min(s[3]);
        y1 = y1.max(s[1]).max(s[3]);
    }
    if ![x0, y0, x1, y1].iter().all(|v| v.is_finite()) {
        return None;
    }
    let left = x0.floor() as i32;
    let top = y0.floor() as i32;
    let width = (x1.ceil() as i32 - left).max(0) as usize;
    let height = (y1.ceil() as i32 - top).max(0) as usize;
    if width == 0 || height == 0 || width.checked_mul(height)? > max_pixels {
        return None;
    }
    let data: Vec<u8> = coverage(&segments, left, top, width, height)
        .into_iter()
        .map(|c| {
            (((c - STEEP_FROM) / (STEEP_TO - STEEP_FROM)).clamp(0.0, 1.0) * 255.0).round() as u8
        })
        .collect();
    data.iter().any(|&v| v != 0).then_some(Mask {
        left,
        top,
        width,
        height,
        data,
    })
}

/// Each pixel's share covered by the outline.
fn coverage(segments: &[[f32; 4]], left: i32, top: i32, width: usize, height: usize) -> Vec<f32> {
    let mut cover = vec![0.0f32; width * height];
    for y in 0..height {
        for k in 0..COVER_ROWS {
            let at = (top + y as i32) as f32 + (k as f32 + 0.5) / COVER_ROWS as f32;
            for [start, end] in inside(segments, at) {
                let first = (start.floor() as i32).max(left);
                let last = (end.ceil() as i32 - 1).min(left + width as i32 - 1);
                for column in first..=last {
                    let x = column as f32;
                    let share = end.min(x + 1.0) - start.max(x);
                    if share > 0.0 {
                        cover[y * width + (column - left) as usize] += share / COVER_ROWS as f32;
                    }
                }
            }
        }
    }
    for c in &mut cover {
        *c = c.min(1.0);
    }
    cover
}

/// The outline as straight segments `[x0, y0, x1, y1]` on the layout's grid.
fn segments(outline: &Outline, pen_x: f32, pen_y: f32) -> Vec<[f32; 4]> {
    let at = |x: f32, y: f32| [pen_x + x, pen_y - y];
    let mut out = Vec::new();
    let mut start = [0.0f32; 2];
    let mut pen = [0.0f32; 2];
    let close = |out: &mut Vec<[f32; 4]>, pen: [f32; 2], start: [f32; 2]| {
        if pen != start {
            out.push([pen[0], pen[1], start[0], start[1]]);
        }
    };
    for command in outline.path().commands() {
        match command {
            Command::MoveTo(p) => {
                close(&mut out, pen, start);
                start = at(p.x, p.y);
                pen = start;
            }
            Command::LineTo(p) => {
                let end = at(p.x, p.y);
                out.push([pen[0], pen[1], end[0], end[1]]);
                pen = end;
            }
            Command::QuadTo(c, p) => {
                let (c, p) = (at(c.x, c.y), at(p.x, p.y));
                let from = pen;
                for step in 1..=CURVE_STEPS {
                    let t = step as f32 / CURVE_STEPS as f32;
                    let u = 1.0 - t;
                    let end = [
                        u * u * from[0] + 2.0 * u * t * c[0] + t * t * p[0],
                        u * u * from[1] + 2.0 * u * t * c[1] + t * t * p[1],
                    ];
                    out.push([pen[0], pen[1], end[0], end[1]]);
                    pen = end;
                }
            }
            Command::CurveTo(c1, c2, p) => {
                let (c1, c2, p) = (at(c1.x, c1.y), at(c2.x, c2.y), at(p.x, p.y));
                let from = pen;
                for step in 1..=CURVE_STEPS {
                    let t = step as f32 / CURVE_STEPS as f32;
                    let u = 1.0 - t;
                    let mix = |a: f32, b: f32, c: f32, d: f32| {
                        u * u * u * a + 3.0 * u * u * t * b + 3.0 * u * t * t * c + t * t * t * d
                    };
                    let end = [
                        mix(from[0], c1[0], c2[0], p[0]),
                        mix(from[1], c1[1], c2[1], p[1]),
                    ];
                    out.push([pen[0], pen[1], end[0], end[1]]);
                    pen = end;
                }
            }
            Command::Close => {
                close(&mut out, pen, start);
                pen = start;
            }
        }
    }
    close(&mut out, pen, start);
    out
}

/// Where the row line at `y = at` runs inside the outline by the nonzero
/// rule, as `[start, end]` spans along it, in order.
fn inside(segments: &[[f32; 4]], at: f32) -> Vec<[f32; 2]> {
    let mut crossings: Vec<(f32, i32)> = Vec::new();
    for &[x0, y0, x1, y1] in segments {
        if (y0 <= at && at < y1) || (y1 <= at && at < y0) {
            let x = x0 + (at - y0) * (x1 - x0) / (y1 - y0);
            crossings.push((x, if y1 > y0 { 1 } else { -1 }));
        }
    }
    crossings.sort_by(|p, q| p.0.total_cmp(&q.0));
    let mut spans = Vec::new();
    let mut winding = 0;
    let mut start = 0.0;
    for (x, direction) in crossings {
        if winding == 0 {
            start = x;
        }
        winding += direction;
        if winding == 0 {
            spans.push([start, x]);
        }
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::*;
    use swash::FontRef;
    use swash::scale::ScaleContext;

    const THAI: &[u8] = include_bytes!("../../assets/fonts/NotoSansThai-VF.ttf");

    /// The mask of `c` in Noto Sans Thai at Thai's game size and weight
    /// (THAI_SIZE_RATIO in lib.rs), its pen at (`x`, 12.0).
    fn mask_of(c: char, x: f32) -> Mask {
        let font = FontRef::from_index(THAI, 0).unwrap();
        let mut context = ScaleContext::new();
        let mut scaler = context
            .builder(font)
            .size(14.0)
            .variations([("wght", 600.0)].iter().copied())
            .build();
        let outline = scaler.scale_outline(font.charmap().map(c)).unwrap();
        rasterize(&outline, x, 12.0, 4096).unwrap()
    }

    /// Ink one mask has and the other lacks, in pixels: the summed coverage
    /// difference, the two aligned at their pens.
    fn difference(a: &Mask, b: &Mask) -> f32 {
        let at = |m: &Mask, x: i32, y: i32| {
            let (x, y) = (x - m.left, y - m.top);
            if x < 0 || y < 0 || x as usize >= m.width || y as usize >= m.height {
                0.0
            } else {
                f32::from(m.data[y as usize * m.width + x as usize]) / 255.0
            }
        };
        let (l, t) = (a.left.min(b.left), a.top.min(b.top));
        let r = (a.left + a.width as i32).max(b.left + b.width as i32);
        let bottom = (a.top + a.height as i32).max(b.top + b.height as i32);
        let mut sum = 0.0;
        for y in t..bottom {
            for x in l..r {
                sum += (at(a, x, y) - at(b, x, y)).abs();
            }
        }
        sum
    }

    #[test]
    fn edges_are_steep() {
        // most ink is solid; the soft rim is the smaller part
        for c in "สวัดีกม".chars() {
            let mask = mask_of(c, 0.3);
            let solid = mask.data.iter().filter(|&&v| v == 255).count();
            let soft = mask.data.iter().filter(|&&v| v != 0 && v != 255).count();
            assert!(solid > soft, "{c}: {solid} solid, {soft} soft");
        }
    }

    #[test]
    fn letters_told_apart_by_thin_strokes_stay_apart() {
        // Pairs the loopless Noto Sans Thai tells apart by a hook, tail or
        // tick thinner than a pixel at the game's size, and the ink (in
        // pixels) each must differ by at every pen phase, a little under what
        // it measured (23 November 2026). A plain threshold of smoothed
        // coverage drew ส as ล; whole pixels at 13.4 px drew ซ as ช (0).
        let pairs = [
            ('ส', 'ล', 1.5),
            ('ม', 'บ', 4.0),
            ('ก', 'ค', 6.0),
            ('ก', 'ถ', 1.25),
            ('ด', 'ค', 6.0),
            ('บ', 'ป', 3.5),
            ('ซ', 'ช', 3.0),
            ('ผ', 'ฝ', 3.0),
            ('พ', 'ฟ', 5.0),
            ('ภ', 'ถ', 4.0),
            ('อ', 'ฮ', 1.5),
        ];
        for (a, b, fewest) in pairs {
            for phase in [0.0, 0.25, 0.5, 0.75] {
                let d = difference(&mask_of(a, phase), &mask_of(b, phase));
                assert!(d >= fewest, "{a} {b} at {phase}: {d}");
            }
        }
    }

    #[test]
    fn counters_stay_open() {
        // อ's body is a ring: some pixel inside it is mostly clear
        let mask = mask_of('อ', 0.0);
        let open = (0..mask.height).any(|y| {
            let row = &mask.data[y * mask.width..(y + 1) * mask.width];
            let first = row.iter().position(|&v| v >= 128);
            let last = row.iter().rposition(|&v| v >= 128);
            matches!((first, last), (Some(f), Some(l)) if row[f..l].iter().any(|&v| v < 128))
        });
        assert!(open);
    }
}
