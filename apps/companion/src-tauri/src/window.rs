//! The window's behaviour (05-design §9.1), as rules over a small trait so they are tested without a
//! webview: a second launch shows and focuses the running window; close, Alt+F4 and Esc hide it to the
//! tray; a launch by Start with Windows stays in the tray unless Kustom needs the person.

use crate::model::Screen;

/// What the rules need from a window. `lib.rs` implements it for the Tauri window.
pub trait WindowOps {
    /// Shows the window (and its taskbar button).
    fn show(&self);
    /// Hides the window to the tray (no taskbar button).
    fn hide(&self);
    /// Restores it if minimised.
    fn unminimize(&self);
    /// Gives it the keyboard focus.
    fn focus(&self);
}

/// A second `Kustom.exe` was started: no second process, no message; the first one's window comes up,
/// restored if minimised, focused (tauri-plugin-single-instance calls this in the first process).
pub fn on_second_instance(window: &impl WindowOps) {
    window.unminimize();
    window.show();
    window.focus();
}

/// `Open Kustom` (the tray item and a left click on the icon): the same as a second launch.
pub fn open(window: &impl WindowOps) {
    on_second_instance(window);
}

/// The close button, Alt+F4 or Esc: hide to the tray; the engine keeps running.
pub fn on_close_requested(window: &impl WindowOps) {
    window.hide();
}

/// The argument Start with Windows launches with (`tauri-plugin-autostart`).
pub const AUTOSTART_ARG: &str = "--autostart";

/// Whether the window shows at start. A launch by hand shows it; a launch by Start with Windows stays in
/// the tray unless Kustom needs the person (Link, or the old engine running).
pub fn show_at_start(args: &[String], screen: Screen) -> bool {
    let by_autostart = args.iter().any(|a| a == AUTOSTART_ARG);
    !by_autostart || matches!(screen, Screen::Link | Screen::OldEngine)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Recorder(RefCell<Vec<&'static str>>);

    impl WindowOps for Recorder {
        fn show(&self) {
            self.0.borrow_mut().push("show");
        }
        fn hide(&self) {
            self.0.borrow_mut().push("hide");
        }
        fn unminimize(&self) {
            self.0.borrow_mut().push("unminimize");
        }
        fn focus(&self) {
            self.0.borrow_mut().push("focus");
        }
    }

    #[test]
    fn a_second_launch_restores_shows_and_focuses_the_first() {
        let window = Recorder::default();
        on_second_instance(&window);
        assert_eq!(*window.0.borrow(), vec!["unminimize", "show", "focus"]);
    }

    #[test]
    fn open_kustom_is_the_same_and_close_hides() {
        let window = Recorder::default();
        open(&window);
        on_close_requested(&window);
        assert_eq!(*window.0.borrow(), vec!["unminimize", "show", "focus", "hide"]);
    }

    #[test]
    fn start_with_windows_stays_in_the_tray_unless_needed() {
        let by_hand: Vec<String> = vec!["Kustom.exe".into()];
        let autostart: Vec<String> = vec!["Kustom.exe".into(), AUTOSTART_ARG.into()];
        assert!(show_at_start(&by_hand, Screen::Home));
        assert!(!show_at_start(&autostart, Screen::Home));
        assert!(
            show_at_start(&autostart, Screen::Link),
            "no token: the person is needed"
        );
        assert!(show_at_start(&autostart, Screen::OldEngine));
    }
}
