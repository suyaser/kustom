// M17.8 screenshots (05-design §9.9): paints desktop/index.html at 400 × 690 with every view model the
// `screens` example prints, through a stand-in for window.__TAURI__ (the real app sends the same JSON).
//
//   cargo run -q -p kustom-companion --example screens > /tmp/views.json
//   NODE_PATH=<a dir with playwright> node scripts/screens/shoot.mjs /tmp/views.json <out dir>
//
// Playwright is not a dependency of this package; point NODE_PATH at any install (npx caches one).
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// biome-ignore lint/correctness/noUndeclaredDependencies: a developer tool; Playwright comes from NODE_PATH
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const page_url = pathToFileURL(resolve(here, '../../desktop/index.html')).href;
const [viewsPath, outDir] = process.argv.slice(2);
const views = JSON.parse(readFileSync(viewsPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

const now = new Date();
const at = (hours, minutes, daysBack) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, hours, minutes);
  return d.toISOString();
};
const TIMES = {
  '@TODAY': at(21, 42, 0),
  '@YESTERDAY': at(23, 10, 1),
  '@OLDER': at(22, 15, 4),
};
const fillTimes = (json) =>
  JSON.parse(JSON.stringify(json).replace(/@TODAY|@YESTERDAY|@OLDER/g, (m) => TIMES[m]));

const bridgeScript = (view) => `
  window.__KUSTOM_HARNESS__ = {
    core: { invoke: (cmd) => Promise.resolve(cmd === "get_view" ? ${JSON.stringify(view)} : undefined) },
    event: { listen: () => Promise.resolve(() => {}) },
  };`;

// Real scrollbars in the shots (headless Chromium hides them by default), as WebView2 draws them (9.1).
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });

async function shoot(name, view, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 400, height: 690 },
    deviceScaleFactor: 2,
    forcedColors: options.forcedColors ?? 'none',
    locale: 'en-GB',
  });
  const page = await context.newPage();
  await page.addInitScript(bridgeScript(view));
  await page.goto(page_url);
  await page.waitForFunction(() => document.getElementById('version').textContent.length > 0);
  if (options.zoom)
    await page.evaluate((z) => (document.documentElement.style.zoom = String(z)), options.zoom);
  await page.evaluate(() => document.fonts.ready);
  if (options.focus) await page.focus(options.focus);
  else await page.evaluate(() => document.activeElement?.blur());
  const overflow = await page.evaluate(() => {
    const main = document.getElementById('scroll');
    // The fold rule (9.1): the group name, the League row or block with its answer, and the screen's
    // primary button sit above the fold.
    const keep = [
      'group-name',
      'league-row',
      'cant-find',
      'league-slot',
      'open-tonight',
      'link-button',
      'retry',
    ]
      .map((id) => document.getElementById(id))
      .filter((el) => el && el.offsetParent !== null && el.getBoundingClientRect().height > 0);
    const below = keep
      .filter((el) => el.getBoundingClientRect().bottom > window.innerHeight)
      .map((el) => el.id);
    return {
      scrolls: main.scrollHeight > main.clientHeight,
      by: main.scrollHeight - main.clientHeight,
      sideways: document.body.scrollWidth > 400,
      below,
    };
  });
  await page.screenshot({ path: join(outDir, `m178-${name}.png`) });
  if (overflow.scrolls && !options.zoom) {
    await page.evaluate(() => {
      const main = document.getElementById('scroll');
      main.scrollTop = main.scrollHeight;
    });
    await page.screenshot({ path: join(outDir, `m178-${name}-bottom.png`) });
  }
  await context.close();
  return overflow;
}

const report = [];
for (const [name, entry] of Object.entries(views)) {
  if (name.startsWith('tray-')) continue;
  const view = fillTimes(entry.view);
  const overflow = await shoot(
    name,
    view,
    name.startsWith('l') && view.screen === 'link' ? { focus: '#code' } : {},
  );
  report.push(
    `${name}: ${overflow.scrolls ? `scrolls by ${overflow.by}px` : 'fits'}${overflow.below.length ? ` FOLD BROKEN: ${overflow.below.join(',')}` : ''}${overflow.sideways ? ' SIDEWAYS' : ''}`,
  );
}
const tallest = fillTimes(views['home-tallest'].view);
report.push(
  `home-200-text: ${(await shoot('home-200-text', tallest, { zoom: 2 })).scrolls ? 'main scrolls (expected)' : 'fits'}`,
);
await shoot('home-high-contrast', fillTimes(views['home-two-groups'].view), { forcedColors: 'active' });
await shoot('home-high-contrast-not-open', fillTimes(views['league-not-open'].view), {
  forcedColors: 'active',
});
await shoot('home-focus-select', fillTimes(views['home-two-groups'].view), { focus: '#group-select' });

// The tray menu, as Windows 11 draws a context menu (a mock from the TrayModel; the real one is native).
for (const name of ['tray-two-groups', 'tray-update']) {
  const t = views[name].tray;
  const row = (text, opts = {}) =>
    `<div class="item${opts.disabled ? ' dis' : ''}${opts.bold ? ' bold' : ''}"><span class="mark">${opts.check ? '✓' : ''}</span><span>${text}</span>${opts.sub ? '<span class="arrow">›</span>' : ''}</div>`;
  const sep = '<div class="sep"></div>';
  let html = row(t.line1, { disabled: true }) + (t.line2 ? row(t.line2, { disabled: true }) : '') + sep;
  let sub = '';
  if (t.groups) {
    html += row('Switch group', { sub: true });
    sub = `<div class="menu sub">${t.groups.map((g) => row(g.label, { check: g.checked })).join('')}</div>`;
  }
  html +=
    row('Open Kustom', { bold: true }) +
    row('Open logs') +
    sep +
    row('Start with Windows', { check: t.autostart });
  if (t.restart) html += row(t.restart);
  html += sep + row('Quit Kustom');
  const doc = `<!doctype html><html><head><style>
    body{margin:0;background:#202020;font:14px "Segoe UI",system-ui,sans-serif;display:flex;gap:4px;padding:16px;align-items:flex-start}
    .menu{background:#2c2c2c;color:#fff;border:1px solid #444;border-radius:8px;padding:4px;min-width:260px;box-shadow:0 8px 24px #0008}
    .sub{margin-top:66px}.item{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px}
    .item.dis{color:#9a9a9a}.item.bold{font-weight:700}.mark{width:16px}.arrow{margin-left:auto}
    .sep{height:1px;background:#444;margin:4px 6px}.tip{position:absolute;bottom:12px;left:16px;background:#2c2c2c;color:#fff;border:1px solid #444;padding:4px 8px;border-radius:4px;font-size:12px}
  </style></head><body><div class="menu">${html}</div>${sub}<div class="tip">${t.tooltip}</div></body></html>`;
  const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.setContent(doc);
  await page.screenshot({ path: join(outDir, `m178-${name}-menu.png`) });
  await context.close();
}

await browser.close();
console.log(report.join('\n'));
