import process from 'node:process';
import {
  fillsByThird,
  type GameRecord,
  type Metrics,
  makeWorld,
  metrics,
  run,
  VARIANTS,
  type VariantName,
} from './formation-sim/sim.ts';

/**
 * M18.13's acceptance check: `redesign/research/team-formation.md` §3's two simulations, the
 * paired evenness experiment and "who gets filled", rerun on the Kustom scale with core's shipped
 * balancer against the M18.2 one it replaced. The world and its random streams are the report's;
 * see `formation-sim/sim.ts` for what is rescaled and what is new.
 *
 *   pnpm --filter web formation-sim [seeds=20] [games=600]
 *
 * No database, no network, no credentials; deterministic for the same arguments. Dev only.
 */

const SEEDS = Number(process.argv[2] ?? 20);
const GAMES = Number(process.argv[3] ?? 600);
/** The report's main window (games 300 to the end) and its fills window (100 to the end). */
const EVEN_FROM = Math.min(300, Math.floor(GAMES / 2));
const FILLS_FROM = Math.min(100, Math.floor(GAMES / 6));
/** M18.14 adds `sameTen`: the null world with the same ten every night (`RunOptions.fixedTen`). */
const WORLDS = {
  null: { synPts: 0, fixedTen: false },
  strong: { synPts: 9, fixedTen: false },
  sameTen: { synPts: 0, fixedTen: true },
} as const;
const KEYS: readonly (keyof Metrics)[] = [
  'trueEdge',
  'stomp',
  'shownEdge',
  'off',
  'repeats',
  'sameTen',
  'repeatsSameTen',
];

type PerSeed = Record<VariantName, Metrics[]>;

const fills: Record<VariantName, { off: number; seats: number }[]> = Object.fromEntries(
  VARIANTS.map((v) => [v, [0, 1, 2].map(() => ({ off: 0, seats: 0 }))]),
) as Record<VariantName, { off: number; seats: number }[]>;

const started = Date.now();
for (const [worldName, { synPts, fixedTen }] of Object.entries(WORLDS)) {
  const per: PerSeed = Object.fromEntries(VARIANTS.map((v) => [v, []])) as unknown as PerSeed;
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const world = makeWorld(seed, synPts);
    for (const variant of VARIANTS) {
      const recs: GameRecord[] = run(world, variant, GAMES, { fixedTen });
      per[variant].push(metrics(recs.slice(EVEN_FROM)));
      if (synPts === 0 && !fixedTen) {
        fillsByThird(world, recs.slice(FILLS_FROM)).forEach((cell, i) => {
          const into = fills[variant][i] as { off: number; seats: number };
          into.off += cell.off;
          into.seats += cell.seats;
        });
      }
    }
  }

  for (const baseline of ['before', 'm1813'] as const) {
    console.log(
      `\n=== world ${worldName}, games ${EVEN_FROM}-${GAMES}, ${SEEDS} seeds: mean [paired difference from ${baseline} ± 2 se] ===`,
    );
    console.log(`${'variant'.padEnd(12)}${KEYS.map((k) => k.padStart(22)).join('')}`);
    for (const variant of VARIANTS) {
      // The M18.14 table only needs the shipped rule against the one it replaced.
      if (baseline === 'm1813' && variant !== 'm1813' && variant !== 'after') continue;
      const rows = per[variant];
      const base = per[baseline];
      const cells = KEYS.map((k) => {
        // `repeatsSameTen` is NaN for a seed with no same-ten game: left out, pairwise.
        const ok = rows.map((r, i) => Number.isFinite(r[k]) && Number.isFinite((base[i] as Metrics)[k]));
        const kept = rows.filter((_, i) => ok[i]);
        if (kept.length < 2) return 'n/a'.padStart(22);
        const mean = kept.reduce((s, r) => s + r[k], 0) / kept.length;
        if (variant === baseline) return mean.toFixed(2).padStart(22);
        const d = rows.flatMap((r, i) => (ok[i] ? [r[k] - (base[i] as Metrics)[k]] : []));
        const dm = d.reduce((s, x) => s + x, 0) / d.length;
        const se = Math.sqrt(d.reduce((s, x) => s + (x - dm) ** 2, 0) / (d.length - 1) / d.length) || 0;
        return `${mean.toFixed(2)} [${dm >= 0 ? '+' : ''}${dm.toFixed(2)}±${(2 * se).toFixed(2)}]`.padStart(
          22,
        );
      });
      console.log(`${variant.padEnd(12)}${cells.join('')}`);
    }
  }
}

console.log(
  `\n=== who gets filled: off-main share by true-skill third, world null, games ${FILLS_FROM}-${GAMES} ===`,
);
console.log(
  `${'variant'.padEnd(12)}${['weakest', 'middle', 'strongest', 'weak/strong'].map((h) => h.padStart(12)).join('')}`,
);
for (const variant of VARIANTS) {
  const shares = fills[variant].map((c) => (100 * c.off) / c.seats);
  const ratio = (shares[0] as number) / (shares[2] as number);
  console.log(
    `${variant.padEnd(12)}${shares.map((s) => `${s.toFixed(1)}%`.padStart(12)).join('')}${ratio.toFixed(2).padStart(12)}`,
  );
}
console.log(`\n${((Date.now() - started) / 1000).toFixed(0)} s`);
