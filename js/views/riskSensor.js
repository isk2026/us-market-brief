/*
 * 시장 위험도 센서 (dashboard top banner): one 3-level badge — 안정 / 유의 / 공포.
 * Inputs
 *   - VIX close (Cboe, via the multi-asset-morning-briefing skill) and CNN Fear & Greed score, both from the
 *     daily snapshot in UMB.state.market. Finnhub's free plan has neither the VIX index nor Fear & Greed.
 *   - Optional live supplement with a Finnhub key: VIXY (VIX short-term futures ETF) intraday % change,
 *     polled once a minute through UMB.finnhub (rate-limited + cached). A sharp jump raises the level.
 * Rule (deliberately simple and conservative): each indicator maps to a level, the sensor shows the highest.
 */
(function () {
  'use strict';
  const U = window.UMB;
  const { esc } = U;

  const LEVELS = [
    { key: 'calm', label: '안정', icon: '●', cls: 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10', badge: 'bg-emerald-600 text-white', text: 'text-emerald-700 dark:text-emerald-300',
      note: '변동성과 투자심리가 모두 평온한 구간입니다.' },
    { key: 'caution', label: '유의', icon: '▲', cls: 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10', badge: 'bg-amber-500 text-amber-950', text: 'text-amber-700 dark:text-amber-300',
      note: '변동성이 높아졌거나 투자심리가 위축된 구간입니다. 포지션 규모와 손절 기준을 점검해 볼 만합니다.' },
    { key: 'fear', label: '공포', icon: '⚠', cls: 'border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10', badge: 'bg-rose-600 text-white', text: 'text-rose-700 dark:text-rose-300',
      note: '변동성 급등 또는 극단적 공포 구간입니다. 가격 변동폭이 평소보다 크게 나타날 수 있습니다.' },
  ];
  const VIXY_JUMP = 8;       // % intraday move in VIXY that bumps the sensor to at least 유의
  const POLL_MS = 60 * 1000;

  let live = null;           // { dp, c, t, at } last VIXY quote (module-level so re-renders keep it)
  let liveError = null;
  let root = null;
  let timer = null;
  let onVis = null;

  const vixLevel = (v) => (v == null ? null : v >= 30 ? 2 : v >= 20 ? 1 : 0);
  const fgLevel = (s) => (s == null ? null : s < 25 ? 2 : s < 45 ? 1 : 0);
  const FG_LABEL = (s) => (s < 25 ? '극단적 공포' : s < 45 ? '공포' : s < 55 ? '중립' : s < 75 ? '탐욕' : '극단적 탐욕');

  function inputs() {
    const m = U.state.market || {};
    const vs = m.vix && m.vix.series;
    const vix = vs && vs.length ? vs[vs.length - 1] : null;
    const vixPrev = vs && vs.length > 1 ? vs[vs.length - 2] : null;
    const fg = m.fearGreed && m.fearGreed.score != null ? m.fearGreed : null;
    return { vix, vixPrev, fg, mock: !!m.mock };
  }

  function evaluate() {
    const { vix, fg } = inputs();
    const parts = [];
    const lv = vixLevel(vix && vix.close);
    const lf = fgLevel(fg && fg.score);
    if (lv != null) parts.push(lv);
    if (lf != null) parts.push(lf);
    let level = parts.length ? Math.max(...parts) : null;
    let liveBump = false;
    if (live && live.dp != null && live.dp >= VIXY_JUMP && (level == null || level < 1)) { level = 1; liveBump = true; }
    return { level, lv, lf, liveBump };
  }

  function chip(label, value, lvl, sub, tip) {
    const L = lvl == null ? null : LEVELS[lvl];
    return `<div class="min-w-0 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/60" data-tip="${esc(tip)}" title="${esc(tip)}">
      <p class="text-[11px] text-slate-500">${label}</p>
      <p class="font-mono text-lg font-bold tabular-nums leading-tight">${value}
        ${L ? `<span class="ml-1 align-middle text-[11px] font-semibold ${L.text}">${L.icon} ${L.label}</span>` : ''}</p>
      <p class="truncate text-[10px] text-slate-400">${sub}</p>
    </div>`;
  }

  function inner() {
    const { vix, vixPrev, fg, mock } = inputs();
    const { level, lv, lf, liveBump } = evaluate();
    if (level == null) return '';
    const L = LEVELS[level];
    const vixChg = vix && vixPrev ? vix.close - vixPrev.close : null;
    const liveChip = U.finnhub && U.finnhub.hasKey()
      ? chip('VIXY 실시간 <span class="text-[10px]">(VIX ETF)</span>',
        live && live.dp != null ? `${live.dp > 0 ? '+' : live.dp < 0 ? '−' : ''}${Math.abs(live.dp).toFixed(2)}%` : '-',
        live && live.dp != null ? (live.dp >= VIXY_JUMP ? 1 : null) : null,
        liveError ? esc(liveError) : live && live.t ? `${new Date(live.t * 1000).toLocaleTimeString('ko-KR', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} ET 체결 · Finnhub` : 'Finnhub 조회 중…',
        `VIX 단기 선물 ETF의 당일 등락률. ${VIXY_JUMP}% 이상 급등하면 센서를 최소 '유의'로 올립니다.`)
      : '';
    return `
      <div class="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        <div class="flex shrink-0 items-center gap-3">
          <span class="grid h-12 w-12 place-items-center rounded-2xl text-2xl ${L.badge}" aria-hidden="true">${L.icon}</span>
          <div>
            <p class="text-xs font-semibold text-slate-500">시장 위험도 센서</p>
            <p class="text-2xl font-black leading-none ${L.text}" role="status" aria-live="polite">${L.label}</p>
          </div>
        </div>
        <div class="grid min-w-0 flex-1 basis-full grid-cols-2 gap-2 sm:basis-auto ${liveChip ? 'lg:grid-cols-3' : ''}">
          ${chip('VIX 변동성지수', vix ? vix.close.toFixed(2) : '-', lv,
            vix ? `${vix.date} 종가${vixChg != null ? ` · ${vixChg > 0 ? '+' : vixChg < 0 ? '−' : ''}${Math.abs(vixChg).toFixed(2)}` : ''} · Cboe` : '데이터 없음',
            'VIX: 20 미만 안정 · 20~30 유의 · 30 이상 공포')}
          ${chip('공포·탐욕 지수', fg ? Math.round(fg.score) : '-', lf,
            fg ? `${FG_LABEL(fg.score)} · CNN` : '데이터 없음',
            'CNN Fear & Greed: 45 이상 안정 · 25~45 유의 · 25 미만 공포')}
          ${liveChip}
        </div>
      </div>
      <p class="mt-2 text-[11px] leading-snug text-slate-600 dark:text-slate-300">${esc(L.note)}${liveBump ? ` 실시간 VIX ETF가 ${VIXY_JUMP}% 이상 급등해 '유의'로 상향했습니다.` : ''}
        <span class="text-slate-400">· 지표 중 가장 높은 위험 단계를 표시${mock ? ' · 샘플 데이터' : ''} · 투자 권유 아님</span></p>`;
  }

  function html() {
    const { level } = evaluate();
    if (level == null) return '';
    return `<section id="risk-sensor" class="mb-6 rounded-2xl border p-4 shadow-sm ${LEVELS[level].cls}" aria-label="시장 위험도 센서">${inner()}</section>`;
  }

  function redraw() {
    const el = root && root.querySelector('#risk-sensor');
    if (!el) return;
    const { level } = evaluate();
    if (level == null) return;
    el.className = `mb-6 rounded-2xl border p-4 shadow-sm ${LEVELS[level].cls}`;
    el.innerHTML = inner();
  }

  async function pollLive() {
    if (!U.finnhub || !U.finnhub.hasKey() || document.hidden) return;
    try {
      const q = await U.finnhub.get('quote', { symbol: 'VIXY' }, { ttl: 50_000, priority: 1 });
      if (q && (q.c || q.pc)) { live = { dp: q.dp, c: q.c, t: q.t, at: Date.now() }; liveError = null; }
    } catch (err) {
      liveError = (err && err.message) || 'Finnhub 조회 실패';
    }
    redraw();
  }

  function mount(container) {
    unmount();
    root = container;
    if (!root.querySelector('#risk-sensor') || !U.finnhub || !U.finnhub.hasKey()) return;
    pollLive();
    timer = setInterval(pollLive, POLL_MS);
    onVis = () => { if (!document.hidden) pollLive(); };
    document.addEventListener('visibilitychange', onVis);
  }

  function unmount() {
    if (timer) { clearInterval(timer); timer = null; }
    if (onVis) { document.removeEventListener('visibilitychange', onVis); onVis = null; }
    root = null;
  }

  U.riskSensor = { html, mount, unmount, evaluate };
})();
