// Fresh captures for the 05-design check list: every route at 375 Night (full page), Day spot checks,
// forced colours, 320 reflow, and the Tonight live states from the kit.
import { chromium } from 'playwright';
import fs from 'node:fs';

const DIR = process.argv[2];
fs.mkdirSync(DIR, { recursive: true });
const G = '7855be62-4526-4fd2-97cd-cab389676ac1';
const P = 'http://localhost:3111';
const D = 'http://localhost:3112';
const slug = (p) => (p === '/' ? 'landing' : p.replace(/^\//, '').replace(/\?.*$/, '').replace(G, 'game').replace(/IlghJ3G9Sn6w1lQJGo70vg/, 'code').replace(/\//g, '-'));
const prod = ['/', '/how', '/download', '/new', '/join/IlghJ3G9Sn6w1lQJGo70vg', '/g/customs', '/g/customs/leaderboard',
  '/g/customs/p/audit-p01', '/g/customs/games', `/g/customs/games/${G}`, '/g/customs/you', '/g/customs/mode',
  '/g/customs/stats', '/g/customs/stats/champions', '/g/customs/stats/1v1?a=audit-p01&b=audit-p02', '/g/customs/mystery',
  '/g/customs/admin', '/admin/login', '/nope'];
const kit = ['/kit/board', '/kit/you', '/kit/onboarding', '/kit/versus', '/kit/receipt',
  ...['empty', 'filling', 'balanced', 'in-game', 'finished', 'reconnecting', 'new-player'].map((s) => `/kit/tonight/${s}`)];

const browser = await chromium.launch();
async function shoot({ width, theme = 'night', forced = false, list, base, suffix }) {
  const ctx = await browser.newContext({ viewport: { width, height: 812 }, forcedColors: forced ? 'active' : 'none', colorScheme: 'dark' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('cn-theme', t); } catch {} }, theme);
  const page = await ctx.newPage();
  for (const p of list) {
    await page.goto(base + p, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/${slug(p)}-${suffix}.png`, fullPage: true });
  }
  await ctx.close();
}
await shoot({ width: 375, list: prod, base: P, suffix: 'night-375' });
await shoot({ width: 375, list: kit, base: D, suffix: 'night-375' });
await shoot({ width: 375, theme: 'day', list: ['/g/customs', `/g/customs/games/${G}`, '/g/customs/leaderboard', '/'], base: P, suffix: 'day-375' });
await shoot({ width: 375, theme: 'day', list: ['/kit/tonight/balanced'], base: D, suffix: 'day-375' });
await shoot({ width: 375, forced: true, list: ['/g/customs', `/g/customs/games/${G}`, '/g/customs/leaderboard'], base: P, suffix: 'forced-375' });
await shoot({ width: 375, forced: true, list: ['/kit/tonight/balanced', '/kit/tonight/in-game'], base: D, suffix: 'forced-375' });
await shoot({ width: 320, list: ['/g/customs', `/g/customs/games/${G}`, '/g/customs/stats'], base: P, suffix: 'night-320' });
await shoot({ width: 1440, list: ['/', '/g/customs', `/g/customs/games/${G}`, '/g/customs/leaderboard'], base: P, suffix: 'night-1440' });

// Focus behind the tab bar: Tab to the 5th board row at 375 and capture the viewport.
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(P + '/g/customs/leaderboard', { waitUntil: 'networkidle' });
  for (let i = 0; i < 18; i++) await page.keyboard.press('Tab');
  await page.screenshot({ path: `${DIR}/focus-under-tabbar-leaderboard-375.png` });
  await ctx.close();
}
await browser.close();
console.log('shots done');
