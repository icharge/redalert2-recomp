use std::{env, fs};

use ra2_text::{
    ra2_text_engine_create, ra2_text_engine_destroy, ra2_text_layout_destroy,
    ra2_text_layout_render_mask, ra2_text_layout_utf16_ex,
};

fn main() {
    let output = env::args()
        .nth(1)
        .unwrap_or_else(|| "text-specimen.pgm".into());
    let text: Vec<u16> = "RA2 Text  |  ภาษาไทย  |  سلام  |  漢字かな"
        .encode_utf16()
        .collect();
    let (width, height) = (800u32, 64u32);
    let mut mask = vec![0u8; (width * height) as usize];
    unsafe {
        let engine = ra2_text_engine_create();
        assert!(!engine.is_null());
        let mut layout = std::ptr::null_mut();
        assert_eq!(
            ra2_text_layout_utf16_ex(
                engine,
                0,
                text.as_ptr(),
                text.len(),
                28.0,
                0.0,
                42.0,
                0,
                700.0,
                1.0,
                &mut layout,
            ),
            0
        );
        assert_eq!(
            ra2_text_layout_render_mask(
                layout,
                mask.as_mut_ptr(),
                width,
                height,
                width as usize,
                12,
                6
            ),
            0
        );
        ra2_text_layout_destroy(layout);
        ra2_text_engine_destroy(engine);
    }
    for pixel in &mut mask {
        *pixel = 255 - *pixel;
    }
    let mut pgm = format!("P5\n{width} {height}\n255\n").into_bytes();
    pgm.extend(mask);
    fs::write(&output, pgm).expect("write portable graymap specimen");
    println!("wrote {output}");
}
