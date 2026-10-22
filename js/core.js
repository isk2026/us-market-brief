/*
 * Shared helpers, state and data contract. Loaded first; everything hangs off window.UMB.
 *
 * Data contract (produced by data.js / api.js, consumed by views):
 *   NewsItem  { id, datetime (ms epoch), headline, summary: string[] (1-3 bullets), source, url,
 *               importance: 'High'|'Medium'|'Low',
 *               category: keyof CATEGORIES, sentiment: 'positive'|'negative'|'neutral', tickers: string[] }
 *   Briefing  { headline, overview, keyPoints: string[], watch: string[], tone, generatedAt (ISO), mock? }
 *   Event     { id, date: 'YYYY-MM-DD', time: 'HH:MM' (ET) | null, session: 'bmo'|'amc'|null,
 *               type: keyof EVENT_TYPES, importance: 1|2|3, title, detail?, ticker?, company?,
 *               forecast?, previous?, actual? }
 *               `id` must be stable across reloads and data sources — favorites are persisted by id.
 *               Earnings use earningsId(ticker, date) in both sample and live mode.
 *   Quote     { symbol, name, price: number, change: number (percent) }
 */
(function () {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const todayKey = () => dateKey(new Date());
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  const store = {
    get(k, fallback = null) {
      try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const KEYS = { apiKey: 'umb.apiKey', theme: 'umb.theme', watchlist: 'umb.watchlist', favorites: 'umb.favoriteEvents' };

  const CATEGORIES = {
    fed:      { label: '연준/금리',   cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
    macro:    { label: '거시경제',    cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
    earnings: { label: '실적',        cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
    tech:     { label: '기술',        cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
    energy:   { label: '에너지/원자재', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
    market:   { label: '시장 일반',   cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300' },
  };
  const SENTIMENTS = {
    positive: { label: '긍정', cls: 'text-emerald-600 dark:text-emerald-400', icon: '▲' },
    negative: { label: '부정', cls: 'text-rose-600 dark:text-rose-400', icon: '▼' },
    neutral:  { label: '중립', cls: 'text-slate-500 dark:text-slate-400', icon: '■' },
  };
  // cls = badge, chip = compact month-grid chip
  const EVENT_TYPES = {
    economic: { label: '경제지표', dot: 'bg-sky-500', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
                chip: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' },
    fed:      { label: '연준/FOMC', dot: 'bg-violet-500', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
                chip: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300' },
    earnings: { label: '실적발표', dot: 'bg-amber-500', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
                chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
    holiday:  { label: '휴장/기타', dot: 'bg-rose-500', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
                chip: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
  };
  const earningsId = (ticker, date) => `earn-${ticker}-${date}`;

  // Actual vs forecast, comparing the leading numbers ("2.9%", "+15.2만 / 4.1%", "$1.21"). null when not comparable.
  const SURPRISES = {
    beat:   { label: '예상 상회', text: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
    miss:   { label: '예상 하회', text: 'text-rose-600 dark:text-rose-400', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
    inline: { label: '예상 부합', text: '', badge: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300' },
  };
  function surprise(ev) {
    // Strip currency/grouping first so "-$0.12" parses as -0.12 (not 0.12).
    const num = (v) => { const m = String(v ?? '').replace(/[$,\s]/g, '').match(/[-+]?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
    const a = num(ev.actual), f = num(ev.forecast);
    if (Number.isNaN(a) || Number.isNaN(f)) return null;
    return SURPRISES[a > f ? 'beat' : a < f ? 'miss' : 'inline'];
  }
  const SESSIONS = { bmo: '장 전', amc: '장 후' };
  const IMPORTANCE = {
    High:   { label: '중요도 높음', rank: 3, cls: 'bg-rose-600 text-white dark:bg-rose-500',
              card: 'border-rose-300 bg-rose-50/70 ring-1 ring-rose-200 dark:border-rose-500/50 dark:bg-rose-500/10 dark:ring-rose-500/30' },
    Medium: { label: '중요도 보통', rank: 2, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
              card: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900' },
    Low:    { label: '중요도 낮음', rank: 1, cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              card: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900' },
  };

  // Convert an ET wall-clock date/time to an absolute Date (handles DST via Intl).
  function tzOffsetMs(ts, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ts));
    const g = (t) => Number(parts.find((p) => p.type === t).value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ts;
  }
  function eventDate(ev) {
    const time = ev.time || (ev.session === 'bmo' ? '08:00' : ev.session === 'amc' ? '16:05' : '09:30');
    const [y, m, d] = ev.date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    return new Date(guess - tzOffsetMs(guess, 'America/New_York'));
  }
  function eventTimeLabel(ev) {
    if (ev.time && ev.session) return `${SESSIONS[ev.session]} ${ev.time} ET`;
    if (ev.time) return `${ev.time} ET`;
    if (ev.session) return SESSIONS[ev.session];
    return '종일';
  }

  // ---- KST (Asia/Seoul) formatting. All-day events keep their US calendar date. ----
  const KST = 'Asia/Seoul';
  const hasTime = (ev) => !!(ev.time || ev.session);
  function kstKeyOf(date) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  }
  const kstTodayKey = () => kstKeyOf(new Date());
  const kstDateKey = (ev) => (hasTime(ev) ? kstKeyOf(eventDate(ev)) : ev.date);
  // "오후 9:30" (or "종일")
  const kstTime = (ev) => (hasTime(ev)
    ? eventDate(ev).toLocaleTimeString('ko-KR', { timeZone: KST, hour: 'numeric', minute: '2-digit' })
    : '종일');
  // "21:30" for compact chips
  const kstShortTime = (ev) => (hasTime(ev)
    ? eventDate(ev).toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : '');
  // "10월 22일 (목) 오후 9:30"
  function localTimeLabel(ev) {
    if (!hasTime(ev)) return '';
    return `${formatDateKo(kstDateKey(ev))} ${kstTime(ev)}`;
  }

  function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
  }
  function formatDateKo(key) {
    const d = parseKey(key);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  }

  // Small HTML snippets shared by views.
  const ui = {
    card: (inner, extra = '') => `<section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${extra}">${inner}</section>`,
    badge: (label, cls) => `<span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cls}">${esc(label)}</span>`,
    categoryBadge: (c) => ui.badge((CATEGORIES[c] || CATEGORIES.market).label, (CATEGORIES[c] || CATEGORIES.market).cls),
    typeBadge: (t) => ui.badge((EVENT_TYPES[t] || EVENT_TYPES.economic).label, (EVENT_TYPES[t] || EVENT_TYPES.economic).cls),
    sentiment: (s) => { const x = SENTIMENTS[s] || SENTIMENTS.neutral; return `<span class="text-xs font-medium ${x.cls}">${x.icon} ${x.label}</span>`; },
    importance: (i) => { const x = IMPORTANCE[i] || IMPORTANCE.Medium; return ui.badge(i === 'High' ? `🔥 ${x.label}` : x.label, x.cls); },
    importanceCard: (i) => (IMPORTANCE[i] || IMPORTANCE.Medium).card,
    // Earnings result badge: Surprise (beat) / Miss / In line, with icon + label + % (never color alone).
    // Uses Finnhub's surprisePercent when present, else computes it from actual vs forecast EPS.
    surpriseBadge: (ev) => {
      if (!ev || !ev.actual) return '';
      const s = surprise(ev);
      if (!s) return '';
      const num = (v) => { const m = String(v ?? '').replace(/[$,\s]/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
      const a = num(ev.actual), f = num(ev.forecast);
      const pct = ev.surprisePct != null ? Number(ev.surprisePct) : (f ? ((a - f) / Math.abs(f)) * 100 : null);
      const pctText = pct == null || Number.isNaN(pct) ? '' : ` ${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct).toFixed(1)}%`;
      const kind = s === SURPRISES.beat ? ['▲', 'Surprise'] : s === SURPRISES.miss ? ['▼', 'Miss'] : ['■', 'In line'];
      return `<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${s.badge}"
        title="실제 EPS ${esc(ev.actual)} · 예상 ${esc(ev.forecast ?? '-')}${ev.surpriseSource === 'finnhub' ? ' · Finnhub Earnings Surprises' : ''}">
        <span aria-hidden="true">${kind[0]}</span>${kind[1]}${pctText}</span>`;
    },
    // Warning chip when a snapshot is older than `hours`. GitHub Actions refreshes them every ~15 min on
    // weekdays and every 6 h on weekends, so 8 h without an update means the refresh has stalled.
    staleSnapshot: (iso, hours = 8) => {
      const age = iso ? (Date.now() - Date.parse(iso)) / 3600e3 : Infinity;
      if (age < hours) return '';
      const label = Number.isFinite(age) ? `${age >= 48 ? `${Math.floor(age / 24)}일` : `${Math.floor(age)}시간`} 전 데이터` : '수집 시각 알 수 없음';
      return `<span class="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
        title="자동 갱신(GitHub Actions 'Refresh market data', 평일 15분 간격)이 멈췄을 수 있습니다. Actions 실행 기록을 확인하거나 node scripts/fetch-market-data.mjs 로 직접 갱신하세요">⚠ 스냅샷 ${label}</span>`;
    },
    stars: (n) => `<span class="text-amber-500" title="중요도 ${n}">${'★'.repeat(n)}<span class="text-slate-300 dark:text-slate-600">${'★'.repeat(3 - n)}</span></span>`,
    ticker: (t) => `<span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">${esc(t)}</span>`,
    empty: (msg) => `<p class="py-8 text-center text-sm text-slate-500">${esc(msg)}</p>`,
    sectionTitle: (title, right = '') => `<div class="mb-4 flex items-center justify-between gap-2"><h2 class="text-base font-bold">${title}</h2>${right}</div>`,
  };

  // Stored values may be missing or malformed (older versions, manual edits) — never let that blank the app.
  const storedArray = (k, fallback) => { const v = store.get(k, fallback); return Array.isArray(v) ? v : fallback; };

  const state = {
    news: [],        // NewsItem[] newest first
    events: [],      // Event[] sorted by date/time
    quotes: [],      // Quote[]
    briefing: null,  // Briefing | null
    market: null,    // MARKET_DATA snapshot (js/marketData.js) or MOCK_MARKET; see js/views/marketPanel.js
    source: 'sample', // 'sample' | 'live'
    loading: false,
    error: null,
    updatedAt: null,
    watchlist: storedArray(KEYS.watchlist, ['AAPL', 'NVDA', 'MSFT', 'TSLA']),
    favorites: new Set(storedArray(KEYS.favorites, [])), // starred Event ids
  };

  const isWatched = (ticker) => !!ticker && state.watchlist.includes(String(ticker).toUpperCase());

  // Star / unstar an event; persisted to localStorage. Returns the new starred state.
  function toggleFavorite(id) {
    const on = !state.favorites.has(id);
    if (on) state.favorites.add(id); else state.favorites.delete(id);
    store.set(KEYS.favorites, [...state.favorites]);
    return on;
  }

  window.UMB = {
    $, $$, esc, pad, dateKey, parseKey, addDays, todayKey, WEEKDAYS,
    store, KEYS, CATEGORIES, SENTIMENTS, EVENT_TYPES, SESSIONS, IMPORTANCE,
    eventDate, eventTimeLabel, localTimeLabel, timeAgo, formatDateKo, ui, state,
    hasTime, kstTodayKey, kstDateKey, kstTime, kstShortTime, toggleFavorite,
    earningsId, surprise, isWatched,
    // Views register here: { render(container), mount?(container), unmount?() }
    views: {},
    // Set by app.js
    openModal: null, closeModal: null, toast: null, rerender: null,
  };
})();
