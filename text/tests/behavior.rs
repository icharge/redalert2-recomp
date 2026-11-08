use ra2_text::{
    RA2TextLayout, RA2TextMetrics, ra2_text_engine_add_font, ra2_text_engine_create,
    ra2_text_engine_destroy, ra2_text_layout_destroy, ra2_text_layout_get_metrics,
    ra2_text_layout_utf16, ra2_text_layout_utf16_ex,
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

#[test]
fn latin_has_advance_and_ink() {
    let metrics = measure(&"Hello".encode_utf16().collect::<Vec<_>>(), 24.0);
    assert!(metrics.advance_x > 0.0);
    assert!(metrics.ink_width > 0 && metrics.ink_height > 0);
}

#[test]
fn thai_marks_shape_with_visible_ink() {
    let metrics = measure(&"ภาษาไทย".encode_utf16().collect::<Vec<_>>(), 24.0);
    assert!(metrics.advance_x > 0.0);
    assert!(metrics.ink_width > 0 && metrics.ink_height > 0);
}

#[test]
fn arabic_joined_run_has_nonzero_advance_and_ink() {
    let metrics = measure(&"سلام".encode_utf16().collect::<Vec<_>>(), 24.0);
    assert!(metrics.advance_x > 0.0);
    assert!(metrics.ink_width > 0 && metrics.ink_height > 0);
}

#[test]
fn mixed_scripts_and_cjk_have_ink() {
    for text in ["Aไทย", "漢字かな", "Aسلام"] {
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
        let bytes = include_bytes!("../../assets/fonts/NotoSans-VF.ttf");
        let mut font_id = 0;
        assert_eq!(
            ra2_text_engine_add_font(engine, bytes.as_ptr(), bytes.len(), &mut font_id),
            0
        );
        assert_ne!(font_id, 0);
        let text: Vec<u16> = "User font".encode_utf16().collect();
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
        ra2_text_layout_destroy(layout);
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
