//! What Linux's and Windows's call watches share: which app a call is in, which windows can hold it, and whether a
//! window's tree is a call (Teams keeps its calendar and chat in windows shaped like the call's, and Slack its channels).

use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

/// what kind of window a call app has, from its id (detect.ts's names carry the app)
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Zoom,
    Teams,
    Slack,
    Meet,
}

pub fn kind(id: &str) -> Kind {
    let id = id.to_ascii_lowercase();
    if id.contains("zoom") {
        Kind::Zoom
    } else if id.contains("teams") {
        Kind::Teams
    } else if id.contains("slack") {
        Kind::Slack
    } else {
        Kind::Meet
    }
}

/// the controls only a call window has: the calendar and chat views have none
pub const CALL_CONTROLS: &[&str] = &["leave", "leave call", "leave huddle", "hang up", "end call", "mute mic", "unmute mic", "close participants pane"];

/// Slack's huddle, in any language: a person's tile, or the channel header's Leave button, by their page classes
const HUDDLE_CLASSES: &[&str] = &[HUDDLE_TILE, "p-huddle_channel_header_button__leave_button"];
/// one person in a Slack huddle (src/main/callNames/parse.ts reads them)
pub const HUDDLE_TILE: &str = "p-huddle_peer_tile";

fn has_class(n: &Value, classes: &[&str]) -> bool {
    n.get("c").and_then(Value::as_array).is_some_and(|c| c.iter().any(|x| x.as_str().is_some_and(|x| classes.contains(&x))))
}

/// Whether a tree shows the people of a Slack huddle: the window to read when Slack has several with a huddle in them
pub fn has_huddle_tiles(tree: &Value) -> bool {
    has_class(tree, &[HUDDLE_TILE]) || tree.get("k").and_then(Value::as_array).is_some_and(|kids| kids.iter().any(has_huddle_tiles))
}

/// A button's label without the shortcut it can carry: "Leave (Ctrl+Shift+H)" is "leave", as on the Mac (#83)
fn control_label(s: &str) -> String {
    let s = s.trim();
    let s = match (s.ends_with(')'), s.rfind('(')) {
        (true, Some(i)) => &s[..i],
        _ => s,
    };
    s.trim().to_ascii_lowercase()
}

/// Whether a tree has a call control: the calendar and chat views have no Leave or Mute, the call window always does.
/// Teams' hang-up button keeps its page id in every language, so that counts too, as on the Mac (#83).
pub fn is_call_tree(tree: &Value) -> bool {
    fn walk(n: &Value) -> bool {
        let Some(o) = n.as_object() else { return false };
        if o.get("i").and_then(Value::as_str) == Some("hangup-button") || has_class(n, HUDDLE_CLASSES) {
            return true;
        }
        let role = o.get("r").and_then(Value::as_str).unwrap_or("");
        if matches!(role, "button" | "push button" | "toggle button" | "menu item") {
            for key in ["t", "d"] {
                if let Some(s) = o.get(key).and_then(Value::as_str) {
                    if CALL_CONTROLS.contains(&control_label(s).as_str()) {
                        return true;
                    }
                }
            }
        }
        o.get("k").and_then(Value::as_array).is_some_and(|kids| kids.iter().any(walk))
    }
    walk(tree)
}

/// Whether a window may hold the call: a browser only when its front tab is a Meet call, Zoom only a meeting, Teams
/// and Slack any window (Teams' calendar and chat views look like the call's, and Slack's huddle window is titled
/// with its channel; is_call_tree tells them apart)
pub fn call_window(kind: Kind, title: &str) -> bool {
    match kind {
        Kind::Teams | Kind::Slack => true,
        Kind::Zoom => title.starts_with("Zoom Meeting") || title.starts_with("Zoom Webinar") || title == "Meeting",
        Kind::Meet => has_word(title, "meet"),
    }
}

/// "Meet - abc-defg-hij" has the word; "Meeting notes" does not
pub fn has_word(title: &str, word: &str) -> bool {
    title.split(|c: char| !c.is_alphanumeric()).any(|w| w.eq_ignore_ascii_case(word))
}

/// Which of the app's windows to read: the one that was the call last time, alone, while it is still open. Teams keeps
/// its big chat and calendar windows open beside the call, and reading every one each time made a German call's
/// reading take 10 s (#83). With no such window, all of them.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn to_read<T>(mut windows: Vec<(u64, T)>, last: Option<u64>) -> (Vec<(u64, T)>, bool) {
    match last.and_then(|h| windows.iter().position(|w| w.0 == h)) {
        Some(i) => (vec![windows.swap_remove(i)], true),
        None => (windows, false),
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_kind_comes_from_the_id() {
        assert_eq!(kind("us.zoom.xos"), Kind::Zoom);
        assert_eq!(kind("zoom"), Kind::Zoom);
        assert_eq!(kind("com.microsoft.teams2"), Kind::Teams);
        assert_eq!(kind("teams-for-linux"), Kind::Teams);
        assert_eq!(kind("com.github.IsmaelMartinez.teams_for_linux"), Kind::Teams);
        assert_eq!(kind("com.google.Chrome"), Kind::Meet);
        assert_eq!(kind("firefox"), Kind::Meet);
        // Windows: the program's file name, lowercased
        assert_eq!(kind("zoom.exe"), Kind::Zoom);
        assert_eq!(kind("ms-teams.exe"), Kind::Teams);
        assert_eq!(kind("msedge.exe"), Kind::Meet);
        assert_eq!(kind("slack.exe"), Kind::Slack);
        assert_eq!(kind("slack"), Kind::Slack);
        assert_eq!(kind("com.slack.Slack"), Kind::Slack);
    }

    #[test]
    fn a_browser_window_is_a_call_only_with_the_word_meet() {
        assert!(call_window(Kind::Meet, "Meet - abc-defg-hij - Google Chrome"));
        assert!(call_window(Kind::Meet, "meet.google.com"));
        assert!(call_window(Kind::Meet, "Meet – abc-defg-hij and 1 more page - Work - Microsoft Edge"));
        assert!(!call_window(Kind::Meet, "Meeting notes - Google Chrome"));
        assert!(call_window(Kind::Zoom, "Zoom Meeting"));
        assert!(call_window(Kind::Zoom, "Meeting"));
        assert!(call_window(Kind::Zoom, "Zoom Webinar - 123"));
        assert!(!call_window(Kind::Zoom, "Zoom Workplace"));
    }

    #[test]
    fn only_a_tree_with_call_controls_is_a_call() {
        let call = json!({ "r": "frame", "k": [
            { "r": "static", "t": "Calendar | Meeting with Dana Smith | Microsoft Teams" },
            { "r": "button", "t": "Mute mic" },
            { "r": "button", "t": "Leave" }
        ] });
        assert!(is_call_tree(&call));
        let calendar = json!({ "r": "frame", "k": [
            { "r": "static", "t": "Calendar | Meeting with Dana Smith | Microsoft Teams" },
            { "r": "button", "t": "Go to today November 12, 2026" }
        ] });
        assert!(!is_call_tree(&calendar));
        assert!(!is_call_tree(&json!({})));
    }

    #[test]
    fn a_control_label_can_carry_its_shortcut() {
        // Teams on Windows names its buttons with the shortcut, as the Mac reader already allows (#83)
        let call = json!({ "r": "frame", "k": [{ "r": "button", "t": "Leave (Ctrl+Shift+H)" }] });
        assert!(is_call_tree(&call));
        let muted = json!({ "r": "frame", "k": [{ "r": "toggle button", "t": "Unmute mic (Ctrl+Shift+M)" }] });
        assert!(is_call_tree(&muted));
        assert!(!is_call_tree(&json!({ "r": "frame", "k": [{ "r": "button", "t": "Leave chat (Ctrl+Shift+L)" }] })));
    }

    #[test]
    fn the_last_call_window_is_read_alone_while_it_is_open() {
        let wins = vec![(1u64, "Chat | Microsoft Teams"), (2, "Anna, Jonas | Microsoft Teams"), (3, "Calendar | Microsoft Teams")];
        assert_eq!(to_read(wins.clone(), Some(2)), (vec![(2, "Anna, Jonas | Microsoft Teams")], true));
        // closed, or none yet: every window, top first
        assert_eq!(to_read(wins.clone(), Some(9)), (wins.clone(), false));
        assert_eq!(to_read(wins.clone(), None), (wins, false));
    }

    #[test]
    fn a_slack_window_is_a_call_only_with_a_huddle_in_it() {
        // Slack 4.53 on Windows, a huddle in its own window: the Leave Huddle button and a person's tile
        let huddle = json!({ "r": "frame", "k": [
            { "r": "table", "c": ["p-huddle_grid_component"], "k": [
                { "r": "table row", "t": "View Dana Smith's profile", "c": ["p-huddle_peer_tile"] }
            ] },
            { "r": "push button", "t": "Leave Huddle", "c": ["c-button-unstyled", "leaveButton__wzISw"] }
        ] });
        assert!(is_call_tree(&huddle));
        assert!(has_huddle_tiles(&huddle));
        // the main window while in a huddle: the channel header's Leave button, in another language, and no tiles
        let main = json!({ "r": "frame", "k": [
            { "r": "push button", "t": "Salir de la reunión", "c": ["p-huddle_channel_header_button__leave_button"] }
        ] });
        assert!(is_call_tree(&main));
        assert!(!has_huddle_tiles(&main));
        // a channel, with no huddle: its Start huddle button is no call control
        let channel = json!({ "r": "frame", "k": [
            { "r": "push button", "t": "Start huddle", "c": ["p-huddle_channel_header_button__start_button"] }
        ] });
        assert!(!is_call_tree(&channel));
        assert!(call_window(Kind::Slack, "general (Channel) - Acme - Slack"));
    }

    #[test]
    fn the_hang_up_id_is_a_call_in_any_language() {
        // Teams in Portuguese labels Leave "Sair": its page id stays "hangup-button", as the Mac reader matches (#83)
        let call = json!({ "r": "frame", "k": [{ "r": "button", "t": "Sair (Ctrl+Shift+H)", "i": "hangup-button" }] });
        assert!(is_call_tree(&call));
        assert!(!is_call_tree(&json!({ "r": "frame", "k": [{ "r": "button", "t": "Sair", "i": "leave-chat-button" }] })));
    }
}
