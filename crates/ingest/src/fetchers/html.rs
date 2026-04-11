//! Shared HTML helpers for fetchers that parse page content directly.

/// Strip HTML tags and decode the most common entities into plain text.
///
/// Not a full-fledged HTML-to-text converter — we only need enough to feed
/// the Mistral prompts. Newlines are preserved around block-level tags so
/// the editorial gate can still see paragraph boundaries.
pub fn strip_html(input: &str) -> String {
    // Replace block-level closing tags with newlines before tag stripping.
    let mut s = input.to_string();
    for pat in &["<br", "<BR"] {
        s = s.replace(pat, "\n<");
    }
    for pat in &[
        "</p>", "</P>", "</div>", "</DIV>", "</tr>", "</TR>", "</li>", "</LI>",
    ] {
        s = s.replace(pat, "\n");
    }

    // Drop the remaining tags.
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            continue;
        }
        if !in_tag {
            out.push(ch);
        }
    }

    // Decode common entities.
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    // Collapse runs of 3+ newlines down to 2.
    let mut collapsed = String::with_capacity(out.len());
    let mut newline_run = 0;
    for ch in out.chars() {
        if ch == '\n' {
            newline_run += 1;
            if newline_run <= 2 {
                collapsed.push(ch);
            }
        } else {
            newline_run = 0;
            collapsed.push(ch);
        }
    }

    collapsed.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tags_and_decodes_entities() {
        let html = "<p>Hello &amp; <b>world</b></p>";
        assert_eq!(strip_html(html), "Hello & world");
    }

    #[test]
    fn inserts_newlines_on_block_close() {
        let html = "<p>First</p><p>Second</p>";
        let out = strip_html(html);
        assert!(out.contains("First"));
        assert!(out.contains("Second"));
        assert!(out.contains('\n'));
    }

    #[test]
    fn collapses_runs_of_newlines() {
        let html = "a<br><br><br><br>b";
        let out = strip_html(html);
        // Multiple blank lines become at most two.
        assert!(!out.contains("\n\n\n"));
    }
}
