//! The Windows application manifest goes on every executable this crate links, tests included.
//!
//! `tauri_build::build()` puts the manifest in the `.rc` resource it links into the *binary* only. A test
//! executable (`tests/*.rs`, examples) links `tauri` (wry, comctl32) too, but gets no manifest, so Windows
//! loads comctl32 v5, which lacks `TaskDialogIndirect`, and the process dies with 0xc0000139
//! (STATUS_ENTRYPOINT_NOT_FOUND) before `main`. Tauri's own `crates/tauri/build.rs` (`embed_manifest_for_tests`)
//! works around the same thing with the linker flags below.
//!
//! So: tauri-build is told not to embed a manifest, and the MSVC linker embeds `windows-app-manifest.xml`
//! (a copy of tauri-build's default: Common Controls v6, nothing else) into every target. The bin therefore
//! still carries exactly the manifest it had, and nothing is embedded twice (a second one would be CVT1100).
//! Other platforms are untouched.

fn main() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());

    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    if let Err(error) = tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)) {
        // Same as `tauri_build::build()`: a broken config stops the build, loudly.
        panic!("tauri-build failed: {error:#}");
    }

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        // Unscoped on purpose: bins, integration tests, unit tests and examples all need it.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
