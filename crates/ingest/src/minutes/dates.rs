//! Lightweight Finnish date parser.
//!
//! Accepts the common municipal date formats (`DD.MM.YYYY`, `D.M.YYYY`).
//! Phase 1 does not need the full multilingual parser that the old
//! Node.js importer shipped — we can add SE/NO/DK/EE/DE in phase 4 if
//! we start importing non-Finnish entities.

use chrono::NaiveDate;

/// Parse a Finnish-format date string.
///
/// Returns `None` for strings the parser cannot confidently decode —
/// callers should skip such meetings rather than guess.
pub fn parse_fi_date(s: &str) -> Option<NaiveDate> {
    let trimmed = s.trim();
    let parts: Vec<&str> = trimmed.trim_end_matches('.').split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let day: u32 = parts[0].trim().parse().ok()?;
    let month: u32 = parts[1].trim().parse().ok()?;
    let year_raw = parts[2].trim();
    let year: i32 = year_raw.parse().ok()?;
    // Accept 2-digit years conservatively (assume 20xx).
    let year = if year < 100 { 2000 + year } else { year };
    NaiveDate::from_ymd_opt(year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_finnish_date() {
        assert_eq!(
            parse_fi_date("15.10.2024"),
            NaiveDate::from_ymd_opt(2024, 10, 15)
        );
    }

    #[test]
    fn parses_single_digit_day_and_month() {
        assert_eq!(
            parse_fi_date("1.4.2026"),
            NaiveDate::from_ymd_opt(2026, 4, 1)
        );
    }

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(
            parse_fi_date("  28.3.2026  "),
            NaiveDate::from_ymd_opt(2026, 3, 28)
        );
    }

    #[test]
    fn parses_two_digit_year_as_2000s() {
        assert_eq!(parse_fi_date("1.1.26"), NaiveDate::from_ymd_opt(2026, 1, 1));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_fi_date(""), None);
        assert_eq!(parse_fi_date("not a date"), None);
        assert_eq!(parse_fi_date("2026-03-28"), None);
        assert_eq!(parse_fi_date("32.13.2026"), None);
    }
}
