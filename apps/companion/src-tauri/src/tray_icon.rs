//! The tray icon's frames (05-design §9.7). Windows draws the tray icon at 16 px at 100 % scaling, 20 at
//! 125 %, 24 at 150 % and 32 at 200 %; a single large image downsampled by Windows loses the hollow bar of
//! the "not recording" state. So both icons ship as ICO files with hand-drawn 16 and 20 px frames
//! (`scripts/tray-icons.py`), and the app hands the tray the frame that matches the scale factor, picking
//! again when it changes.

use std::io::Cursor;

/// The normal icon (solid amber bar).
pub const TRAY_ICO: &[u8] = include_bytes!("../icons/tray.ico");
/// The "not recording" icon (hollow bar).
pub const TRAY_ICO_NOT_RECORDING: &[u8] = include_bytes!("../icons/tray-not-recording.ico");

/// The frame sizes in each ICO.
pub const FRAME_SIZES: [u32; 4] = [16, 20, 24, 32];

/// The frame width for a scale factor: round(16 × scale), snapped to the nearest of [`FRAME_SIZES`] (a tie
/// goes up).
pub fn frame_width(scale_factor: f64) -> u32 {
    let wanted = if scale_factor.is_finite() && scale_factor > 0.0 {
        (16.0 * scale_factor).round()
    } else {
        16.0
    };
    // Reversed, so a tie (28 px at 175 %) takes the larger frame.
    FRAME_SIZES
        .into_iter()
        .rev()
        .min_by(|a, b| {
            let da = (f64::from(*a) - wanted).abs();
            let db = (f64::from(*b) - wanted).abs();
            da.total_cmp(&db)
        })
        .unwrap_or(16)
}

/// One decoded frame: RGBA bytes, width, height.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// Row-major RGBA.
    pub rgba: Vec<u8>,
    /// Width in px.
    pub width: u32,
    /// Height in px.
    pub height: u32,
}

/// The entry of `ico` whose width is `width` (else the largest), decoded. `None` (logged) when the file
/// cannot be read.
pub fn decode_frame(ico_bytes: &[u8], width: u32) -> Option<Frame> {
    let dir = match ico::IconDir::read(Cursor::new(ico_bytes)) {
        Ok(dir) => dir,
        Err(error) => {
            tracing::warn!(component = "tray", %error, "the tray icon could not be read");
            return None;
        }
    };
    let entries = dir.entries();
    let entry = entries
        .iter()
        .find(|e| e.width() == width)
        .or_else(|| entries.iter().max_by_key(|e| e.width()))?;
    match entry.decode() {
        Ok(image) => Some(Frame {
            width: image.width(),
            height: image.height(),
            rgba: image.rgba_data().to_vec(),
        }),
        Err(error) => {
            tracing::warn!(component = "tray", %error, "a tray icon frame could not be decoded");
            None
        }
    }
}

/// The frame for a state and a scale factor.
pub fn frame_for(not_recording: bool, scale_factor: f64) -> Option<Frame> {
    let bytes = if not_recording {
        TRAY_ICO_NOT_RECORDING
    } else {
        TRAY_ICO
    };
    decode_frame(bytes, frame_width(scale_factor))
}

#[cfg(test)]
mod tests {
    use super::*;

    const AMBER: [u8; 4] = [0xFF, 0xCF, 0x66, 0xFF];
    const TILE: [u8; 4] = [0x0C, 0x12, 0x1A, 0xFF];

    fn px(frame: &Frame, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * frame.width + x) * 4) as usize;
        [
            frame.rgba[i],
            frame.rgba[i + 1],
            frame.rgba[i + 2],
            frame.rgba[i + 3],
        ]
    }

    #[test]
    fn the_frame_follows_the_scale_factor() {
        assert_eq!(frame_width(1.0), 16);
        assert_eq!(frame_width(1.25), 20);
        assert_eq!(frame_width(1.5), 24);
        assert_eq!(frame_width(1.75), 32, "28 is a tie: the larger frame");
        assert_eq!(frame_width(2.0), 32);
        assert_eq!(frame_width(3.0), 32, "larger scales use the largest frame");
        assert_eq!(frame_width(0.0), 16);
        assert_eq!(frame_width(f64::NAN), 16);
    }

    #[test]
    fn both_icons_carry_every_frame() {
        for bytes in [TRAY_ICO, TRAY_ICO_NOT_RECORDING] {
            for size in FRAME_SIZES {
                let frame = decode_frame(bytes, size).unwrap();
                assert_eq!((frame.width, frame.height), (size, size));
            }
        }
    }

    #[test]
    fn the_16px_hollow_bar_is_drawn_by_hand() {
        let f = frame_for(true, 1.0).unwrap();
        for y in 3..=12 {
            for x in 2..=5 {
                let edge = x == 2 || x == 5 || y == 3 || y == 12;
                assert_eq!(px(&f, x, y), if edge { AMBER } else { TILE }, "({x},{y})");
            }
        }
        // No halo around the bar.
        for y in 3..=12 {
            assert_eq!(px(&f, 1, y), TILE, "left of the bar, row {y}");
            assert_eq!(px(&f, 6, y), TILE, "right of the bar, row {y}");
        }
    }

    #[test]
    fn the_20px_hollow_bar_is_drawn_by_hand() {
        let f = frame_for(true, 1.25).unwrap();
        for y in 3..=16 {
            for x in 2..=6 {
                let edge = x == 2 || x == 6 || y == 3 || y == 16;
                assert_eq!(px(&f, x, y), if edge { AMBER } else { TILE }, "({x},{y})");
            }
        }
    }

    #[test]
    fn the_normal_bar_is_solid_at_16() {
        let f = frame_for(false, 1.0).unwrap();
        for y in 3..=12 {
            for x in 2..=5 {
                assert_eq!(px(&f, x, y), AMBER, "({x},{y})");
            }
        }
    }
}
