/**
 * Where Kustom is downloaded from: the public `suyaser/kustom-releases` repo (lead, 2026-09-09). The one
 * source for every download link and for the file name the copy tells a friend to grab (M17.12).
 *
 * **Copied, not imported**: the same repo is `RELEASE_REPO` in `apps/companion/build/config.ts` and in
 * `apps/companion/scripts/release/release.ts` (the M17.12 workflow), and the web app does not depend on the
 * companion package. If the release repo is ever renamed, all three move.
 *
 * No file here imports anything, so copy modules can read it without a cycle through `nav.ts`.
 */

export const RELEASE_REPO = 'suyaser/kustom-releases';

/**
 * The releases **page**. Every friend-facing link goes here, never to a file: those pages are opened on
 * phones, and a Windows download started on a phone is a bug.
 */
export const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases/latest`;

/**
 * The two names the Windows download has ever had on a release (M17 "Assets and the web"):
 *
 * - `Kustom.exe`: the 0.3.x single exe (Node SEA). The Rust 1.0.x releases also carry their installer under
 *   this name until M17.14, so the link pasted in every group chat keeps downloading something that works.
 * - `Kustom-setup.exe`: the Rust 1.0.x NSIS installer, the stable name from 1.0.0 on.
 */
export type ReleaseAsset = 'Kustom.exe' | 'Kustom-setup.exe';

/**
 * **The switch.** The file every direct download link and the `/download` copy name. `Kustom-setup.exe`, the
 * Rust Kustom 1.0 installer, since 2.0 and 1.0 ship together (decision row 2026-10-04, M17.12; it superseded
 * "0.3.x stays the download through the 2.0 deploy"). `nav.test.ts` and `landing.test.tsx` pin it.
 */
export const RELEASE_ASSET: ReleaseAsset = 'Kustom-setup.exe';

/** The newest release's Windows download, always the newest version (`releases/latest/download/...`). */
export const RELEASE_EXE_URL = `${RELEASES_URL}/download/${RELEASE_ASSET}`;

/** The checksum published beside it (M2.20; the M17.12 workflow publishes one for both names). */
export const RELEASE_EXE_SHA256_URL = `${RELEASE_EXE_URL}.sha256`;
