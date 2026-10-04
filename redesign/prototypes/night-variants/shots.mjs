import { chromium } from '../node_modules/playwright/index.mjs';
const out = '/Users/suyaser/lol/.claude/worktrees/agent-a0b69a62e2c7f8503/redesign/screens/m14/';
const base = 'http://localhost:3120';
const game = process.env.GAME;
const screens = [
  ['tonight-real', '/g/customs'],
  ['tonight-balanced', '/kit/tonight/balanced'],
  ['tonight-finished', '/kit/tonight/finished'],
  ['board', '/g/customs/leaderboard'],
  ['game', `/g/customs/games/${game}`],
  ['landing', '/'],
  ['mode', '/kit/mode'],
];
const variants = [['current', 'c'], ['v1', 'v1'], ['v2', 'v2']];
const only = process.argv[2];
const b = await chromium.launch();
for (const w of [375, 1440]) {
  for (const [vname, q] of variants) {
    const ctx = await b.newContext({ viewport: { width: w, height: w === 375 ? 812 : 900 }, deviceScaleFactor: w === 375 ? 2 : 1 });
    const p = await ctx.newPage();
    for (const [name, path] of screens) {
      if (only && only !== name) continue;
      const url = base + path + (path.includes('?') ? '&' : '?') + 'night=' + q;
      await p.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
      await p.evaluate(() => document.fonts.ready);
      await p.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await p.waitForTimeout(400);
      const info = await p.evaluate(() => ({
        night: document.documentElement.dataset.night ?? 'c',
        theme: document.documentElement.dataset.theme,
        hscroll: document.documentElement.scrollWidth > innerWidth,
      }));
      console.log(w, vname, name, JSON.stringify(info));
      // Grow the viewport to the page so the fixed tab bar sits at the bottom, not mid-page.
      const vh = w === 375 ? 812 : 900;
      const full = await p.evaluate(() => document.documentElement.scrollHeight);
      await p.setViewportSize({ width: w, height: Math.max(vh, full) });
      await p.waitForTimeout(250);
      await p.screenshot({ path: `${out}night-${vname}-${name}-${w}.png` });
      await p.setViewportSize({ width: w, height: vh });
    }
    await ctx.close();
  }
}
await b.close();
