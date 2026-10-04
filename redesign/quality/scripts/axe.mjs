// Axe sweep: every route at 375 and 1440, Night and Day. Writes a summary JSON.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

const OUT = process.argv[2];
const GAME = '7855be62-4526-4fd2-97cd-cab389676ac1';
const PROD = 'http://localhost:3111';
const DEV = 'http://localhost:3112';
const prod = [
  '/', '/about', '/how', '/download', '/new', '/join/IlghJ3G9Sn6w1lQJGo70vg', '/ops',
  '/g/customs', '/g/customs/leaderboard', '/g/customs/p/audit-p01', '/g/customs/games',
  `/g/customs/games/${GAME}`, '/g/customs/you', '/g/customs/mode', '/g/customs/stats',
  '/g/customs/stats/champions', '/g/customs/stats/1v1', '/g/customs/stats/1v1?a=audit-p01&b=audit-p02',
  '/g/customs/mystery', '/g/customs/admin', '/g/customs/admin/members', '/g/customs/admin/discord',
  '/g/customs/admin/hosts', '/g/customs/admin/games', '/admin/login', '/nope',
].map((p) => [PROD, p]);
const states = ['empty','empty-admin','idle','filling','over-ten','balanced','reroll','in-game','finished','long-night','new-player','reconnecting'];
const dev = [
  '/kit', '/kit/board', '/kit/landing', '/kit/mode', '/kit/onboarding', '/kit/receipt', '/kit/versus', '/kit/you',
  ...states.map((s) => `/kit/tonight/${s}`),
].map((p) => [DEV, p]);
const only = process.env.ONLY;
const routes = (only === 'prod' ? prod : only === 'dev' ? dev : [...prod, ...dev]);

const browser = await chromium.launch();
const results = [];
for (const theme of ['night', 'day']) {
  for (const width of [375, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('cn-theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const [base, path] of routes) {
      try {
        const resp = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 120000 });
        await page.waitForTimeout(300);
        const r = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']).analyze();
        const v = r.violations.map((x) => ({
          id: x.id, impact: x.impact, help: x.help,
          nodes: x.nodes.slice(0, 8).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(0,3).join(' | ') })),
          count: x.nodes.length,
        }));
        results.push({ theme, width, base: base === PROD ? 'prod' : 'dev', path, status: resp?.status(), violations: v });
        const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical');
        console.log(theme, width, path, resp?.status(), 'serious+critical:', bad.map((x) => `${x.id}(${x.count})`).join(',') || '-', '| other:', v.filter((x)=>!bad.includes(x)).map((x)=>`${x.id}(${x.count})`).join(',') || '-');
      } catch (e) {
        console.log('ERR', theme, width, path, e.message.slice(0, 200));
        results.push({ theme, width, path, error: e.message.slice(0, 200) });
      }
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
