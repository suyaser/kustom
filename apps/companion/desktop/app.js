// Kustom's window (05-design §9). A painter: every word and every state comes from the Rust view model
// (src-tauri/src/model.rs, sent on "kustom://view"); this file only puts it in the DOM, formats times in the
// PC's locale, and sends button presses back as commands. No framework, no bundler.

(() => {
  const bridge = window.__TAURI__ ?? window.__KUSTOM_HARNESS__;
  const invoke = (cmd, args) => bridge.core.invoke(cmd, args).catch(() => undefined);
  const $ = (id) => document.getElementById(id);

  let lastScreen = null;
  let lastAnswerId = 0;
  let lastAnnounceId = null;
  let current = null;

  const setText = (el, text) => {
    if (el.textContent !== (text ?? '')) el.textContent = text ?? '';
  };
  const show = (el, visible) => {
    el.hidden = !visible;
  };
  const setDisabled = (el, disabled) => {
    if (disabled) el.setAttribute('aria-disabled', 'true');
    else el.removeAttribute('aria-disabled');
  };
  const disabled = (el) => el.getAttribute('aria-disabled') === 'true';

  function paintSlot(el, slot) {
    if (!slot) {
      el.replaceChildren();
      el.removeAttribute('role');
      el.removeAttribute('data-role');
      return;
    }
    const role = slot.role === 'none' ? null : slot.role;
    if (role) el.setAttribute('role', role);
    else el.removeAttribute('role');
    el.dataset.role = slot.role;
    const lines = slot.lines.map((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      return p;
    });
    const same =
      el.childElementCount === lines.length &&
      lines.every((p, i) => el.children[i].textContent === p.textContent);
    if (!same) el.replaceChildren(...lines);
  }

  // --- Time, in the Windows locale (24 or 12 hour as the PC is set) -----------------------------------------
  // `timeStyle: 'short'` is the locale's own clock: en-GB `21:42`, en-US `9:42 PM`.
  const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  // `{ day, time }`: the day words (none today, `Yesterday`, `Sat 3 Oct,`) in the text face, the time in mono.
  function when(iso, yesterdayWord) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return { day: '', time: '' };
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
    const time = timeFmt.format(at);
    if (at >= startOfToday) return { day: '', time };
    if (at >= startOfYesterday) return { day: yesterdayWord, time };
    return { day: `${dayFmt.format(at)},`, time };
  }

  function glyph(side) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(ns, 'path');
    // ◣ blue (bottom-left base), ◥ red (top-right), 05-design 3.3.
    path.setAttribute('d', side === 'blue' ? 'M0 0V12H12Z' : 'M0 0H12V12Z');
    svg.append(path);
    return svg;
  }

  function paintLastGame(el, game) {
    const key = JSON.stringify(game);
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const parts = [];
    if (game.kind === 'none') {
      parts.push(document.createTextNode(game.text));
    } else {
      const stamp = when(game.at, game.yesterday);
      if (stamp.day) parts.push(document.createTextNode(`${stamp.day} `));
      const time = document.createElement('span');
      time.className = 'mono';
      time.textContent = stamp.time;
      parts.push(time, document.createTextNode(' · '));
      if (game.kind === 'posted') {
        const winner = document.createElement('span');
        winner.className = `winner winner-${game.side}`;
        winner.setAttribute('aria-label', game.winner);
        const word = document.createElement('span');
        word.textContent = game.winner;
        winner.append(glyph(game.side), word);
        const minutes = document.createElement('span');
        minutes.className = 'mono';
        minutes.textContent = `${game.minutes} ${game.unit}`;
        parts.push(winner, document.createTextNode(' · '), minutes);
      } else {
        parts.push(document.createTextNode(game.text));
      }
    }
    const wrap = document.createElement('span');
    wrap.append(...parts);
    el.replaceChildren(wrap);
  }

  // --- Screens ----------------------------------------------------------------------------------------------
  function paintLink(link) {
    show($('link-back'), Boolean(link.back));
    setText($('link-back'), link.back);
    setText($('link-heading'), link.heading);
    setText($('link-step-1'), link.steps[0]);
    setText($('link-step-2'), link.steps[1]);
    setText($('code-label'), link.label);
    const code = $('code');
    code.readOnly = link.readOnly;
    if (code.value !== link.code && document.activeElement !== code) code.value = link.code;
    setText($('link-button'), link.button);
    setDisabled($('link-button'), link.buttonDisabled);
    paintSlot($('link-slot'), link.slot);
    if (link.answerId !== lastAnswerId) {
      lastAnswerId = link.answerId;
      if (link.fieldAction === 'select') {
        code.value = link.code;
        code.focus();
        code.select();
      } else if (link.fieldAction === 'clear') {
        code.value = '';
      } else if (link.fieldAction === 'clearAndFocus') {
        code.value = '';
        code.focus();
      }
    }
  }

  function paintHome(home) {
    const card = home.update;
    show($('update-card'), Boolean(card));
    if (card) {
      setText($('update-text'), card.text);
      setText($('restart-now'), card.button);
      setText($('update-line'), card.line);
    }
    setText($('recording-for'), home.recordingFor);
    setText($('group-name'), home.groupName);
    show($('linked-line'), Boolean(home.linkedLine));
    setText($('linked-line'), home.linkedLine);

    const sw = home.switcher;
    show($('switcher'), Boolean(sw));
    if (sw) {
      setText($('switch-label'), sw.label);
      const select = $('group-select');
      const key = JSON.stringify(sw.options);
      if (select.dataset.key !== key) {
        select.dataset.key = key;
        select.replaceChildren(
          ...sw.options.map((o) => {
            const option = document.createElement('option');
            option.value = o.id;
            option.textContent = o.name;
            option.selected = o.selected;
            return option;
          }),
        );
      }
      setDisabled(select, sw.disabled);
      setText($('switch-line'), sw.line);
    }
    setText($('link-another'), home.linkAnother);

    const league = home.league;
    const block = league.cantFind;
    show($('league-row'), !block);
    show($('cant-find'), Boolean(block));
    setText($('league-label'), league.label);
    setText($('league-text'), league.text);
    // SVG elements have no `hidden` property: the dot's shape is a data attribute the CSS reads.
    $('league-dot').dataset.solid = String(league.solid);
    if (block) {
      setText($('cant-find-label'), league.label);
      setText($('cant-find-title'), block.title);
      setText($('cant-find-line'), block.line);
      setText($('browse'), block.browse);
      setText($('try-again'), block.tryAgain);
      setDisabled($('browse'), block.busy);
      setDisabled($('try-again'), block.busy);
      setText($('cant-find-hint'), block.hint);
    }
    show($('league-slot'), Boolean(league.slot));
    paintSlot($('league-slot'), league.slot);

    setText($('last-label'), home.lastGameLabel);
    paintLastGame($('last-value'), home.lastGame);

    const tonight = $('open-tonight');
    setText(tonight, home.openTonight);
    tonight.className = `${home.openTonightPrimary ? 'primary' : 'secondary'} wide`;

    const folder = home.folderRow;
    setText($('folder-label'), folder.label);
    setText($('folder-value'), folder.value);
    setText($('change-folder'), folder.change);
    $('change-folder').setAttribute('aria-label', folder.changeLabel);
    setDisabled($('change-folder'), folder.busy);
    show($('folder-slot'), Boolean(folder.slot));
    paintSlot($('folder-slot'), folder.slot);
    setText($('closing-note'), home.closingNote);
  }

  function paintOld(old) {
    setText($('old-heading'), old.heading);
    setText($('old-line'), old.line);
    setText($('old-help'), old.help);
    setText($('retry'), old.button);
    setDisabled($('retry'), old.busy);
    paintSlot($('old-slot'), old.slot);
  }

  function paint(view) {
    current = view;
    setText($('version'), view.version);
    $('version').setAttribute('aria-label', view.versionLabel);

    const screens = {
      link: 'screen-link',
      home: 'screen-home',
      oldEngine: 'screen-old',
      restarting: 'screen-restarting',
    };
    for (const [name, id] of Object.entries(screens)) show($(id), view.screen === name);
    show($('footer'), view.screen !== 'restarting');
    show($('closing-note'), view.screen === 'home');

    if (view.link) paintLink(view.link);
    if (view.home) paintHome(view.home);
    if (view.oldEngine) paintOld(view.oldEngine);
    if (view.restarting) setText($('restarting-text'), view.restarting);

    const footer = view.footer;
    setText($('autostart-label'), footer.autostartLabel);
    $('autostart').checked = footer.autostart;
    setText($('open-logs'), footer.openLogs);
    setText($('riot-notice'), footer.riotNotice);

    if (view.announce && view.announce.id !== lastAnnounceId) {
      if (lastAnnounceId !== null) setText($('announcer'), view.announce.text);
      lastAnnounceId = view.announce.id;
    } else if (!view.announce && lastAnnounceId === null) {
      lastAnnounceId = 0;
    }

    // Focus on open: the code field on Link; nothing forced elsewhere (9.8).
    if (view.screen !== lastScreen) {
      lastScreen = view.screen;
      if (view.screen === 'link') $('code').focus();
    }
  }

  // --- Commands ---------------------------------------------------------------------------------------------
  const on = (id, event, handler) => $(id).addEventListener(event, handler);

  on('code', 'input', async (e) => {
    const field = e.target;
    const clean = await invoke('link_input', { raw: field.value });
    if (typeof clean === 'string' && field.value !== clean) {
      field.value = clean;
      field.setSelectionRange(clean.length, clean.length);
    }
  });
  on('link-form', 'submit', (e) => {
    e.preventDefault();
    if (disabled($('link-button'))) return;
    invoke('link_submit', { code: $('code').value });
  });
  on('link-back', 'click', () => invoke('link_back'));
  on('link-another', 'click', () => invoke('link_open'));
  on('group-select', 'change', (e) => {
    if (disabled(e.target)) return;
    invoke('choose_group', { id: e.target.value });
  });
  on('browse', 'click', async (e) => {
    if (disabled(e.currentTarget)) return;
    const button = e.currentTarget;
    await invoke('pick_folder', { origin: 'browse' });
    button.focus();
  });
  on('change-folder', 'click', async (e) => {
    if (disabled(e.currentTarget)) return;
    const button = e.currentTarget;
    await invoke('pick_folder', { origin: 'change' });
    button.focus();
  });
  on('try-again', 'click', (e) => {
    if (disabled(e.currentTarget)) return;
    invoke('try_again');
  });
  on('retry', 'click', (e) => {
    if (disabled(e.currentTarget)) return;
    invoke('retry_old_engine');
  });
  on('open-tonight', 'click', () => invoke('open_tonight'));
  on('restart-now', 'click', () => invoke('restart_now'));
  on('open-logs', 'click', () => invoke('open_logs'));
  on('autostart', 'change', (e) => invoke('set_autostart', { on: e.target.checked }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') invoke('hide_window');
  });

  bridge.event.listen('kustom://view', (event) => paint(event.payload));
  invoke('get_view').then((view) => {
    if (view && !current) paint(view);
  });
})();
