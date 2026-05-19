(() => {
  'use strict';

  const API         = 'https://api.faceit.com';
  const PANEL_CLASS = 'felo-panel';
  const POLL_MS     = 600;
  const TIMEOUT_MS  = 20_000;

  // ─── URL parsing ──────────────────────────────────────────────────────────

  function getMatchInfo() {
    const m = location.pathname.match(/\/([^/]+)\/room\/([a-f0-9-]+)/i);
    return m ? { game: m[1], matchId: m[2] } : null;
  }

  // ─── API ──────────────────────────────────────────────────────────────────

  async function fetchMatchRoster(matchId) {
    const res = await fetch(`${API}/match/v2/match/${matchId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { payload } = await res.json();

    return ['faction1', 'faction2'].map(key => {
      const faction = payload.teams?.[key];
      if (!faction) return null;

      // p.elo = ELO зафиксированное на момент создания матча — то же что в лобби
      const players = faction.roster.map(p => ({
        nickname: p.nickname,
        elo:      p.elo ?? p.faceit_elo ?? null,
      }));

      const valid  = players.filter(p => p.elo).map(p => p.elo);
      const avgElo = valid.length
        ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
        : null;

      return { name: faction.name, avgElo, players };
    }).filter(Boolean);
  }

  // ─── DOM search ───────────────────────────────────────────────────────────

  function findNickEl(nickname) {
    const all = document.body.querySelectorAll('span,a,p,div,h1,h2,h3,h4');
    for (const el of all) {
      if (el.children.length === 0 && el.textContent.trim() === nickname) return el;
    }
    return null;
  }

  function findTeamContainer(startEl, otherNicks) {
    let candidate = startEl.parentElement;
    let prev      = null;
    while (candidate && candidate !== document.body) {
      if (otherNicks.some(n => candidate.textContent.includes(n))) return prev;
      prev      = candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function waitForTeamContainers(teams) {
    const t1nicks = teams[0].players.map(p => p.nickname);
    const t2nicks = teams[1].players.map(p => p.nickname);

    return new Promise((resolve, reject) => {
      const start = Date.now();
      function check() {
        if (Date.now() - start > TIMEOUT_MS) { reject(new Error('Timeout')); return; }
        const n1 = findNickEl(t1nicks[0]);
        const n2 = findNickEl(t2nicks[0]);
        if (!n1 || !n2) { setTimeout(check, POLL_MS); return; }
        const c1 = findTeamContainer(n1, t2nicks);
        const c2 = findTeamContainer(n2, t1nicks);
        if (!c1 || !c2) { setTimeout(check, POLL_MS); return; }
        resolve({ c1, c2 });
      }
      check();
    });
  }

  // ─── ELO helpers ──────────────────────────────────────────────────────────

  function eloToLevel(elo) {
    if (!elo)        return 1;
    if (elo >= 2001) return 10;
    if (elo >= 1751) return 9;
    if (elo >= 1531) return 8;
    if (elo >= 1351) return 7;
    if (elo >= 1201) return 6;
    if (elo >= 1051) return 5;
    if (elo >= 901)  return 4;
    if (elo >= 751)  return 3;
    if (elo >= 501)  return 2;
    return 1;
  }

  function eloColor(elo) {
    if (!elo)        return '#555';
    if (elo >= 2001) return '#ff6500';
    if (elo >= 1751) return '#ff8c42';
    if (elo >= 1531) return '#eb4b4b';
    if (elo >= 1351) return '#d97070';
    if (elo >= 1201) return '#e8c240';
    if (elo >= 1051) return '#c8a825';
    if (elo >= 901)  return '#6fce6f';
    if (elo >= 751)  return '#4aaa4a';
    if (elo >= 501)  return '#87ceeb';
    return '#888';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ─── Panel DOM ────────────────────────────────────────────────────────────

  function createPanel(team, side) {
    const div = document.createElement('div');
    div.className = `${PANEL_CLASS} felo-${side}`;
    div.innerHTML = `
      <div class="felo-p-inner">
        <div class="felo-p-label">${side === 'left' ? '◀' : '▶'} AVG ELO</div>
        <div class="felo-p-avg" style="color:${eloColor(team.avgElo)}">
          ${team.avgElo ?? '—'}
        </div>
        <div class="felo-p-lvl" style="color:${eloColor(team.avgElo)}">
          LVL ${eloToLevel(team.avgElo)}
        </div>
        <div class="felo-p-divider"></div>
        <div class="felo-p-list">
          ${team.players.map(p => `
            <div class="felo-p-row">
              <span class="felo-p-nick">${esc(p.nickname)}</span>
              <span class="felo-p-elo" style="color:${eloColor(p.elo)}">${p.elo ?? '—'}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    return div;
  }

  // ─── Injection ────────────────────────────────────────────────────────────

  function cleanup() {
    document.querySelectorAll('.' + PANEL_CLASS).forEach(el => el.remove());
  }

  function inject(c1, c2, teams) {
    cleanup();
    const panel1 = createPanel(teams[0], 'left');
    const panel2 = createPanel(teams[1], 'right');

    const sharedParent = c1.parentElement;

    if (sharedParent && sharedParent === c2.parentElement) {
      // Идеальный случай: оба контейнера — прямые дети одного flex-родителя
      sharedParent.insertBefore(panel1, c1);
      sharedParent.appendChild(panel2);

      const d = getComputedStyle(sharedParent).display;
      if (!d.includes('flex') && !d.includes('grid')) {
        sharedParent.style.display = 'flex';
        sharedParent.style.alignItems = 'flex-start';
      }
      panel1.style.position = 'relative';
      panel2.style.position = 'relative';
    } else {
      // Fallback: fixed-позиционирование
      document.body.appendChild(panel1);
      document.body.appendChild(panel2);
      applyFixedPositions(c1, c2, panel1, panel2);
    }
  }

  function applyFixedPositions(c1, c2, panel1, panel2) {
    const W = 120;
    function update() {
      const r1 = c1.getBoundingClientRect();
      const r2 = c2.getBoundingClientRect();
      Object.assign(panel1.style, {
        position: 'fixed', zIndex: '2147483640',
        top: `${r1.top}px`, height: `${r1.height}px`, width: `${W}px`,
        left: `${Math.max(4, r1.left - W - 6)}px`,
      });
      Object.assign(panel2.style, {
        position: 'fixed', zIndex: '2147483640',
        top: `${r2.top}px`, height: `${r2.height}px`, width: `${W}px`,
        left: `${r2.right + 6}px`,
      });
    }
    update();
    new ResizeObserver(update).observe(document.body);
    window.addEventListener('scroll', update, { passive: true });
  }

  // ─── Main ─────────────────────────────────────────────────────────────────

  let running = false;

  async function run() {
    if (running) return;
    const info = getMatchInfo();
    if (!info) { cleanup(); return; }
    running = true;
    try {
      const teams      = await fetchMatchRoster(info.matchId);
      const { c1, c2 } = await waitForTeamContainers(teams);
      inject(c1, c2, teams);
    } catch (err) {
      console.warn('[FACEIT ELO]', err.message);
    } finally {
      running = false;
    }
  }

  // ─── SPA navigation watch ─────────────────────────────────────────────────

  let lastUrl  = location.href;
  let navTimer = null;

  new MutationObserver(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    clearTimeout(navTimer);
    navTimer = setTimeout(run, 700);
  }).observe(document.documentElement, { childList: true, subtree: true });

  run();
})();
