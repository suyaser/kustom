// Hand checks automated where a script can see them: landmarks, keyboard, reflow, targets, motion.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2];
const GAME = '7855be62-4526-4fd2-97cd-cab389676ac1';
const P = 'http://localhost:3111';
const D = 'http://localhost:3112';
const routes = [
  [P, '/'], [P, '/about'], [P, '/how'], [P, '/download'], [P, '/new'], [P, '/join/IlghJ3G9Sn6w1lQJGo70vg'],
  [P, '/g/customs'], [P, '/g/customs/leaderboard'], [P, '/g/customs/p/audit-p01'], [P, '/g/customs/games'],
  [P, `/g/customs/games/${GAME}`], [P, '/g/customs/you'], [P, '/g/customs/mode'], [P, '/g/customs/stats'],
  [P, '/g/customs/stats/champions'], [P, '/g/customs/stats/1v1?a=audit-p01&b=audit-p02'], [P, '/g/customs/mystery'],
  [P, '/g/customs/admin'], [P, '/admin/login'], [P, '/nope'],
  [D, '/kit/tonight/balanced'], [D, '/kit/tonight/in-game'], [D, '/kit/tonight/finished'], [D, '/kit/tonight/filling'],
  [D, '/kit/board'], [D, '/kit/you'], [D, '/kit/onboarding'], [D, '/kit/versus'], [D, '/kit/mode'],
];

const browser = await chromium.launch();
const report = { landmarks: [], reflow: [], targets: [], truncation: [], motion: [], keyboard: [], mode: null };

async function audit(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
    const name = (el) => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent?.trim()).join(' ') || '').trim();
    const h1 = [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().slice(0, 60));
    const navs = [...document.querySelectorAll('nav,[role=navigation]')].map((n) => name(n) || '(unlabelled)');
    const live = [...document.querySelectorAll('[aria-live],[role=status],[role=alert],[role=log]')].map((n) => `${n.getAttribute('role') || ''}/${n.getAttribute('aria-live') || ''}:${n.textContent.trim().slice(0, 50)}`);
    const mains = document.querySelectorAll('main').length;
    const skip = document.querySelector('a[href="#main"]');
    const skipFirst = skip && document.querySelector('a[href],button,input,select,summary,textarea') === skip;
    const mainId = !!document.getElementById('main');
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName[1]);
    const jumps = []; for (let i = 1; i < headings.length; i++) if (headings[i] - headings[i - 1] > 1) jumps.push(`h${headings[i - 1]}->h${headings[i]}`);
    // targets
    const small = [];
    for (const el of document.querySelectorAll('a[href],button,summary,select,input:not([type=hidden]),[role=tab],[role=switch],textarea')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const inline = getComputedStyle(el).display === 'inline' && el.closest('p,li,dd,td') && (el.closest('p,li,dd,td').textContent.trim().length > el.textContent.trim().length + 3);
      if ((r.width < 44 || r.height < 44) && !inline && !el.classList.contains('sr-only')) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // truncation
    const trunc = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if ((s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' && s.webkitLineClamp) && el.scrollWidth > el.clientWidth + 1) trunc.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}"`);
    }
    return { h1, navs, live, mains, skipFirst, mainId, jumps, small, trunc, lang: document.documentElement.lang, title: document.title };
  });
}

async function overflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const sw = document.documentElement.scrollWidth;
    const off = [];
    if (sw > w) for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > w + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed') { let p = el.parentElement, clipped = false; while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { clipped = true; break; } p = p.parentElement; } if (!clipped) off.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} "${el.textContent.trim().slice(0, 30)}" r=${Math.round(r.right)}`); } }
    return { w, sw, off: off.slice(0, 6) };
  });
}

// 1. landmarks, targets, truncation at 375 Night
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  for (const [b, p] of routes) {
    await page.goto(b + p, { waitUntil: 'networkidle', timeout: 120000 });
    const a = await audit(page);
    report.landmarks.push({ path: p, h1: a.h1, navs: a.navs, live: a.live, mains: a.mains, skipFirst: a.skipFirst, mainId: a.mainId, jumps: a.jumps, lang: a.lang, title: a.title });
    report.targets.push({ path: p, small: a.small });
    report.truncation.push({ path: p, trunc: a.trunc });
  }
  await ctx.close();
}

// 2. reflow: 320 wide; 1280 at 200% zoom (= 640 css px); 375 with 200% root text
for (const mode of ['320', 'zoom200', 'text200']) {
  const width = mode === '320' ? 320 : mode === 'zoom200' ? 640 : 375;
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: mode === 'zoom200' ? 2 : 1 });
  const page = await ctx.newPage();
  for (const [b, p] of routes) {
    await page.goto(b + p, { waitUntil: 'networkidle', timeout: 120000 });
    if (mode === 'text200') await page.addStyleTag({ content: 'html{font-size:200% !important}' });
    await page.waitForTimeout(150);
    const o = await overflow(page);
    report.reflow.push({ mode, path: p, ...o });
  }
  await ctx.close();
}

// 3. reduced motion: running animations
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const [b, p] of [[P, '/g/customs'], [D, '/kit/tonight/in-game'], [D, '/kit/tonight/filling'], [D, '/kit/tonight/reroll'], [P, '/g/customs/games']]) {
    await page.goto(b + p, { waitUntil: 'networkidle', timeout: 120000 });
    const r = await page.evaluate(() => document.getAnimations().map((a) => `${a.constructor.name}:${a.animationName || a.transitionProperty || ''} on ${a.effect?.target?.tagName?.toLowerCase()}.${String(a.effect?.target?.className || '').slice(0, 40)} dur=${a.effect?.getTiming?.().duration}`));
    report.motion.push({ path: p, running: r });
  }
  await ctx.close();
}

// 4. keyboard: first 20 Tab stops on Tonight and game page, 375 and 1440
for (const width of [375, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  for (const [b, p] of [[P, '/g/customs'], [P, `/g/customs/games/${GAME}`], [P, '/g/customs/leaderboard'], [P, '/new'], [D, '/kit/tonight/balanced']]) {
    await page.goto(b + p, { waitUntil: 'networkidle', timeout: 120000 });
    const stops = [];
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => {
        const el = document.activeElement; if (!el || el === document.body) return 'body';
        const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        const bars = [...document.querySelectorAll('header,nav')].filter((n) => ['fixed', 'sticky'].includes(getComputedStyle(n).position) && !n.contains(el)).map((n) => n.getBoundingClientRect());
        const covered = bars.some((b) => r.top < b.bottom && r.bottom > b.top && r.left < b.right && r.right > b.left);
        const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? `outline ${s.outlineWidth} ${s.outlineColor}` : (s.boxShadow !== 'none' ? 'shadow' : 'NONE');
        return `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34)}" ring=${ring}${covered ? ' COVERED' : ''}`;
      }));
    }
    // skip link works?
    await page.goto(b + p, { waitUntil: 'networkidle' });
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    const afterSkip = await page.evaluate(() => { const el = document.activeElement; return `${el.tagName.toLowerCase()} in-main=${!!el.closest('main')} "${el.textContent.trim().slice(0, 30)}"`; });
    report.keyboard.push({ width, path: p, stops, afterSkip });
  }
  await ctx.close();
}

// 5. mode panel trap + Escape (prod Tonight, then kit filling)
const modeRes = [];
for (const [b, p, width] of [[P, '/g/customs', 375], [P, '/g/customs', 1440], [D, '/kit/tonight/filling', 1440]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(b + p, { waitUntil: 'networkidle', timeout: 120000 });
  const link = page.locator('a[href*="/mode"]').first();
  if (await link.count() === 0) { modeRes.push({ p, width, note: 'no mode link' }); await ctx.close(); continue; }
  await link.focus();
  const trigger = await page.evaluate(() => document.activeElement.textContent.trim().slice(0, 40));
  await page.keyboard.press('Enter');
  await page.waitForSelector('[role=dialog]', { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return { dialog: !!d, focus: document.activeElement.tagName + ' ' + document.activeElement.textContent.trim().slice(0, 30), url: location.pathname }; });
  let escaped = 0;
  for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')))) escaped++; }
  let back = 0;
  for (let i = 0; i < 20; i++) { await page.keyboard.press('Shift+Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')))) back++; }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ dialog: !!document.querySelector('[role=dialog]'), focus: document.activeElement.tagName + ' ' + document.activeElement.textContent.trim().slice(0, 40), url: location.pathname, inert: [...document.body.children].filter((e) => e.inert).length }));
  modeRes.push({ p, width, trigger, open, tabEscapes: escaped, shiftTabEscapes: back, after });
  await ctx.close();
}
report.mode = modeRes;

await browser.close();
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log('done');
