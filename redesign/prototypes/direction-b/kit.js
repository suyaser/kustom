/* Scrim Night prototype renderer. Static data, no network. Each page sets window.STATE. */
(() => {
  const STATE = window.STATE || 'balanced';
  const VIEWER = 'TheSHADOWREAPER';

  const ICON = {
    top: '<path d="M4 20V7a3 3 0 0 1 3-3h13" /><path d="M9 20v-6a5 5 0 0 1 5-5h6" opacity=".45"/>',
    jungle: '<path d="M12 21c0-6 1-11 7-17-7 1-12 5-12 11 0 2 1 4 2 5" /><path d="M12 21c-2-3-5-5-8-5" opacity=".45"/>',
    mid: '<path d="M5 19 19 5" /><path d="M4 9V5h4M20 15v4h-4" opacity=".45"/>',
    adc: '<circle cx="12" cy="12" r="7" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" opacity=".45"/>',
    support: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /><path d="M12 9v6M9 12h6" opacity=".45"/>',
  };
  const ROLE_WORD = { top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'Bot lane', support: 'Support' };
  const roleIcon = (r, cls = 'size-5') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[r]}</svg>`;

  const TEAMS = {
    blue: [
      { role: 'top', name: 'FoxHound', r: 1224, champ: 'Ornn' },
      { role: 'jungle', name: 'XETA', r: 1378, champ: 'Vi' },
      { role: 'mid', name: 'Ramzyinhović', r: 2638, champ: 'Ahri' },
      { role: 'adc', name: 'SugarPapy', r: 1218, champ: 'Jinx' },
      { role: 'support', name: 'Used2BeATahmMain', r: 1322, champ: 'Nautilus' },
    ],
    red: [
      { role: 'top', name: 'H4RDC0R33', r: 1531, champ: 'Darius' },
      { role: 'jungle', name: 'Syndrome Axes', r: 2291, champ: 'Lee Sin' },
      { role: 'mid', name: 'knifiy', r: 1454, champ: 'Syndra' },
      { role: 'adc', name: 'PRT Khokha', r: 1287, champ: 'Caitlyn' },
      { role: 'support', name: 'TheSHADOWREAPER', r: 1262, champ: 'Thresh', settling: '9/30' },
    ],
  };
  const fmt = (n) => n.toLocaleString('en-US');
  const sum = (t) => TEAMS[t].reduce((a, p) => a + p.r, 0);

  /* ---------- small parts ---------- */
  const marker = (side, cls = 'size-3.5') =>
    side === 'blue'
      ? `<span class="${cls} inline-block shrink-0 rounded-full bg-current" aria-hidden="true"></span>`
      : `<span class="${cls} inline-block shrink-0 rotate-45 rounded-[3px] bg-current" aria-hidden="true"></span>`;

  const youSticker = `<span class="sticker -rotate-3 bg-butter text-ink">You</span>`;
  const liveDot = `<span class="relative inline-flex size-2.5"><span class="live-ping absolute inset-0 rounded-full bg-butter"></span><span class="relative size-2.5 rounded-full bg-butter"></span></span>`;

  function winBar({ blue = 49, red = 51, size = 'lg', label = true }) {
    const h = size === 'lg' ? 'h-12 text-[17px]' : size === 'md' ? 'h-10 text-[15px]' : 'h-7 text-[13px]';
    return `
      <div class="relative" role="img" aria-label="Win chance: Blue ${blue} percent, Red ${red} percent">
        <div class="flex ${h} overflow-hidden rounded-full ring-2 ring-ink/60 font-display font-extrabold tabular-nums text-ink">
          <div class="pat-dots flex items-center gap-2 bg-blue pl-4" style="width:${blue}%">${label ? `${marker('blue', 'size-2.5')}<span>BLUE ${blue}%</span>` : ''}</div>
          <div class="w-[3px] bg-ink"></div>
          <div class="pat-stripes flex flex-1 items-center justify-end gap-2 bg-red pr-4">${label ? `<span>${red}% RED</span>${marker('red', 'size-2.5')}` : ''}</div>
        </div>
        <div class="pointer-events-none absolute -top-1.5 -bottom-1.5 left-1/2 w-0 border-l-2 border-dashed border-fg/70" aria-hidden="true"></div>
      </div>`;
  }

  function statChip(label, value, sub) {
    return `<div class="rounded-2xl bg-card-2 px-3 py-2.5">
      <div class="text-[13px] leading-tight text-muted">${label}</div>
      <div class="mt-0.5 font-display text-2xl font-extrabold tabular-nums leading-none">${value}</div>
      ${sub ? `<div class="mt-1 text-[12px] leading-tight text-faint">${sub}</div>` : ''}
    </div>`;
  }

  /* ---------- fairness receipt ---------- */
  function splitCard(s) {
    return `<div class="relative flex flex-col gap-3 rounded-2xl ${s.chosen ? 'bg-card-2 ring-2 ring-butter' : 'bg-card-2/60 ring-1 ring-line'} p-4">
      <div class="flex items-center justify-between gap-2">
        <h4 class="font-display text-lg font-bold">Split ${s.id}</h4>
        ${s.chosen ? '<span class="sticker rotate-2 bg-butter text-ink">Picked</span>' : `<span class="text-[13px] text-muted">${s.tag}</span>`}
      </div>
      ${winBar({ blue: s.blue, red: s.red, size: 'sm', label: false })}
      <dl class="grid grid-cols-3 gap-2 text-center">
        <div><dt class="text-[12px] text-muted">Win chance</dt><dd class="font-display text-lg font-extrabold tabular-nums">${s.blue}/${s.red}</dd></div>
        <div><dt class="text-[12px] text-muted">Rating gap</dt><dd class="font-display text-lg font-extrabold tabular-nums">${s.gap}</dd></div>
        <div><dt class="text-[12px] text-muted">Off-role</dt><dd class="font-display text-lg font-extrabold tabular-nums ${s.off ? 'text-butter' : ''}">${s.off}</dd></div>
      </dl>
      <p class="text-[15px] leading-snug text-muted">${s.note}</p>
    </div>`;
  }

  function receipt({ variant = 'full', open = false }) {
    if (variant === 'compact') {
      return `<section aria-labelledby="rc" class="card p-4 lg:p-5">
        <div class="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="rc" class="font-display text-lg font-bold">Fairness receipt</h2>
          <span class="text-[14px] text-muted">rolled 9:41 pm</span>
        </div>
        ${winBar({ size: 'md' })}
        <p class="mt-3 text-[15px] leading-snug text-muted">Ratings 45 apart out of about 7,800 · everyone on a main role.</p>
        <a href="receipt.html#how" class="mt-2 inline-flex min-h-11 items-center gap-1.5 font-semibold text-fg underline decoration-butter decoration-2 underline-offset-4">How the bot decided</a>
      </section>`;
    }
    const splits = [
      { id: 'A', chosen: true, blue: 49, red: 51, gap: 45, off: 0, note: 'The teams above. Closest odds with everyone on a main role.' },
      { id: 'B', tag: 'Runner-up', blue: 52, red: 48, gap: 93, off: 0, note: 'Same as A, but SugarPapy and PRT Khokha swap sides. Twice the rating gap.' },
      { id: 'C', tag: 'Rejected', blue: 50, red: 50, gap: 43, off: 2, note: 'SugarPapy and TheSHADOWREAPER swap sides and roles. Two points closer, but two people off their main.' },
    ];
    return `<section aria-labelledby="rf" class="card p-4 sm:p-5 lg:p-6">
      <div class="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="rf" class="font-display text-xl font-bold">Fairness receipt</h2>
        <span class="text-[14px] text-muted">rolled 9:41 pm</span>
      </div>
      ${winBar({ size: 'lg' })}
      <div class="mt-1.5 flex justify-between text-[13px] text-faint"><span>Blue side</span><span>dashed line = dead even</span><span>Red side</span></div>
      <p class="mt-4 text-[18px] font-medium leading-snug text-pretty lg:text-[19px]">Ratings are 45 points apart out of about 7,800, and everyone's on a main role.</p>
      <div class="mt-4 grid grid-cols-3 gap-2">
        ${statChip('Win chance', '49/51')}
        ${statChip('Rating gap', '45')}
        ${statChip('Off-role', '0')}
      </div>
      <details id="how" class="group mt-4" ${open ? 'open' : ''}>
        <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border-2 border-line px-4 font-semibold hover:bg-card-2 focus-visible:outline-3 focus-visible:outline-butter">
          <span>How the bot decided</span>
          <svg class="size-5 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </summary>
        <div class="mt-4 flex flex-col gap-5">
          <p class="max-w-[62ch] text-[16px] leading-relaxed text-muted">The bot made three splits from tonight's ratings and main roles, then kept the one with the closest odds that put nobody off-role. Here are all three.</p>
          <div class="grid gap-3 md:grid-cols-3">${splits.map(splitCard).join('')}</div>
          <ul class="grid gap-3 sm:grid-cols-2">
            <li class="flex items-start gap-3 rounded-2xl bg-card-2 p-4"><svg class="mt-0.5 size-6 shrink-0 text-butter" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 11V7a5 5 0 0 0-10 0v4"/><rect x="4" y="11" width="16" height="10" rx="3"/></svg><div><p class="font-semibold">Nobody picked these teams.</p><p class="text-[15px] text-muted">The split is the bot's call. An admin can only ask for the next one.</p></div></li>
            <li class="flex items-start gap-3 rounded-2xl bg-card-2 p-4"><svg class="mt-0.5 size-6 shrink-0 text-butter" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/></svg><div><p class="font-semibold">Admins can't edit ratings.</p><p class="text-[15px] text-muted">Ratings only move when the League client reports a finished game.</p></div></li>
          </ul>
          <div class="rounded-2xl border-2 border-dashed border-line p-4">
            <p class="text-[17px] font-semibold">The favoured side won 54% of 103 games.</p>
            <div class="relative mt-3 h-4 overflow-hidden rounded-full bg-card-2 ring-1 ring-line" role="img" aria-label="54 percent">
              <div class="h-full rounded-full bg-fg/80" style="width:54%"></div>
              <div class="absolute inset-y-0 left-1/2 border-l-2 border-dashed border-ink"></div>
            </div>
            <p class="mt-2 text-[15px] text-muted">A coin flip is 50%. Close odds should land just above it, and they do.</p>
          </div>
        </div>
      </details>
    </section>`;
  }

  /* ---------- team card ---------- */
  function teamCard(side, { ingame = false } = {}) {
    const isBlue = side === 'blue';
    const word = isBlue ? 'BLUE' : 'RED';
    const rows = TEAMS[side]
      .map((p) => {
        const you = p.name === VIEWER;
        return `<li class="relative grid grid-cols-[2.5rem_1fr_auto] items-center gap-2.5 px-3 py-3 sm:grid-cols-[2.75rem_1fr_auto] sm:gap-3 sm:px-4 ${you ? 'you-row' : ''}">
          <span class="grid size-10 place-items-center rounded-xl bg-ink/40 sm:size-11 ${isBlue ? 'text-blue' : 'text-red'}">${roleIcon(p.role)}</span>
          <div class="min-w-0">
            <div class="text-[13px] leading-tight text-muted">${ROLE_WORD[p.role]}</div>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="name font-display text-[17px] font-bold leading-tight xl:text-[19px]">${p.name}</span>${you ? youSticker + '<span class="sr-only">(you)</span>' : ''}${p.settling ? `<span class="inline-block rounded-full border border-dashed border-faint px-2 py-px text-[12px] text-muted">settling ${p.settling} games</span>` : ''}
            </div>
            ${ingame ? `<div class="mt-1 inline-flex items-center gap-1.5 text-[14px] text-fg/90"><span class="grid size-5 place-items-center rounded-md bg-fg/15 text-[10px] font-bold" aria-hidden="true">${p.champ.slice(0, 1)}</span>${p.champ}</div>` : ''}
          </div>
          <div class="text-right">
            <div class="font-display text-[20px] font-extrabold tabular-nums leading-none sm:text-[22px]">${fmt(p.r)}</div>
          </div>
        </li>`;
      })
      .join('');
    return `<section aria-label="${word} team" class="team-card ${isBlue ? 'team-blue' : 'team-red'} overflow-hidden rounded-[26px]">
      <header class="${isBlue ? 'bg-blue pat-dots' : 'bg-red pat-stripes'} flex items-center justify-between gap-3 px-4 py-3 text-ink">
        <div class="flex items-center gap-2.5">${marker(side, 'size-4')}<h3 class="font-display text-[30px] font-extrabold leading-none tracking-tight">${word}</h3></div>
        <div class="text-right leading-tight"><div class="text-[12px] font-semibold opacity-80">Team rating</div><div class="font-display text-xl font-extrabold tabular-nums">${fmt(sum(side))}</div></div>
      </header>
      <ul class="divide-y divide-line/70">${rows}</ul>
    </section>`;
  }

  /* ---------- chrome ---------- */
  const TABS = [
    ['Tonight', '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>'],
    ['Board', '<path d="M6 20V10M12 20V4M18 20v-7"/>'],
    ['Games', '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 10v4M6 12h4M15 11h.01M17 13h.01"/>'],
    ['More', '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'],
  ];
  const tabIcon = (d) => `<svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  const topBar = `<header class="sticky top-0 z-30 border-b-2 border-line bg-bg/95 backdrop-blur-sm">
    <div class="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-4 lg:px-8">
      <a href="balanced.html" class="flex min-h-11 items-center gap-2.5">
        <span class="grid size-9 -rotate-6 place-items-center rounded-xl bg-butter font-display text-xl font-extrabold text-ink shadow-[0_3px_0_#0e0c0a]">K</span>
        <span class="font-display text-[19px] font-bold leading-tight">Customs Night</span>
      </a>
      <nav class="hidden items-center gap-1 lg:flex" aria-label="Main">
        ${['Tonight', 'Board', 'Games', 'Stats', 'Daily', '1v1'].map((t, i) => `<a href="#" class="inline-flex min-h-11 items-center rounded-full px-4 font-semibold ${i === 0 ? 'bg-fg text-ink' : 'text-muted hover:bg-card hover:text-fg'}" ${i === 0 ? 'aria-current="page"' : ''}>${t}</a>`).join('')}
      </nav>
      <button class="grid size-11 place-items-center rounded-full bg-card-2 font-display text-sm font-bold ring-2 ring-red" aria-label="Signed in as TheSHADOWREAPER">TS</button>
    </div>
  </header>`;

  const bottomTabs = `<nav class="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden" aria-label="Main">
    <ul class="mx-auto grid max-w-md grid-cols-4">
      ${TABS.map(([t, d], i) => `<li><a href="#" class="flex min-h-16 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold ${i === 0 ? 'text-fg' : 'text-muted'}" ${i === 0 ? 'aria-current="page"' : ''}><span class="grid h-8 w-14 place-items-center rounded-full ${i === 0 ? 'bg-butter text-ink' : ''}">${tabIcon(d)}</span>${t}</a></li>`).join('')}
    </ul>
  </nav>`;

  /* ---------- rail ---------- */
  const TAPE = [
    { n: 3, winner: 'red', fav: 'Blue was 53%.', mins: 31, mvp: 'Syndrome Axes' },
    { n: 2, winner: 'blue', fav: 'Blue was 48%.', mins: 24, mvp: 'Ramzyinhović' },
    { n: 1, winner: 'blue', fav: 'Blue was 51%.', mins: 27, mvp: 'Raafat' },
  ];
  const BOARD = [
    ['Ramzyinhović', 2638], ['Syndrome Axes', 2291], ['Raafat', 1915], ['7ambolyy', 1894], ['Chaos', 1718],
  ];
  const LAST = [
    { n: 6, winner: 'red', fav: 'Red was 50%.', mins: 29, mvp: 'Chaos' },
    { n: 5, winner: 'blue', fav: 'Blue was 52%.', mins: 34, mvp: 'Raafat' },
    { n: 4, winner: 'red', fav: 'Red was 47%.', mins: 22, mvp: '7ambolyy' },
  ];
  const rail = (title = "Tonight's tape", TAPE_ = TAPE) => `<aside class="flex flex-col gap-5" aria-label="Tonight so far">
    <section class="card p-4 lg:p-5">
      <h2 class="font-display text-lg font-bold">${title}</h2>
      <ol class="mt-3 flex flex-col gap-2.5">
        ${TAPE_.map((g) => `<li class="flex items-stretch gap-3 rounded-2xl bg-card-2 p-3">
          <span class="${g.winner === 'blue' ? 'bg-blue pat-dots' : 'bg-red pat-stripes'} grid w-12 shrink-0 place-items-center rounded-xl font-display text-[13px] font-extrabold text-ink">${g.winner === 'blue' ? 'BLUE' : 'RED'}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2"><span class="font-semibold">Game ${g.n}</span><span class="text-[13px] text-muted">${g.mins} min</span></div>
            <p class="text-[14px] text-muted">${g.fav} ${g.winner === 'blue' ? 'Blue' : 'Red'} won.</p>
            <p class="mt-1 flex flex-wrap items-center gap-1.5 text-[14px]"><span class="sticker rotate-[-2deg] bg-fg text-ink">MVP</span>${g.mvp}</p>
          </div>
        </li>`).join('')}
      </ol>
    </section>
    <section class="card p-4 lg:p-5">
      <div class="flex items-baseline justify-between"><h2 class="font-display text-lg font-bold">Top of the board</h2><a href="#" class="inline-flex min-h-11 items-center text-[14px] font-semibold text-muted underline underline-offset-4">Full board</a></div>
      <ol class="mt-1 flex flex-col">
        ${BOARD.map(([n, r], i) => `<li class="flex min-h-11 items-center gap-3 border-b border-line/70 last:border-0"><span class="w-5 font-display font-extrabold tabular-nums text-faint">${i + 1}</span><span class="flex-1 font-semibold">${n}</span><span class="font-display font-extrabold tabular-nums">${fmt(r)}</span></li>`).join('')}
      </ol>
    </section>
  </aside>`;

  /* ---------- states ---------- */
  function statusStrip({ title, meta, extra = '' }) {
    return `<div class="flex flex-col gap-3 pt-5 lg:flex-row lg:items-end lg:justify-between lg:pt-8">
      <div>
        <p class="flex flex-wrap items-center gap-2 text-[15px] text-muted"><span class="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1 font-semibold text-fg ring-1 ring-line">${liveDot}Live</span>${meta}</p>
        <h1 class="mt-2 font-display text-[44px] font-extrabold leading-[0.95] tracking-tight lg:text-[64px]">${title}</h1>
      </div>
      ${extra}
    </div>`;
  }

  const youSide = `<div class="inline-flex max-w-full items-center gap-3 self-start rounded-2xl bg-card p-2 pr-4 ring-2 ring-line lg:self-auto">
    <span class="sticker -rotate-3 bg-butter text-ink">You</span>
    <span class="text-[16px]">on <b class="inline-flex items-center gap-1.5 text-red">${marker('red', 'size-2.5')}RED</b>, playing support</span>
  </div>`;

  const sittingOut = `<section class="flex items-start gap-3 rounded-[22px] border-2 border-dashed border-line p-4" aria-label="Sitting out">
    <svg class="mt-0.5 size-6 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 12h18M5 12v6M19 12v6M6 12V8h12v4"/></svg>
    <p class="text-[16px] leading-relaxed"><b class="font-display font-bold">Chaos</b> is sitting this one out. Each game goes to whoever has played least tonight, so Chaos is first in line for the next one.</p>
  </section>`;

  function pageBalanced(open) {
    return `${statusStrip({ title: 'Teams are set', meta: '<span>Saturday 3 Oct</span><span aria-hidden="true">·</span><span>Game 4 tonight</span>', extra: youSide })}
      <div class="mt-6">${receipt({ variant: 'full', open })}</div>
      <div class="mt-6 grid gap-5 xl:grid-cols-2">${teamCard('blue')}${teamCard('red')}</div>
      <p class="mt-3 text-[15px] text-muted">The host's client moves everyone to their side. If it doesn't, move yourself.</p>
      <div class="mt-5">${sittingOut}</div>`;
  }

  function pageInGame() {
    return `${statusStrip({ title: 'In game · <span id="clock" class="tabular-nums">14:32</span>', meta: '<span>Game 4</span><span aria-hidden="true">·</span><span>started 9:47 pm</span>', extra: youSide })}
      <div class="mt-6">${receipt({ variant: 'compact' })}</div>
      <div class="mt-6 grid gap-5 xl:grid-cols-2">${teamCard('blue', { ingame: true })}${teamCard('red', { ingame: true })}</div>
      <p class="mt-3 text-[15px] text-muted">Ratings move when it ends. Nobody needs to report anything.</p>
      <div class="mt-5">${sittingOut}</div>`;
  }

  function pageFilling() {
    const IN = [
      ['Raafat', 'top', '9:12'], ['7ambolyy', 'mid', '9:13'], ['Chaos', 'adc', '9:15'],
      ['knifiy', 'mid', '9:18'], ['Bot', 'top', '9:20'], ['TheSHADOWREAPER', 'adc', '9:21'],
    ];
    const pips = Array.from({ length: 10 }, (_, i) => `<span class="h-3 flex-1 rounded-full ${i < 6 ? 'bg-butter' : 'bg-card-2 ring-1 ring-line'}"></span>`).join('');
    return `${statusStrip({ title: '6 of 10 in', meta: '<span>Saturday 3 Oct</span><span aria-hidden="true">·</span><span>first game</span>' })}
      <div class="mt-4 flex gap-1.5" role="img" aria-label="6 of 10 seats filled">${pips}</div>
      <p class="mt-3 text-[17px]">Four more and the bot rolls teams. Join the League lobby; the host's companion does the rest.</p>
      <section class="card mt-6 p-4 lg:p-5" aria-labelledby="inh">
        <h2 id="inh" class="font-display text-lg font-bold">In the lobby</h2>
        <ul class="mt-3 grid gap-2 sm:grid-cols-2">
          ${IN.map(([n, r, t]) => {
            const you = n === VIEWER;
            return `<li class="grid grid-cols-[2.75rem_1fr_auto] items-center gap-3 rounded-2xl bg-card-2 p-2.5 ${you ? 'you-row' : ''}">
              <span class="grid size-11 place-items-center rounded-xl bg-ink/40 text-fg">${roleIcon(r)}</span>
              <div class="min-w-0"><div class="text-[13px] leading-tight text-muted">Mains ${ROLE_WORD[r].toLowerCase()}</div><div class="flex flex-wrap items-center gap-2"><span class="name font-display text-[18px] font-bold leading-tight">${n}</span>${you ? youSticker + '<span class="sr-only">(you)</span>' : ''}</div></div>
              <span class="text-[13px] tabular-nums text-faint">${t}</span>
            </li>`;
          }).join('')}
        </ul>
        <div class="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-butter/12 p-3 ring-1 ring-butter/40">
          <span class="font-semibold">Still needed:</span>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-butter px-3 py-1 font-semibold text-ink">${roleIcon('jungle', 'size-4')}Jungle</span>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-butter px-3 py-1 font-semibold text-ink">${roleIcon('support', 'size-4')}Support</span>
        </div>
        <p class="mt-3 flex min-h-11 items-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 text-[15px] text-muted">4 open seats · they fill as people join the lobby</p>
      </section>
      <p class="mt-4 text-[15px] text-muted">Nobody checks in here. You're counted the moment you join the League lobby.</p>`;
  }

  const MAIN = {
    balanced: () => pageBalanced(false),
    receipt: () => pageBalanced(true),
    ingame: pageInGame,
    filling: pageFilling,
  }[STATE];

  document.getElementById('app').innerHTML = `${topBar}
    <main class="mx-auto max-w-[1320px] px-4 pb-28 lg:px-8 lg:pb-16">
      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div class="min-w-0">${MAIN()}</div>
        <div class="lg:pt-8">${STATE === 'filling' ? rail('Last night, Fri 2 Oct', LAST) : rail()}</div>
      </div>
    </main>
    ${bottomTabs}`;

  if (STATE === 'receipt' && location.hash !== '#top') {
    requestAnimationFrame(() => document.getElementById('how')?.scrollIntoView({ block: 'start' }));
  }
})();
