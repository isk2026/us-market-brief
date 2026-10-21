/*
 * 프리마켓 특징주 (dashboard section): live Finnhub quotes for volatile US mega caps + the watchlist,
 * sorted by absolute % change, with the current US session (pre-market / regular / after-hours / closed).
 * Contract: UMB.premarket = { html(), mount(container), unmount() }. Quotes and previous prices live at
 * module level so they survive dashboard re-renders (html() → mount() after every render).
 * All requests go through UMB.finnhub (rate limit, cache, key handling) — never bypassed.
 */
(function () {
  'use strict';
  const U = window.UMB;
  const { esc } = U;

  const CORE = ['TSLA', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO', 'NFLX', 'PLTR', 'MU', 'COIN', 'MSTR', 'SMCI'];
  const MAX = 18;
  const POLL_MS = 30 * 1000;
  const FLASH_MS = 1200;
  const TOP = 3;

  // Module state (survives re-mounts).
  const quotes = new Map();   // symbol → { c, d, dp, h, l, o, pc, t }
  const prevPrice = new Map(); // symbol → last rendered price (for flash)
  let lastPoll = 0;
  let lastError = '';
  let inflight = null;

  // Mount state.
  let root = null;
  let pollTimer = null;
  let tickTimer = null;
  let onClick = null;
  let onVisibility = null;

  const universe = () => [...new Set([...(U.state.watchlist || []).map((s) => String(s).toUpperCase()), ...CORE])].slice(0, MAX);
  const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- US session (America/New_York) ----------
  function nyParts(date = new Date()) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(date);
    const g = (t) => p.find((x) => x.type === t).value;
    return { weekday: g('weekday'), min: Number(g('hour')) * 60 + Number(g('minute')) };
  }
  const SESSIONS = [
    { from: 4 * 60, to: 9 * 60 + 30, key: 'pre', label: '프리마켓', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
    { from: 9 * 60 + 30, to: 16 * 60, key: 'regular', label: '정규장', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
    { from: 16 * 60, to: 20 * 60, key: 'after', label: '애프터마켓', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  ];
  const NEXT_LABEL = { pre: '정규장 개장', regular: '정규장 마감', after: '애프터마켓 종료', closed: '프리마켓 시작' };

  function session(now = new Date()) {
    const { weekday, min } = nyParts(now);
    const weekend = weekday === 'Sat' || weekday === 'Sun';
    const cur = weekend ? null : SESSIONS.find((s) => min >= s.from && min < s.to);
    // Next boundary: end of the current session, or the next 04:00 ET on a weekday.
    let minsLeft;
    if (cur) {
      minsLeft = cur.to - min;
    } else {
      // Days until the next weekday's 04:00 ET (Fri night → Mon, Sat → Mon, Sun → Mon).
      const days = { Sun: 1, Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 3, Sat: 2 };
      const beforePre = !weekend && min < 4 * 60;
      minsLeft = beforePre ? 4 * 60 - min : days[weekday] * 1440 - min + 4 * 60;
    }
    const at = new Date(Math.floor(now.getTime() / 60000) * 60000 + minsLeft * 60000);
    const kst = at.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const h = Math.floor(minsLeft / 60), m = minsLeft % 60;
    const left = h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
    const key = cur ? cur.key : 'closed';
    return {
      key,
      label: cur ? cur.label : '장 마감',
      cls: cur ? cur.cls : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
      next: `${NEXT_LABEL[key]}까지 ${left} (KST ${kst})`,
    };
  }

  // ---------- formatting ----------
  const money = (v) => (v == null ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (v) => (v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
  const signed = (v) => (v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`);
  const tone = (v) => (v == null || v === 0 ? 'text-slate-500' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
  const arrow = (v) => (v == null || v === 0 ? '■' : v > 0 ? '▲' : '▼');
  const etTime = (t) => (t ? new Date(t * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' ET' : '');
  const watched = (s) => U.isWatched(s);

  // ---------- rendering ----------
  function rangeBar(q) {
    if (!(q.h > q.l)) return '';
    const pos = (v) => Math.min(100, Math.max(0, ((v - q.l) / (q.h - q.l)) * 100));
    return `<div class="mt-2" title="${esc(`저가 ${money(q.l)} · 시가 ${money(q.o)} · 고가 ${money(q.h)}`)}">
      <div class="relative h-1.5 rounded-full bg-slate-200 dark:bg-slate-700" role="img" aria-label="당일 범위 ${money(q.l)}~${money(q.h)}, 현재 ${money(q.c)}">
        ${q.o ? `<span class="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-slate-400" style="left:${pos(q.o)}%"></span>` : ''}
        <span class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style="left:${pos(q.c)}%;background:var(--spark)"></span>
      </div>
      <div class="mt-0.5 flex justify-between text-[10px] text-slate-400"><span>저 ${money(q.l)}</span><span>고 ${money(q.h)}</span></div>
    </div>`;
  }

  function bigCard(sym, q) {
    return `<div class="min-w-0 rounded-xl border border-slate-200 p-3 dark:border-slate-800" data-pm="${esc(sym)}">
      <div class="flex items-center justify-between gap-2">
        <p class="truncate font-mono font-bold">${esc(sym)}${watched(sym) ? ' <span class="text-indigo-600 dark:text-indigo-400" title="관심종목">★</span>' : ''}</p>
        <span class="shrink-0 text-[10px] text-slate-400">${esc(etTime(q.t))}</span>
      </div>
      <p class="mt-1 font-mono text-xl font-bold tabular-nums" data-pm-price>$${money(q.c)}</p>
      <p class="font-mono text-sm tabular-nums ${tone(q.dp)}">${arrow(q.dp)} ${signed(q.d)} (${pct(q.dp)})</p>
      <p class="text-[11px] text-slate-500">전일 종가 $${money(q.pc)}</p>
      ${rangeBar(q)}
    </div>`;
  }

  function row(sym, q) {
    return `<li class="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 py-1.5 text-sm" data-pm="${esc(sym)}">
      <span class="truncate font-mono font-semibold">${esc(sym)}${watched(sym) ? '<span class="text-indigo-600 dark:text-indigo-400" title="관심종목">★</span>' : ''}</span>
      <span class="min-w-0 truncate text-right font-mono tabular-nums" data-pm-price>$${money(q.c)}</span>
      <span class="w-24 text-right font-mono text-xs tabular-nums ${tone(q.dp)}">${arrow(q.dp)} ${pct(q.dp)}</span>
    </li>`;
  }

  function listHtml() {
    const items = universe().map((s) => [s, quotes.get(s)]).filter(([, q]) => q)
      .sort((a, b) => Math.abs(b[1].dp || 0) - Math.abs(a[1].dp || 0));
    if (!items.length) {
      return `<p class="py-6 text-center text-sm text-slate-500">${lastError ? esc(lastError) : '시세를 불러오는 중…'}</p>`;
    }
    const top = items.slice(0, TOP), rest = items.slice(TOP);
    return `<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">${top.map(([s, q]) => bigCard(s, q)).join('')}</div>
      ${rest.length ? `<ul class="mt-3 divide-y divide-slate-100 dark:divide-slate-800">${rest.map(([s, q]) => row(s, q)).join('')}</ul>` : ''}
      ${lastError ? `<p class="mt-2 text-xs text-rose-600 dark:text-rose-400">⚠ ${esc(lastError)} · 마지막 시세를 표시 중</p>` : ''}`;
  }

  function statusHtml() {
    const s = session();
    const ago = lastPoll ? Math.max(0, Math.round((Date.now() - lastPoll) / 1000)) : null;
    return `<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}">${s.label}</span>
      <span class="text-[11px] text-slate-500">${esc(s.next)}</span>
      <span class="text-[11px] text-slate-400" data-pm-ago>${ago == null ? '' : `· ${ago}초 전 갱신`}</span>`;
  }

  function html() {
    const head = `<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <h2 class="text-base font-bold">프리마켓 특징주 <span class="text-xs font-normal text-slate-500">미국 대형·고변동 종목 + 관심종목 · 변동률 순</span></h2>
          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" data-pm-status>${statusHtml()}</div>
        </div>
        ${U.finnhub && U.finnhub.hasKey() ? '<button data-pm-refresh class="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" title="지금 새로고침" aria-label="프리마켓 시세 새로고침">⟳</button>' : ''}
      </div>`;
    const body = U.finnhub && U.finnhub.hasKey()
      ? `<div data-pm-list>${listHtml()}</div>
         <p class="mt-3 text-[11px] leading-relaxed text-slate-500">Finnhub 실시간 시세(마지막 체결가)이며 30초마다 갱신됩니다. 종목별 시각(ET)은 마지막 체결 시점입니다. 프리·애프터마켓 체결 반영 여부는 Finnhub 무료 데이터 범위에 따라 다를 수 있습니다.</p>`
      : `<div class="rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center dark:border-slate-700">
           <p class="font-semibold">실시간 시세에는 Finnhub API 키가 필요합니다</p>
           <p class="mt-1 text-sm text-slate-500">무료 키를 ⚙ 설정에 저장하면 TSLA·NVDA·AAPL 등 주요 종목의 등락률을 30초마다 업데이트합니다. 키 없이 가짜 숫자는 표시하지 않습니다.</p>
           <button data-action="settings" class="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">설정 열기</button>
         </div>`;
    return `<section id="premarket-root" class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-live="polite">${head}${body}</section>`;
  }

  // ---------- data ----------
  async function poll() {
    if (!U.finnhub || !U.finnhub.hasKey()) return;
    if (inflight) return inflight;
    inflight = (async () => {
      const syms = universe();
      const results = await Promise.allSettled(syms.map((s) => U.finnhub.get('quote', { symbol: s }, { ttl: 25000, priority: 0 })));
      let firstErr = null;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const q = r.value;
          if (q && !(q.c === 0 && q.pc === 0) && q.c != null) quotes.set(syms[i], q);
        } else if (!firstErr) {
          firstErr = r.reason;
        }
      });
      const ok = results.some((r) => r.status === 'fulfilled');
      lastError = ok ? '' : ((firstErr && firstErr.message) || '시세를 불러오지 못했습니다');
      lastPoll = Date.now();
    })().finally(() => { inflight = null; });
    await inflight;
    renderList();
  }

  // Re-render only the list; flash prices that changed since the last render.
  function renderList() {
    if (!root) return;
    const list = root.querySelector('[data-pm-list]');
    if (list) list.innerHTML = listHtml();
    const st = root.querySelector('[data-pm-status]');
    if (st) st.innerHTML = statusHtml();
    const flash = !reducedMotion();
    root.querySelectorAll('[data-pm]').forEach((el) => {
      const sym = el.dataset.pm;
      const q = quotes.get(sym);
      const before = prevPrice.get(sym);
      if (q && before != null && q.c !== before && flash) {
        const cls = q.c > before ? 'pm-flash-up' : 'pm-flash-down';
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), FLASH_MS);
      }
      if (q) prevPrice.set(sym, q.c);
    });
  }

  // ---------- lifecycle ----------
  function ensureStyles() {
    if (document.getElementById('pm-flash-style')) return;
    const st = document.createElement('style');
    st.id = 'pm-flash-style';
    st.textContent = `
      [data-pm]{transition:background-color 1.2s ease}
      .pm-flash-up{background-color:rgba(16,185,129,.18)!important;transition:none}
      .pm-flash-down{background-color:rgba(244,63,94,.18)!important;transition:none}
      @media (prefers-reduced-motion: reduce){[data-pm]{transition:none}}`;
    document.head.appendChild(st);
  }

  function schedule() {
    clearTimeout(pollTimer);
    if (!root || document.hidden) return;
    pollTimer = setTimeout(async () => { await poll(); schedule(); }, POLL_MS);
  }

  function mount(container) {
    unmount();
    root = container && container.querySelector('#premarket-root');
    if (!root) return;
    ensureStyles();
    onClick = (e) => {
      if (!e.target.closest('[data-pm-refresh]')) return;
      poll().then(schedule);
    };
    root.addEventListener('click', onClick);
    onVisibility = () => {
      if (!root) return;
      if (document.hidden) { clearTimeout(pollTimer); return; }
      poll().then(schedule); // resume immediately on show
    };
    document.addEventListener('visibilitychange', onVisibility);
    // "n초 전 갱신" + session badge tick.
    tickTimer = setInterval(() => {
      const st = root && root.querySelector('[data-pm-status]');
      if (st) st.innerHTML = statusHtml();
    }, 5000);
    if (U.finnhub && U.finnhub.hasKey()) {
      // Render cached quotes right away (prevPrice primed so a remount doesn't flash everything), then poll.
      quotes.forEach((q, s) => { if (!prevPrice.has(s)) prevPrice.set(s, q.c); });
      renderList();
      if (!document.hidden) {
        if (Date.now() - lastPoll > POLL_MS) poll().then(schedule);
        else schedule();
      }
    }
  }

  function unmount() {
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    pollTimer = tickTimer = null;
    if (root && onClick) root.removeEventListener('click', onClick);
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    onClick = onVisibility = null;
    root = null;
  }

  U.premarket = { html, mount, unmount, _session: session };
})();
