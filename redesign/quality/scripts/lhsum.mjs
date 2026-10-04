import fs from 'node:fs';
process.chdir(new URL('.', import.meta.url).pathname);
const DIR = process.env.OUT ?? 'lh';
const DEST = process.argv[2] ?? 'lighthouse-summary.json';
const names = ['/', '/g/customs', '/g/customs/leaderboard', '/g/customs/games', '/g/customs/games/<id>', '/g/customs/stats'];
const out = [];
for (let i = 1; i <= 6; i++) {
  const runs = [1, 2, 3].map((r) => JSON.parse(fs.readFileSync(`${DIR}/r${i}-${r}.json`, 'utf8')));
  const pick = (lh) => {
    const a = lh.audits;
    const items = a['network-requests']?.details?.items || [];
    const js = items.filter((x) => x.resourceType === 'Script').reduce((s, x) => s + (x.transferSize || 0), 0);
    const lcpEl = a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet;
    const bytes = items.reduce((s, x) => s + (x.transferSize || 0), 0);
    return {
      score: Math.round(lh.categories.performance.score * 100), lcp: a['largest-contentful-paint'].numericValue,
      fcp: a['first-contentful-paint'].numericValue, cls: a['cumulative-layout-shift'].numericValue,
      tbt: a['total-blocking-time'].numericValue, si: a['speed-index'].numericValue, jsKB: js / 1024, totalKB: bytes / 1024,
      unusedJsKB: (a['unused-javascript']?.details?.overallSavingsBytes || 0) / 1024, lcpEl,
      ttfb: a['server-response-time']?.numericValue,
      lhVersion: lh.lighthouseVersion, ff: lh.configSettings.formFactor, throttling: lh.configSettings.throttlingMethod,
    };
  };
  const ps = runs.map(pick);
  const med = [...ps].sort((a, b) => a.score - b.score || a.lcp - b.lcp)[1];
  out.push({ route: names[i - 1], median: med, runs: ps.map((p) => ({ score: p.score, lcp: Math.round(p.lcp), cls: +p.cls.toFixed(3), tbt: Math.round(p.tbt), jsKB: +p.jsKB.toFixed(1) })) });
  console.log(names[i - 1].padEnd(24), 'score', med.score, 'LCP', (med.lcp / 1000).toFixed(2) + 's', 'FCP', (med.fcp / 1000).toFixed(2), 'CLS', med.cls.toFixed(3), 'TBT', Math.round(med.tbt) + 'ms', 'JS', med.jsKB.toFixed(1) + 'KB', 'total', med.totalKB.toFixed(0), 'unusedJS', med.unusedJsKB.toFixed(1), 'ttfb', Math.round(med.ttfb), '| runs', ps.map((p) => p.score).join('/'), '|', med.lhVersion, med.ff, med.throttling, '| LCP el', (med.lcpEl || '').slice(0, 100));
}
fs.writeFileSync(DEST, JSON.stringify(out, null, 1));
