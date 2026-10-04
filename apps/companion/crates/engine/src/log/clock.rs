//! UTC timestamps without a date crate: the log's `ts`, the daily file name, and reading back an
//! ISO 8601 stamp the TypeScript engine wrote (`status.json`'s `updatedAt`).
//!
//! The format is JavaScript's `Date.prototype.toISOString()`: `2026-10-04T18:30:05.123Z`, always UTC,
//! always milliseconds, so a Rust line and a 0.3.x line in the same folder sort and read the same.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The injected clock (CLAUDE.md: no wall clock without injection in code that is tested on a fake one).
pub type Clock = Arc<dyn Fn() -> SystemTime + Send + Sync>;

/// The real clock.
pub fn system_clock() -> Clock {
    Arc::new(SystemTime::now)
}

/// A clock stuck at `at`. For tests.
pub fn fixed_clock(at: SystemTime) -> Clock {
    Arc::new(move || at)
}

/// Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm), proleptic Gregorian.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// A civil date to days since 1970-01-01.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn split(at: SystemTime) -> (i64, u32) {
    match at.duration_since(UNIX_EPOCH) {
        Ok(since) => (since.as_secs() as i64, since.subsec_millis()),
        // Before 1970: only a broken clock gets here. Clamp rather than panic.
        Err(_) => (0, 0),
    }
}

/// `2026-10-04T18:30:05.123Z`, as `toISOString()` writes it.
pub fn iso_timestamp(at: SystemTime) -> String {
    let (secs, millis) = split(at);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

/// `2026-10-04`, the UTC date: the daily log file's stamp (`log.ts` `dateStamp`).
pub fn date_stamp(at: SystemTime) -> String {
    iso_timestamp(at)[..10].to_owned()
}

fn digits(text: &str) -> Option<u32> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// Reads `YYYY-MM-DDTHH:MM:SS[.fff…](Z|±HH:MM)` back into a time. `None` for anything else; never panics.
pub fn parse_iso_timestamp(text: &str) -> Option<SystemTime> {
    let text = text.trim();
    if text.len() < 20 || !text.is_ascii() {
        return None;
    }
    let (date, rest) = text.split_at(10);
    let mut date_parts = date.split('-');
    let y = digits(date_parts.next()?)?;
    let m = digits(date_parts.next()?)?;
    let d = digits(date_parts.next()?)?;
    if date_parts.next().is_some() || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let rest = rest.strip_prefix('T').or_else(|| rest.strip_prefix('t'))?;
    let (clock, zone_offset_secs) =
        if let Some(clock) = rest.strip_suffix('Z').or_else(|| rest.strip_suffix('z')) {
            (clock, 0_i64)
        } else {
            if rest.len() < 6 {
                return None;
            }
            let (clock, zone) = rest.split_at(rest.len() - 6);
            let sign = match zone.as_bytes().first() {
                Some(b'+') => 1,
                Some(b'-') => -1,
                _ => return None,
            };
            let (zh, zm) = zone[1..].split_once(':')?;
            (
                clock,
                sign * (i64::from(digits(zh)?) * 3_600 + i64::from(digits(zm)?) * 60),
            )
        };
    let (hms, fraction) = match clock.split_once('.') {
        Some((hms, fraction)) => (hms, Some(fraction)),
        None => (clock, None),
    };
    let mut hms_parts = hms.split(':');
    let hh = digits(hms_parts.next()?)?;
    let mm = digits(hms_parts.next()?)?;
    let ss = digits(hms_parts.next()?)?;
    if hms_parts.next().is_some() || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    let millis = match fraction {
        Some(fraction) => {
            digits(fraction)?;
            let padded = format!("{fraction:0<3}");
            digits(&padded[..3])?
        }
        None => 0,
    };
    let secs = days_from_civil(i64::from(y), m, d) * 86_400
        + i64::from(hh) * 3_600
        + i64::from(mm) * 60
        + i64::from(ss)
        - zone_offset_secs;
    let secs = u64::try_from(secs).ok()?;
    Some(UNIX_EPOCH + Duration::from_secs(secs) + Duration::from_millis(u64::from(millis)))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_to_iso_string() {
        // 2026-10-04T18:30:05.123Z
        let at = UNIX_EPOCH + Duration::from_millis(1_791_138_605_123);
        assert_eq!(iso_timestamp(at), "2026-10-04T18:30:05.123Z");
        assert_eq!(date_stamp(at), "2026-10-04");
        assert_eq!(iso_timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        // A leap day.
        let leap = UNIX_EPOCH + Duration::from_secs(951_782_400);
        assert_eq!(iso_timestamp(leap), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn parses_back_what_it_writes_and_offsets() {
        let at = UNIX_EPOCH + Duration::from_millis(1_791_138_605_123);
        assert_eq!(parse_iso_timestamp(&iso_timestamp(at)), Some(at));
        assert_eq!(parse_iso_timestamp("2026-10-04T20:30:05.123+02:00"), Some(at));
        assert_eq!(
            parse_iso_timestamp("2026-10-04T18:30:05Z"),
            Some(UNIX_EPOCH + Duration::from_secs(1_791_138_605))
        );
        for bad in [
            "",
            "yesterday",
            "2026-13-04T18:30:05Z",
            "2026-10-04 18:30:05Z",
            "2026-10-04T18:30:05",
        ] {
            assert_eq!(parse_iso_timestamp(bad), None, "{bad}");
        }
    }
}
