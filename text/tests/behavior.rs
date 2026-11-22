use ra2_text::{
    RA2TextLayout, RA2TextMetrics, ra2_text_engine_add_font, ra2_text_engine_create,
    ra2_text_engine_destroy, ra2_text_layout_destroy, ra2_text_layout_get_metrics,
    ra2_text_layout_render_mask, ra2_text_layout_utf16, ra2_text_layout_utf16_ex,
};

fn measure(text: &[u16], size: f32) -> RA2TextMetrics {
    unsafe {
        let engine = ra2_text_engine_create();
        assert!(!engine.is_null());
        let mut layout: *mut RA2TextLayout = std::ptr::null_mut();
        assert_eq!(
            ra2_text_layout_utf16(engine, 0, text.as_ptr(), text.len(), size, 0.0, &mut layout),
            0
        );
        assert!(!layout.is_null());
        let mut metrics = RA2TextMetrics::default();
        assert_eq!(ra2_text_layout_get_metrics(layout, &mut metrics), 0);
        ra2_text_layout_destroy(layout);
        ra2_text_engine_destroy(engine);
        metrics
    }
}

fn render(text: &[u16], size: f32) -> (RA2TextMetrics, Vec<u8>) {
    unsafe {
        let engine = ra2_text_engine_create();
        assert!(!engine.is_null());
        let mut layout: *mut RA2TextLayout = std::ptr::null_mut();
        assert_eq!(
            ra2_text_layout_utf16(engine, 0, text.as_ptr(), text.len(), size, 0.0, &mut layout),
            0
        );
        let mut metrics = RA2TextMetrics::default();
        assert_eq!(ra2_text_layout_get_metrics(layout, &mut metrics), 0);
        let (width, height, pitch) = (512u32, 64u32, 520usize);
        let mut pixels = vec![0; pitch * height as usize];
        assert_eq!(
            ra2_text_layout_render_mask(layout, pixels.as_mut_ptr(), width, height, pitch, 8, 4),
            0
        );
        ra2_text_layout_destroy(layout);
        ra2_text_engine_destroy(engine);
        (metrics, pixels)
    }
}

#[test]
fn latin_has_advance_and_ink() {
    let metrics = measure(&"Hello".encode_utf16().collect::<Vec<_>>(), 24.0);
    assert!(metrics.advance_x > 0.0);
    assert!(metrics.ink_width > 0 && metrics.ink_height > 0);
}

#[test]
fn thai_marks_shape_with_visible_ink() {
    let base = measure(&"ก".encode_utf16().collect::<Vec<_>>(), 24.0);
    let marked = measure(&"กิ".encode_utf16().collect::<Vec<_>>(), 24.0);
    assert!(marked.advance_x > 0.0);
    assert!(marked.ink_width > 0 && marked.ink_height > base.ink_height);
}

#[test]
fn arabic_joined_run_has_nonzero_advance_and_ink() {
    let joined = render(&"سلام".encode_utf16().collect::<Vec<_>>(), 24.0);
    let unjoined = render(
        &"س\u{200c}ل\u{200c}ا\u{200c}م"
            .encode_utf16()
            .collect::<Vec<_>>(),
        24.0,
    );
    assert!(joined.0.advance_x > 0.0);
    assert!(joined.0.ink_width > 0 && joined.0.ink_height > 0);
    assert_ne!(
        joined.1, unjoined.1,
        "ZWNJ control should differ from a joined Arabic run"
    );
}

#[test]
fn mixed_scripts_and_cjk_have_ink() {
    for text in ["Aกิ漢", "漢字かな", "Aسلام"] {
        let metrics = measure(&text.encode_utf16().collect::<Vec<_>>(), 24.0);
        assert!(metrics.advance_x > 0.0, "{text}");
        assert!(metrics.ink_width > 0 && metrics.ink_height > 0, "{text}");
    }
}

#[test]
fn empty_and_malformed_utf16_are_safe() {
    let empty = measure(&[], 18.0);
    assert_eq!(empty.advance_x, 0.0);
    let malformed = measure(&[0xD800, b'A' as u16, 0xDC00], 18.0);
    assert!(malformed.advance_x > 0.0);
    assert!(malformed.ink_width > 0);
}

#[test]
fn latin_j_retains_negative_left_ink_bearing() {
    let metrics = measure(&[b'j' as u16], 24.0);
    assert!(
        metrics.ink_x < 0,
        "expected Noto Sans j to overhang left, got {}",
        metrics.ink_x
    );
}

#[test]
fn standalone_combining_mark_can_have_ink_without_advance() {
    let metrics = measure(&[0x0301], 24.0);
    assert!(metrics.ink_width > 0 && metrics.ink_height > 0);
}

#[test]
fn caller_font_bytes_can_be_registered_and_selected() {
    unsafe {
        let engine = ra2_text_engine_create();
        let bytes = include_bytes!("fixtures/same_name_override.ttf");
        let mut font_id = 0;
        assert_eq!(
            ra2_text_engine_add_font(engine, bytes.as_ptr(), bytes.len(), &mut font_id),
            0
        );
        assert_ne!(font_id, 0);
        let bundled = measure(&[b'A' as u16], 24.0);
        let text: Vec<u16> = "A".encode_utf16().collect();
        let mut layout = std::ptr::null_mut();
        assert_eq!(
            ra2_text_layout_utf16(
                engine,
                font_id,
                text.as_ptr(),
                text.len(),
                18.0,
                0.0,
                &mut layout
            ),
            0
        );
        let mut metrics = RA2TextMetrics::default();
        assert_eq!(ra2_text_layout_get_metrics(layout, &mut metrics), 0);
        assert!(metrics.advance_x > 0.0 && metrics.ink_width > 0);
        assert!(
            metrics.advance_x < bundled.advance_x * 0.5,
            "explicit same-name override should use the narrow caller face: {} vs {}",
            metrics.advance_x,
            bundled.advance_x
        );
        ra2_text_layout_destroy(layout);
        ra2_text_engine_destroy(engine);
    }
}

#[test]
fn small_advance_oversized_outline_is_rejected() {
    unsafe {
        let engine = ra2_text_engine_create();
        let bytes = include_bytes!("fixtures/oversized_outline.ttf");
        let mut font_id = 0;
        assert_eq!(
            ra2_text_engine_add_font(engine, bytes.as_ptr(), bytes.len(), &mut font_id),
            0
        );
        let text = [b'A' as u16];
        let mut layout = std::ptr::null_mut();
        assert_eq!(
            ra2_text_layout_utf16(
                engine,
                font_id,
                text.as_ptr(),
                text.len(),
                512.0,
                0.0,
                &mut layout
            ),
            3,
            "large outline ink must be rejected before raster allocation"
        );
        assert!(layout.is_null());
        ra2_text_engine_destroy(engine);
    }
}

#[test]
fn extended_layout_applies_line_height_and_alignment() {
    unsafe {
        let engine = ra2_text_engine_create();
        let text: Vec<u16> = "AB".encode_utf16().collect();
        let mut layout = std::ptr::null_mut();
        assert_eq!(
            ra2_text_layout_utf16_ex(
                engine,
                0,
                text.as_ptr(),
                text.len(),
                18.0,
                120.0,
                30.0,
                1,
                700.0,
                0.82,
                &mut layout
            ),
            0
        );
        let mut metrics = RA2TextMetrics::default();
        assert_eq!(ra2_text_layout_get_metrics(layout, &mut metrics), 0);
        assert!(metrics.height >= 30.0);
        assert!(
            metrics.ink_x > 0,
            "center aligned ink must start to the right of x=0: {}",
            metrics.ink_x
        );
        ra2_text_layout_destroy(layout);
        ra2_text_engine_destroy(engine);
    }
}

#[test]
fn render_mask_accepts_minimal_pitched_view_and_preserves_existing_coverage() {
    unsafe {
        let engine = ra2_text_engine_create();
        let text: Vec<u16> = "A".encode_utf16().collect();
        let mut layout = std::ptr::null_mut();
        assert_eq!(
            ra2_text_layout_utf16(engine, 0, text.as_ptr(), text.len(), 18.0, 0.0, &mut layout),
            0
        );
        let (width, height, pitch) = (48u32, 32u32, 64usize);
        let accessible_bytes = (height as usize - 1) * pitch + width as usize;
        let mut pixels = vec![0x40; accessible_bytes];
        assert_eq!(
            ra2_text_layout_render_mask(layout, pixels.as_mut_ptr(), width, height, pitch, 2, 1),
            0
        );
        assert!(pixels.iter().all(|&coverage| coverage >= 0x40));
        assert!(pixels.iter().any(|&coverage| coverage > 0x40));
        ra2_text_layout_destroy(layout);
        ra2_text_engine_destroy(engine);
    }
}
