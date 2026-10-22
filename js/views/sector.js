/*
 * 섹터 ETF view: the 11 SPDR Select Sector ETFs (XLK … XLV) against SPY.
 * Data: window.SECTOR_DATA from js/sectorData.js (scripts/fetch-sector-data.mjs), lazy-loaded on first
 * visit. Sparklines / hover reuse UMB.charts (marketPanel.js).
 */
(function () {
  'use strict';
  const U = window.UMB;
  const { esc, ui } = U;

  const PERIODS = [['d1', '1일'], ['w1', '1주'], ['m1', '1개월'], ['m3', '3개월'], ['ytd', '연초 대비'], ['y1', '1년']];
  // Morningstar super-sectors — a common lens for risk-on / risk-off rotation.
  const GROUPS = {
    cyclical: { label: '경기민감', hint: '경기 확장기에 상대적으로 강한 경향 (소비재·금융·소재·부동산)', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
    sensitive: { label: '경기민감·성장', hint: '경기와 기술 사이클에 함께 반응 (기술·커뮤니케이션·산업재·에너지)', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
    defensive: { label: '방어', hint: '경기와 무관한 수요, 하락장에서 상대적으로 덜 빠지는 경향 (유틸리티·필수소비재·헬스케어)', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  };
  const RELOAD_MS = 4 * 60 * 1000; // snapshots refresh about every 15 min (GitHub Actions)

  const view = { period: 'm1', sort: 'period', dir: -1 };
  let root = null;
  let onClick = null;
  let onResize = null;
  let resizeTimer = null;
  let detachHover = null;
  let loadedAt = 0;
  let loading = null;

  function loadData() {
    if (loading) return loading;
    loading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `js/sectorData.js?v=${Date.now()}`;
      s.onload = s.onerror = () => { s.remove(); loadedAt = Date.now(); loading = null; resolve(); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // ---------- formatting ----------
  const pct = (v, d = 2) => (v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
  const pp = (v) => (v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%p`);
  const tone = (v) => (v == null || Number.isNaN(v) || v === 0 ? 'text-slate-500' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
  const arrow = (v) => (v == null || Number.isNaN(v) || v === 0 ? '■' : v > 0 ? '▲' : '▼');
  const money = (v) => (v == null ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const aum = (v) => (!v ? '-' : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${(v / 1e9).toFixed(1)}B`);
  // Korean name without the trailing "(XLK)" the data carries — the ticker is shown next to it.
  const nm = (e) => String(e.nameKo || '').replace(/\s*\([A-Z.]+\)\s*$/, '');
  const ret = (e, k) => (k === 'd1' ? e.changePct : e.r ? e.r[k] : null);
  const label = (k) => (PERIODS.find(([p]) => p === k) || [, ''])[1];
  const avg = (vals) => { const v = vals.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };

  // ---------- 1. sector performance for the chosen period (diverging bars, sorted, SPY reference) ----------
  function performance(d) {
    const k = view.period;
    const spy = ret(d.benchmark || {}, k);
    const rows = d.etfs.filter((e) => ret(e, k) != null).sort((a, b) => ret(b, k) - ret(a, k));
    const max = Math.max(1, ...rows.map((e) => Math.abs(ret(e, k))), Math.abs(spy || 0));
    const spyPos = spy == null ? null : 50 + (spy / max) * 50;
    const bar = (e) => {
      const v = ret(e, k);
      const w = (Math.abs(v) / max) * 50;
      const rel = spy == null ? null : v - spy;
      return `<li class="grid grid-cols-[7.5rem_1fr_4.75rem] items-center gap-2 text-sm sm:grid-cols-[10rem_1fr_5rem_5.5rem]"
          data-tip="${esc(`${e.symbol} ${e.nameKo} · ${label(k)} ${pct(v)} · SPY 대비 ${pp(rel)}`)}">
        <span class="flex min-w-0 items-center gap-1.5"><span class="font-mono text-xs font-bold">${esc(e.symbol)}</span><span class="truncate text-slate-600 dark:text-slate-300">${esc(nm(e))}</span></span>
        <span class="relative h-5" aria-hidden="true">
          <span class="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-700"></span>
          ${spyPos == null ? '' : `<span class="absolute -inset-y-0.5 w-0.5 rounded bg-slate-500 dark:bg-slate-400" style="left:${spyPos}%"></span>`}
          <span class="absolute inset-y-0.5 ${v >= 0 ? 'left-1/2 rounded-r bg-emerald-500' : 'right-1/2 rounded-l bg-rose-500'}" style="width:${w}%"></span>
        </span>
        <span class="text-right font-mono text-xs tabular-nums ${tone(v)}">${arrow(v)} ${pct(v)}</span>
        <span class="hidden text-right font-mono text-[11px] tabular-nums sm:inline ${tone(rel)}">${pp(rel)}</span>
      </li>`;
    };
    const chips = PERIODS.map(([p, l]) => `<button data-sec="period" data-value="${p}" aria-pressed="${view.period === p}"
      class="shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${view.period === p
        ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}">${l}</button>`).join('');
    const beat = spy == null ? 0 : rows.filter((e) => ret(e, k) > spy).length;
    return `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-base font-bold">섹터 성과 <span class="text-xs font-normal text-slate-500">${label(k)} · 세로선 = SPY ${pct(spy)}</span></h2>
        <div class="no-scrollbar flex gap-1.5 overflow-x-auto">${chips}</div>
      </div>
      <ul class="space-y-1.5" aria-label="${label(k)} 섹터별 수익률, 높은 순">${rows.map(bar).join('')}</ul>
      <p class="mt-3 text-xs text-slate-500">SPY보다 강한 섹터 <b>${beat}</b> / ${rows.length}개 · 오른쪽 숫자는 SPY 대비 초과 수익률(%p)</p>
    </section>`;
  }

  // ---------- 2. rotation lens: group averages + defensive − cyclical spread ----------
  function rotation(d) {
    const k = view.period;
    const g = Object.keys(GROUPS).map((key) => ({ key, ...GROUPS[key], v: avg(d.etfs.filter((e) => e.group === key).map((e) => ret(e, k))), n: d.etfs.filter((e) => e.group === key).length }));
    const def = g.find((x) => x.key === 'defensive').v;
    const cyc = avg(d.etfs.filter((e) => e.group !== 'defensive').map((e) => ret(e, k)));
    const spread = def != null && cyc != null ? def - cyc : null;
    const read = spread == null ? '' : Math.abs(spread) < 0.5
      ? '방어·경기민감 섹터 성과가 비슷합니다.'
      : spread > 0
        ? '방어 섹터가 상대적으로 강합니다. 일반적으로 위험 회피 성향이 커질 때 나타나는 흐름으로 해석됩니다.'
        : '경기민감·성장 섹터가 상대적으로 강합니다. 일반적으로 위험 선호 성향이 강할 때 나타나는 흐름으로 해석됩니다.';
    return `<section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      ${g.map((x) => `<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-tip="${esc(x.hint)}">
        <div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5"><span class="whitespace-nowrap">${ui.badge(x.label, x.cls)}</span><span class="text-[11px] text-slate-500 sm:text-xs">${x.n}개 섹터 평균 · ${label(k)}</span></div>
        <p class="font-mono text-2xl font-bold tabular-nums ${tone(x.v)}">${pct(x.v)}</p>
        <p class="mt-1 hidden text-[11px] leading-snug text-slate-500 sm:block">${esc(x.hint)}</p>
      </div>`).join('')}
      <div class="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
        <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">방어 − 경기민감 스프레드</p>
        <p class="font-mono text-2xl font-bold tabular-nums ${tone(spread)}">${pp(spread)}</p>
        <p class="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-300">${esc(read)}</p>
      </div>
    </section>`;
  }

  // ---------- 3. returns heatmap table (sortable; values always printed, color is secondary) ----------
  function heatTable(d) {
    const rows = [...d.etfs];
    const key = view.sort === 'period' ? view.period : view.sort;
    rows.sort((a, b) => {
      if (key === 'symbol') return a.symbol.localeCompare(b.symbol) * view.dir;
      const x = ret(a, key), y = ret(b, key);
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * view.dir;
    });
    const maxBy = Object.fromEntries(PERIODS.map(([p]) => [p, Math.max(1, ...[...d.etfs, d.benchmark].filter(Boolean).map((e) => Math.abs(ret(e, p) || 0)))]));
    const cell = (e, p) => {
      const v = ret(e, p);
      if (v == null) return '<td class="px-2 py-2 text-right text-slate-400">-</td>';
      const a = Math.min(1, Math.abs(v) / maxBy[p]) * 0.55 + 0.06;
      return `<td class="whitespace-nowrap px-2 py-2 text-right font-mono text-xs tabular-nums" style="background:${v >= 0 ? `rgba(16,185,129,${a.toFixed(2)})` : `rgba(244,63,94,${a.toFixed(2)})`}">${pct(v, 1)}</td>`;
    };
    const th = (k, l) => {
      const active = key === k;
      return `<th class="whitespace-nowrap px-2 py-2 text-right font-medium" aria-sort="${active ? (view.dir > 0 ? 'ascending' : 'descending') : 'none'}">
        <button data-sec="sort" data-value="${k}" class="hover:text-slate-800 dark:hover:text-slate-200">${l}${active ? (view.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    };
    const row = (e, bench) => `<tr class="${bench ? 'bg-slate-50 font-semibold dark:bg-slate-800/60' : ''}">
      <td class="sticky left-0 z-10 whitespace-nowrap px-2 py-2 ${bench ? 'bg-slate-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900'}"><span class="font-mono text-xs font-bold">${esc(e.symbol)}</span> <span class="text-slate-600 dark:text-slate-300">${esc(nm(e))}</span>
        ${e.group ? `<span class="hidden sm:inline">${ui.badge(GROUPS[e.group].label, GROUPS[e.group].cls)}</span>` : ''}</td>
      ${PERIODS.map(([p]) => cell(e, p)).join('')}
    </tr>`;
    return `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      ${ui.sectionTitle('기간별 수익률 히트맵 <span class="text-xs font-normal text-slate-500">머리글을 눌러 정렬 · 색이 진할수록 해당 기간 내 상대적으로 큰 움직임</span>')}
      <div class="-mx-5 overflow-x-auto px-5"><table class="w-full min-w-[560px] text-sm sm:min-w-[720px]">
        <thead class="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800"><tr>
          <th class="sticky left-0 z-10 bg-white px-2 py-2 text-left font-medium dark:bg-slate-900"><button data-sec="sort" data-value="symbol" class="hover:text-slate-800 dark:hover:text-slate-200">ETF${key === 'symbol' ? (view.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>
          ${PERIODS.map(([p, l]) => th(p, l)).join('')}</tr></thead>
        <tbody class="divide-y divide-white dark:divide-slate-900">${d.benchmark ? row(d.benchmark, true) : ''}${rows.map((e) => row(e, false)).join('')}</tbody>
      </table></div>
    </section>`;
  }

  // ---------- 4. ETF cards ----------
  function card(e) {
    const pos = e.high52 > e.low52 ? ((e.price - e.low52) / (e.high52 - e.low52)) * 100 : null;
    const holdings = (e.topHoldings || []).slice(0, 5);
    const top10 = (e.topHoldings || []).reduce((t, h) => t + (h.weight || 0), 0);
    const maxW = Math.max(1, ...holdings.map((h) => h.weight || 0));
    const stat = (l, v, tip) => `<div class="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60"${tip ? ` data-tip="${esc(tip)}"` : ''}>
      <p class="text-[10px] text-slate-500">${l}</p><p class="font-mono text-xs font-semibold tabular-nums">${v}</p></div>`;
    return `<section class="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-1 flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="font-bold"><span class="font-mono">${esc(e.symbol)}</span> · ${esc(nm(e))}</h3>
          <p class="truncate text-[11px] text-slate-400">${esc(e.nameEn || '')}</p>
        </div>
        ${e.group ? `<span class="shrink-0 whitespace-nowrap">${ui.badge(GROUPS[e.group].label, GROUPS[e.group].cls)}</span>` : ''}
      </div>
      <div class="mb-2 flex flex-wrap items-baseline gap-x-2">
        <p class="font-mono text-2xl font-bold tabular-nums">$${money(e.price)}</p>
        <p class="font-mono text-sm tabular-nums ${tone(e.changePct)}">${arrow(e.changePct)} ${pct(e.changePct)}</p>
        ${e.stale ? ui.badge('갱신 실패 · 이전 값', 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300') : ''}
      </div>
      ${U.charts.sparkline((e.series || []).map((p) => ({ date: p.date, v: p.close })), { label: e.symbol, fmt: (v) => `$${money(v)}` })}
      <div class="mt-3 grid grid-cols-3 gap-1.5">
        ${stat('보수율', e.expenseRatio == null ? '-' : `${e.expenseRatio.toFixed(2)}%`, '연간 운용보수 (총보수비용)')}
        ${stat('운용자산', aum(e.aum), '펀드 총자산 (AUM)')}
        ${stat('배당수익률', e.divYield == null ? '-' : `${e.divYield.toFixed(2)}%`, '최근 12개월 분배금 기준')}
        ${stat('PER', e.pe == null ? '-' : `${e.pe.toFixed(1)}x`, '보유 종목 가중 주가수익비율')}
        ${stat('베타 (3년)', e.beta3y == null ? '-' : e.beta3y.toFixed(2), '시장(S&P 500) 대비 변동성. 1보다 크면 시장보다 크게 움직임')}
        ${stat('52주 위치', pos == null ? '-' : `${pos.toFixed(0)}%`, `52주 최저 $${money(e.low52)} · 최고 $${money(e.high52)}`)}
      </div>
      ${holdings.length ? `<div class="mt-3">
        <p class="mb-1.5 flex justify-between text-[11px] text-slate-500"><span>상위 보유종목</span><span>상위 10개 비중 <b class="font-mono">${top10.toFixed(1)}%</b>${e.holdingsCount ? ` · 총 ${e.holdingsCount}종목` : ''}</span></p>
        <ul class="space-y-1">${holdings.map((h) => `<li class="grid grid-cols-[3.5rem_1fr_3rem] items-center gap-2 text-xs" title="${esc(h.name || '')}">
          <span class="truncate font-mono font-semibold">${esc(h.symbol || '-')}</span>
          <span class="relative h-2 rounded-full bg-slate-100 dark:bg-slate-800"><span class="absolute inset-y-0 left-0 rounded-full" style="width:${((h.weight || 0) / maxW) * 100}%;background:var(--spark)"></span></span>
          <span class="text-right font-mono tabular-nums">${h.weight == null ? '-' : `${h.weight.toFixed(1)}%`}</span></li>`).join('')}</ul>
      </div>` : ''}
    </section>`;
  }

  // ---------- render ----------
  function draw() {
    if (!root) return;
    if (detachHover) { detachHover(); detachHover = null; }
    U.charts.resetSparklines();
    const d = window.SECTOR_DATA;
    if (!d || !Array.isArray(d.etfs) || !d.etfs.length) {
      root.innerHTML = `<h1 class="mb-4 text-xl font-bold">섹터 ETF</h1>${ui.card(ui.empty(loading ? '섹터 ETF 데이터를 불러오는 중…' : '섹터 데이터가 없습니다. node scripts/fetch-sector-data.mjs 로 스냅샷을 만드세요.'))}`;
      return;
    }
    const b = d.benchmark;
    root.innerHTML = `<div id="sector-root" class="relative">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold">미국 섹터 ETF</h1>
          <p class="mt-0.5 text-xs text-slate-500">${ui.staleSnapshot(d.generatedAt)} SPDR Select Sector ETF 11종 · 스냅샷 ${esc(new Date(d.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} KST${b && b.sessionDate ? ` · ${esc(b.sessionDate)} 미국장 기준` : ''}</p>
        </div>
        ${b ? `<div class="rounded-xl border border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <p class="text-[11px] text-slate-500">기준 · S&P 500 (SPY)</p>
          <p class="font-mono font-bold tabular-nums">$${money(b.price)} <span class="text-xs ${tone(b.changePct)}">${arrow(b.changePct)} ${pct(b.changePct)}</span>
            <span class="text-[11px] font-normal text-slate-500">· 연초 대비 <b class="${tone(b.r && b.r.ytd)}">${pct(b.r && b.r.ytd)}</b></span></p>
        </div>` : ''}
      </div>
      ${performance(d)}
      ${rotation(d)}
      ${heatTable(d)}
      <h2 class="mb-3 text-base font-bold">ETF 상세</h2>
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">${d.etfs.map(card).join('')}</div>
      <div data-chart-tip role="tooltip" class="pointer-events-none fixed z-50 hidden max-w-sm rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-white dark:text-slate-900"></div>
      <p class="text-xs text-slate-500">출처 Yahoo Finance. 섹터 그룹은 Morningstar 슈퍼섹터 분류 기준이며, 회전 해석은 일반적인 시장 관행을 요약한 참고 정보입니다. 투자 권유가 아닙니다.</p>
    </div>`;
    detachHover = U.charts.attachChartHover(root.querySelector('#sector-root'));
  }

  U.views.sector = {
    render(container) {
      this.unmount();
      root = container;
      onClick = (e) => {
        const el = e.target.closest('[data-sec]');
        if (!el) return;
        const kind = el.dataset.sec, v = el.dataset.value;
        if (kind === 'period') { view.period = v; if (view.sort !== 'symbol') view.sort = 'period'; view.dir = -1; }
        else if (kind === 'sort') {
          const cur = view.sort === 'period' ? view.period : view.sort;
          if (cur === v) view.dir = -view.dir;
          else if (v === 'symbol') { view.sort = 'symbol'; view.dir = 1; }
          else { view.period = v; view.sort = 'period'; view.dir = -1; }
        } else return;
        draw();
      };
      root.addEventListener('click', onClick);
      let lastWidth = root.clientWidth;
      onResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (root && root.clientWidth !== lastWidth) { lastWidth = root.clientWidth; draw(); } }, 200);
      };
      window.addEventListener('resize', onResize);
      if (!window.SECTOR_DATA || Date.now() - loadedAt > RELOAD_MS) {
        draw();
        loadData().then(() => { if (root === container) draw(); });
      } else {
        draw();
      }
    },
    unmount() {
      if (root && onClick) root.removeEventListener('click', onClick);
      if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
      clearTimeout(resizeTimer);
      if (detachHover) { detachHover(); detachHover = null; }
      root = onClick = null;
    },
  };
})();
