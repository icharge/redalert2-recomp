use std::{
    collections::HashMap,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::Arc,
};

use fontique::{Blob, Collection, CollectionOptions, FontInfoOverride, SourceCache};
use parley::{
    Alignment, AlignmentOptions, FontContext, FontFamilyName, FontWeight, FontWidth, Layout,
    LayoutContext, LineHeight, PositionedLayoutItem, StyleProperty,
};
use swash::{
    FontRef,
    scale::{image::Content, outline::Outline, *},
    zeno::Format,
};

const MAX_TEXT_UNITS: usize = 16 * 1024;
const MAX_FONT_BYTES: usize = 128 * 1024 * 1024;
const MAX_DIMENSION: u32 = 16 * 1024;
const MAX_MASK_PIXELS: usize = 16 * 1024 * 1024;

#[cfg(test)]
thread_local! {
    static RASTER_GLYPH_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[repr(C)]
pub struct RA2TextEngine {
    fonts: FontContext,
    layout_cx: LayoutContext<()>,
    families: HashMap<u32, String>,
    next_font_id: u32,
}

#[repr(C)]
pub struct RA2TextLayout {
    metrics: RA2TextMetrics,
    width: u32,
    height: u32,
    mask_origin_x: i32,
    mask_origin_y: i32,
    mask: Vec<u8>,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct RA2TextMetrics {
    pub advance_x: f32,
    pub advance_y: f32,
    pub width: f32,
    pub height: f32,
    pub baseline: f32,
    pub ink_x: i32,
    pub ink_y: i32,
    pub ink_width: u32,
    pub ink_height: u32,
}

#[repr(i32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Status {
    Ok = 0,
    InvalidArgument = 1,
    InvalidFont = 2,
    LimitExceeded = 3,
    InternalError = 4,
}

const FONT_LATIN: &[u8] = include_bytes!("../../assets/fonts/NotoSans-VF.ttf");
const FONT_THAI: &[u8] = include_bytes!("../../assets/fonts/NotoSansThai-VF.ttf");
const FONT_ARABIC: &[u8] = include_bytes!("../../assets/fonts/NotoSansArabicUI-VF.ttf");
const FONT_CJK: &[u8] = include_bytes!("../../assets/fonts/NotoSansCJKsc-Regular.otf");

impl RA2TextEngine {
    fn new() -> Self {
        let mut collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        });
        let mut families = HashMap::new();
        let mut id = 1;
        for bytes in [FONT_LATIN, FONT_THAI, FONT_ARABIC, FONT_CJK] {
            if let Some(name) = register_font(&mut collection, bytes, None) {
                families.insert(id, name);
                id += 1;
            }
        }
        Self {
            fonts: FontContext {
                collection,
                source_cache: SourceCache::default(),
            },
            layout_cx: LayoutContext::new(),
            families,
            next_font_id: id,
        }
    }
}

fn register_font(
    collection: &mut Collection,
    bytes: &[u8],
    family_override: Option<&str>,
) -> Option<String> {
    let font_ref = FontRef::from_index(bytes, 0)?;
    if !ScaleContext::new()
        .builder(font_ref)
        .size(16.0)
        .build()
        .has_outlines()
    {
        return None;
    }
    let copied = Arc::new(bytes.to_vec());
    let info_override = family_override.map(|name| FontInfoOverride {
        family_name: Some(name),
        ..FontInfoOverride::default()
    });
    let registrations = collection.register_fonts(Blob::new(copied), info_override);
    let family_id = registrations.first()?.0;
    collection.family_name(family_id).map(str::to_owned)
}

fn status_boundary<T>(fallback: T, f: impl FnOnce() -> T) -> T {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or(fallback)
}

fn make_layout(
    engine: &mut RA2TextEngine,
    preferred_font_id: u32,
    text: &[u16],
    font_size_px: f32,
    wrap_width_px: f32,
    line_height_px: f32,
    alignment: u32,
    font_weight: f32,
    font_width: f32,
) -> Result<RA2TextLayout, Status> {
    if text.len() > MAX_TEXT_UNITS
        || !font_size_px.is_finite()
        || !(1.0..=512.0).contains(&font_size_px)
        || !wrap_width_px.is_finite()
        || wrap_width_px < 0.0
        || !line_height_px.is_finite()
        || line_height_px < 0.0
        || line_height_px > 1024.0
        || !font_weight.is_finite()
        || !(0.0..=1000.0).contains(&font_weight)
        || !font_width.is_finite()
        || !(0.1..=2.0).contains(&font_width)
        || alignment > 2
    {
        return Err(Status::LimitExceeded);
    }
    if wrap_width_px > MAX_DIMENSION as f32 {
        return Err(Status::LimitExceeded);
    }
    let preferred = if preferred_font_id == 0 {
        None
    } else {
        Some(
            engine
                .families
                .get(&preferred_font_id)
                .ok_or(Status::InvalidFont)?
                .as_str(),
        )
    };
    let decoded = String::from_utf16_lossy(text);
    if decoded.is_empty() {
        return Ok(RA2TextLayout {
            metrics: RA2TextMetrics::default(),
            width: 0,
            height: 0,
            mask_origin_x: 0,
            mask_origin_y: 0,
            mask: Vec::new(),
        });
    }
    let mut family_names = Vec::with_capacity(5);
    if let Some(family) = preferred {
        family_names.push(FontFamilyName::named(family));
    }
    family_names.extend([
        FontFamilyName::named("Noto Sans"),
        FontFamilyName::named("Noto Sans Thai"),
        FontFamilyName::named("Noto Sans Arabic UI"),
        FontFamilyName::named("Noto Sans CJK SC"),
    ]);
    let mut builder = engine
        .layout_cx
        .ranged_builder(&mut engine.fonts, &decoded, 1.0, true);
    builder.push_default(family_names.as_slice());
    builder.push_default(StyleProperty::FontSize(font_size_px));
    if line_height_px > 0.0 {
        builder.push_default(LineHeight::Absolute(line_height_px));
    }
    if font_weight > 0.0 {
        builder.push_default(StyleProperty::FontWeight(FontWeight::new(font_weight)));
    }
    builder.push_default(StyleProperty::FontWidth(FontWidth::from_ratio(font_width)));
    let mut layout: Layout<()> = builder.build(&decoded);
    layout.break_all_lines(if wrap_width_px == 0.0 {
        None
    } else {
        Some(wrap_width_px)
    });
    let alignment = match alignment {
        1 => Alignment::Center,
        2 => Alignment::Right,
        _ => Alignment::Left,
    };
    layout.align(
        alignment,
        AlignmentOptions {
            align_when_overflowing: true,
            ..AlignmentOptions::default()
        },
    );

    let width = layout.width().ceil().max(0.0) as u32;
    let height = layout.height().ceil().max(0.0) as u32;
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or(Status::LimitExceeded)?;
    if width > MAX_DIMENSION || height > MAX_DIMENSION || pixels > MAX_MASK_PIXELS {
        return Err(Status::LimitExceeded);
    }
    let (mask_origin_x, mask_origin_y, mask_width, mask_height, mask, ink_bounds) =
        raster_layout(&layout, width, height)?;
    let line = layout.lines().next();
    let baseline = line.map(|l| l.metrics().baseline).unwrap_or(0.0);
    let (ink_x, ink_y, ink_width, ink_height) =
        if let Some((ink_min_x, ink_min_y, ink_max_x, ink_max_y)) = ink_bounds {
            (
                ink_min_x,
                ink_min_y,
                (ink_max_x - ink_min_x) as u32,
                (ink_max_y - ink_min_y) as u32,
            )
        } else {
            (0, 0, 0, 0)
        };
    Ok(RA2TextLayout {
        metrics: RA2TextMetrics {
            advance_x: layout.width(),
            advance_y: 0.0,
            width: layout.width(),
            height: layout.height(),
            baseline,
            ink_x,
            ink_y,
            ink_width,
            ink_height,
        },
        width: mask_width,
        height: mask_height,
        mask_origin_x,
        mask_origin_y,
        mask,
    })
}

struct GlyphBitmap {
    left: i32,
    top: i32,
    width: usize,
    height: usize,
    data: Vec<u8>,
}

fn render_glyph(
    renderer: &Render<'_>,
    scaler: &mut Scaler,
    glyph_id: u16,
    image: &mut swash::scale::image::Image,
) -> bool {
    #[cfg(test)]
    RASTER_GLYPH_CALLS.with(|calls| calls.set(calls.get() + 1));
    image.clear();
    renderer.render_into(scaler, glyph_id, image)
}

fn preflight_outline_bounds(
    bounds: swash::zeno::Bounds,
    remaining_pixels: usize,
) -> Result<usize, Status> {
    if bounds.is_empty() {
        return Ok(0);
    }
    let coords = [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y];
    if !coords.iter().all(|coord| coord.is_finite()) {
        return Err(Status::LimitExceeded);
    }
    // This matches Zeno's floor(min)/ceil(max) mask bounds. The outline bounds
    // enclose every path point, so this is a safe upper bound for raster output.
    let width = (bounds.max.x.ceil() - bounds.min.x.floor()).max(0.0);
    let height = (bounds.max.y.ceil() - bounds.min.y.floor()).max(0.0);
    if width > MAX_DIMENSION as f32 || height > MAX_DIMENSION as f32 {
        return Err(Status::LimitExceeded);
    }
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or(Status::LimitExceeded)?;
    if pixels > remaining_pixels {
        return Err(Status::LimitExceeded);
    }
    Ok(pixels)
}

fn raster_layout(
    layout: &Layout<()>,
    logical_width: u32,
    logical_height: u32,
) -> Result<(i32, i32, u32, u32, Vec<u8>, Option<(i32, i32, i32, i32)>), Status> {
    let mut scale_context = ScaleContext::new();
    let mut image = swash::scale::image::Image::new();
    let mut glyphs = Vec::new();
    let mut glyph_pixel_count = 0usize;
    let mut ink_min_x = i32::MAX;
    let mut ink_min_y = i32::MAX;
    let mut ink_max_x = i32::MIN;
    let mut ink_max_y = i32::MIN;
    for line in layout.lines() {
        for item in line.items() {
            let PositionedLayoutItem::GlyphRun(run) = item else {
                continue;
            };
            let font = run.run().font();
            let font_ref = FontRef::from_index(font.data.data(), font.index as usize)
                .ok_or(Status::InvalidFont)?;
            let coords = run.run().normalized_coords();
            let mut scaler_builder = scale_context
                .builder(font_ref)
                .size(run.run().font_size())
                .hint(true);
            if !coords.is_empty() {
                scaler_builder =
                    scaler_builder.normalized_coords(coords.iter().map(|c| c.to_bits()));
            }
            let mut scaler = scaler_builder.build();
            let mut outline = Outline::new();
            // Bitmap-only glyphs are unsupported: the Outline-only source keeps
            // all raster allocations preceded by the bounds preflight below.
            let mut renderer = Render::new(&[Source::Outline]);
            renderer.format(Format::Alpha);
            for glyph in run.positioned_glyphs() {
                let glyph_id = glyph.id as u16;
                if !scaler.scale_outline_into(glyph_id, &mut outline) {
                    continue;
                }
                let remaining_pixels = MAX_MASK_PIXELS.saturating_sub(glyph_pixel_count);
                let max_glyph_pixels =
                    preflight_outline_bounds(outline.bounds(), remaining_pixels)?;
                if !render_glyph(&renderer, &mut scaler, glyph_id, &mut image)
                    || image.content != Content::Mask
                {
                    continue;
                }
                let left = glyph.x.floor() as i32 + image.placement.left;
                let top = glyph.y.floor() as i32 - image.placement.top;
                let gw = image.placement.width as usize;
                let gh = image.placement.height as usize;
                let Some(glyph_pixels) = gw.checked_mul(gh) else {
                    return Err(Status::LimitExceeded);
                };
                let Some(total_glyph_pixels) = glyph_pixel_count.checked_add(glyph_pixels) else {
                    return Err(Status::LimitExceeded);
                };
                if image.data.len() < glyph_pixels {
                    return Err(Status::InternalError);
                }
                if glyph_pixels > max_glyph_pixels || total_glyph_pixels > MAX_MASK_PIXELS {
                    return Err(Status::LimitExceeded);
                }
                glyph_pixel_count = total_glyph_pixels;
                for gy in 0..gh {
                    for gx in 0..gw {
                        if image.data[gy * gw + gx] != 0 {
                            let x = left + gx as i32;
                            let y = top + gy as i32;
                            ink_min_x = ink_min_x.min(x);
                            ink_min_y = ink_min_y.min(y);
                            ink_max_x = ink_max_x.max(x + 1);
                            ink_max_y = ink_max_y.max(y + 1);
                        }
                    }
                }
                glyphs.push(GlyphBitmap {
                    left,
                    top,
                    width: gw,
                    height: gh,
                    data: image.data.clone(),
                });
            }
        }
    }
    let ink = (ink_min_x != i32::MAX).then_some((ink_min_x, ink_min_y, ink_max_x, ink_max_y));
    let min_x = ink.map_or(0, |b| b.0.min(0));
    let min_y = ink.map_or(0, |b| b.1.min(0));
    let max_x = ink.map_or(logical_width as i32, |b| b.2.max(logical_width as i32));
    let max_y = ink.map_or(logical_height as i32, |b| b.3.max(logical_height as i32));
    let width = (max_x - min_x) as u32;
    let height = (max_y - min_y) as u32;
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or(Status::LimitExceeded)?;
    if width > MAX_DIMENSION || height > MAX_DIMENSION || pixels > MAX_MASK_PIXELS {
        return Err(Status::LimitExceeded);
    }
    let mut mask = vec![0; pixels];
    for glyph in glyphs {
        for y in 0..glyph.height {
            for x in 0..glyph.width {
                let dx = glyph.left + x as i32 - min_x;
                let dy = glyph.top + y as i32 - min_y;
                if dx >= 0 && dy >= 0 && dx < width as i32 && dy < height as i32 {
                    let alpha = glyph.data[y * glyph.width + x];
                    let pixel = &mut mask[dy as usize * width as usize + dx as usize];
                    *pixel = (*pixel).max(alpha);
                }
            }
        }
    }
    Ok((min_x, min_y, width, height, mask, ink))
}

#[unsafe(no_mangle)]
pub extern "C" fn ra2_text_engine_create() -> *mut RA2TextEngine {
    status_boundary(std::ptr::null_mut(), || {
        Box::into_raw(Box::new(RA2TextEngine::new()))
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ra2_text_engine_destroy(engine: *mut RA2TextEngine) {
    status_boundary((), || {
        if !engine.is_null() {
            unsafe {
                drop(Box::from_raw(engine));
            }
        }
    });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ra2_text_engine_add_font(
    engine: *mut RA2TextEngine,
    font_bytes: *const u8,
    font_byte_len: usize,
    out_font_id: *mut u32,
) -> i32 {
    status_boundary(Status::InternalError as i32, || {
        if engine.is_null() || font_bytes.is_null() || out_font_id.is_null() || font_byte_len == 0 {
            return Status::InvalidArgument as i32;
        }
        if font_byte_len > MAX_FONT_BYTES {
            return Status::LimitExceeded as i32;
        }
        let engine = unsafe { &mut *engine };
        let bytes = unsafe { std::slice::from_raw_parts(font_bytes, font_byte_len) };
        let font_id = engine.next_font_id;
        let family_override = format!("RA2 Caller Font {font_id}");
        let Some(family) =
            register_font(&mut engine.fonts.collection, bytes, Some(&family_override))
        else {
            return Status::InvalidFont as i32;
        };
        let id = font_id;
        engine.next_font_id = engine.next_font_id.wrapping_add(1).max(1);
        engine.families.insert(id, family);
        unsafe {
            *out_font_id = id;
        }
        Status::Ok as i32
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ra2_text_layout_utf16(
    engine: *mut RA2TextEngine,
    preferred_font_id: u32,
    text: *const u16,
    text_code_units: usize,
    font_size_px: f32,
    wrap_width_px: f32,
    out_layout: *mut *mut RA2TextLayout,
) -> i32 {
    unsafe {
        ra2_text_layout_utf16_ex(
            engine,
            preferred_font_id,
            text,
            text_code_units,
            font_size_px,
            wrap_width_px,
            0.0,
            0,
            0.0,
            1.0,
            out_layout,
        )
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ra2_text_layout_utf16_ex(
    engine: *mut RA2TextEngine,
    preferred_font_id: u32,
    text: *const u16,
    text_code_units: usize,
    font_size_px: f32,
    wrap_width_px: f32,
    line_height_px: f32,
    alignment: u32,
    font_weight: f32,
    font_width_ratio: f32,
    out_layout: *mut *mut RA2TextLayout,
) -> i32 {
    status_boundary(Status::InternalError as i32, || {
        if engine.is_null() || out_layout.is_null() || (text.is_null() && text_code_units != 0) {
            return Status::InvalidArgument as i32;
        }
        unsafe {
            *out_layout = std::ptr::null_mut();
        }
        if text_code_units > MAX_TEXT_UNITS {
            return Status::LimitExceeded as i32;
        }
        let input = if text_code_units == 0 {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(text, text_code_units) }
        };
        let result = make_layout(
            unsafe { &mut *engine },
            preferred_font_id,
            input,
            font_size_px,
            wrap_width_px,
            line_height_px,
            alignment,
            font_weight,
            font_width_ratio,
        );
        match result {
            Ok(layout) => {
                unsafe {
                    *out_layout = Box::into_raw(Box::new(layout));
                }
                Status::Ok as i32
            }
            Err(status) => status as i32,
        }
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ra2_text_layout_get_metrics(
    layout: *const RA2TextLayout,
    out_metrics: *mut RA2TextMetrics,
) -> i32 {
    status_boundary(Status::InternalError as i32, || {
        if layout.is_null() || out_metrics.is_null() {
            return Status::InvalidArgument as i32;
        }
        unsafe {
            *out_metrics = (*layout).metrics;
        }
        Status::Ok as i32
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ra2_text_layout_render_mask(
    layout: *const RA2TextLayout,
    dst: *mut u8,
    dst_width: u32,
    dst_height: u32,
    row_pitch: usize,
    origin_x: i32,
    origin_y: i32,
) -> i32 {
    status_boundary(Status::InternalError as i32, || {
        if layout.is_null()
            || (dst.is_null() && dst_width != 0 && dst_height != 0)
            || row_pitch < dst_width as usize
        {
            return Status::InvalidArgument as i32;
        }
        if dst_width == 0 || dst_height == 0 {
            return Status::Ok as i32;
        }
        let Some(rows_before_last) = (dst_height as usize).checked_sub(1) else {
            return Status::InvalidArgument as i32;
        };
        let Some(prefix_bytes) = rows_before_last.checked_mul(row_pitch) else {
            return Status::LimitExceeded as i32;
        };
        let Some(required_bytes) = prefix_bytes.checked_add(dst_width as usize) else {
            return Status::LimitExceeded as i32;
        };
        if required_bytes > MAX_MASK_PIXELS * 4 {
            return Status::LimitExceeded as i32;
        }
        let layout = unsafe { &*layout };
        let out = unsafe { std::slice::from_raw_parts_mut(dst, required_bytes) };
        let mask_x = origin_x as i64 + layout.mask_origin_x as i64;
        let mask_y = origin_y as i64 + layout.mask_origin_y as i64;
        let left = mask_x.max(0);
        let top = mask_y.max(0);
        let right = (mask_x + layout.width as i64).min(dst_width as i64).max(0);
        let bottom = (mask_y + layout.height as i64)
            .min(dst_height as i64)
            .max(0);
        if left >= right || top >= bottom {
            return Status::Ok as i32;
        }
        for y in top..bottom {
            let source_y = (y - mask_y) as usize;
            for x in left..right {
                let source_x = (x - mask_x) as usize;
                let coverage = layout.mask[source_y * layout.width as usize + source_x];
                let pixel = &mut out[y as usize * row_pitch + x as usize];
                *pixel = (*pixel).max(coverage);
            }
        }
        Status::Ok as i32
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ra2_text_layout_destroy(layout: *mut RA2TextLayout) {
    status_boundary((), || {
        if !layout.is_null() {
            unsafe {
                drop(Box::from_raw(layout));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shaped_glyph_ids(text: &str) -> Vec<u32> {
        let mut engine = RA2TextEngine::new();
        let family_names = [
            FontFamilyName::named("Noto Sans"),
            FontFamilyName::named("Noto Sans Thai"),
            FontFamilyName::named("Noto Sans Arabic UI"),
            FontFamilyName::named("Noto Sans CJK SC"),
        ];
        let mut builder = engine
            .layout_cx
            .ranged_builder(&mut engine.fonts, text, 1.0, true);
        builder.push_default(family_names.as_slice());
        builder.push_default(StyleProperty::FontSize(24.0));
        let mut layout: Layout<()> = builder.build(text);
        layout.break_all_lines(None);
        layout.align(Alignment::Left, AlignmentOptions::default());
        let mut glyph_ids = Vec::new();
        for line in layout.lines() {
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(run) = item {
                    glyph_ids.extend(run.glyphs().map(|glyph| glyph.id));
                }
            }
        }
        glyph_ids
    }

    #[test]
    fn reusing_image_does_not_carry_coverage_from_a_previous_glyph() {
        let font = FontRef::from_index(FONT_LATIN, 0).unwrap();
        let glyph_a = font.charmap().map('A');
        let glyph_w = font.charmap().map('W');
        let mut scale_context = ScaleContext::new();
        let mut scaler = scale_context.builder(font).size(48.0).hint(true).build();
        let mut renderer = Render::new(&[Source::Outline]);
        renderer.format(Format::Alpha);

        let mut reused = swash::scale::image::Image::new();
        assert!(render_glyph(&renderer, &mut scaler, glyph_a, &mut reused));
        assert!(render_glyph(&renderer, &mut scaler, glyph_w, &mut reused));
        let reused_glyph_w = reused.clone();

        let mut fresh = swash::scale::image::Image::new();
        assert!(render_glyph(&renderer, &mut scaler, glyph_w, &mut fresh));
        assert_eq!(reused_glyph_w.placement.left, fresh.placement.left);
        assert_eq!(reused_glyph_w.placement.top, fresh.placement.top);
        assert_eq!(reused_glyph_w.placement.width, fresh.placement.width);
        assert_eq!(reused_glyph_w.placement.height, fresh.placement.height);
        assert_eq!(reused_glyph_w.data, fresh.data);
    }

    #[test]
    fn oversized_fixture_outline_fails_raster_preflight_with_small_advance() {
        let bytes = include_bytes!("../tests/fixtures/oversized_outline.ttf");
        let font = FontRef::from_index(bytes, 0).unwrap();
        let glyph = font.charmap().map('A');
        let mut context = ScaleContext::new();
        let mut scaler = context.builder(font).size(512.0).hint(true).build();
        let mut outline = Outline::new();
        assert!(scaler.scale_outline_into(glyph, &mut outline));
        assert!(outline.bounds().width() < 16_384.0);
        assert!(outline.bounds().height() < 16_384.0);
        assert_eq!(
            preflight_outline_bounds(outline.bounds(), MAX_MASK_PIXELS),
            Err(Status::LimitExceeded)
        );
    }

    #[test]
    fn oversized_public_layout_is_rejected_before_renderer_invocation() {
        RASTER_GLYPH_CALLS.with(|calls| calls.set(0));
        let engine = ra2_text_engine_create();
        let bytes = include_bytes!("../tests/fixtures/oversized_outline.ttf");
        let mut font_id = 0;
        assert_eq!(
            unsafe { ra2_text_engine_add_font(engine, bytes.as_ptr(), bytes.len(), &mut font_id) },
            Status::Ok as i32
        );
        let text = [b'A' as u16];
        let mut layout = std::ptr::null_mut();
        assert_eq!(
            unsafe {
                ra2_text_layout_utf16(
                    engine,
                    font_id,
                    text.as_ptr(),
                    text.len(),
                    512.0,
                    0.0,
                    &mut layout,
                )
            },
            Status::LimitExceeded as i32
        );
        assert!(layout.is_null());
        RASTER_GLYPH_CALLS.with(|calls| assert_eq!(calls.get(), 0));
        unsafe { ra2_text_engine_destroy(engine) };
    }

    #[test]
    fn mixed_script_shaping_does_not_emit_missing_glyph_zero() {
        for text in ["A", "กิ", "漢", "Aกิ漢", "سلام"] {
            let glyph_ids = shaped_glyph_ids(text);
            assert!(!glyph_ids.is_empty(), "no glyphs shaped for {text}");
            assert!(
                glyph_ids.iter().all(|&glyph_id| glyph_id != 0),
                "missing glyph ID in {text}: {glyph_ids:?}"
            );
        }
    }
}
