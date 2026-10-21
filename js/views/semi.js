/*
 * 반도체 view: PHLX Semiconductor index (SOX) with its live constituent list, plus major non-members
 * (Samsung, SK hynix, TSMC Taiwan line, Tokyo Electron, Infineon, …).
 * Data: window.SEMI_DATA from js/semiData.js (scripts/fetch-semi-data.mjs), lazy-loaded on first visit
 * so other tabs don't pay for it. Sparklines / hover reuse UMB.charts (marketPanel.js).
 */
(function () {
  'use strict';
  const U = window.UMB;
  const { esc, ui } = U;

  const SEGMENTS = {
    compute: 'GPU·CPU·AI 가속기', foundry: '파운드리', memory: '메모리', equipment: '장비', analog: '아날로그·전력·MCU',
    network: '네트워크·통신·광', ip: 'IP·EDA', materials: '소재·부품·테스트', osat: '후공정·패키징',
  };
  const FLAGS = { US: '🇺🇸', KR: '🇰🇷', TW: '🇹🇼', JP: '🇯🇵', NL: '🇳🇱', DE: '🇩🇪', CH: '🇨🇭', CN: '🇨🇳', GB: '🇬🇧', IL: '🇮🇱', FR: '🇫🇷' };
  // Relative-performance series, fixed order → fixed colors (--c1..--c5, validated palette).
  const REL = [
    { key: 'sox', label: 'SOX', color: 'var(--c1)' },
    { key: '2330.TW', label: 'TSMC', color: 'var(--c2)' },
    { key: '005930.KS', label: '삼성전자', color: 'var(--c3)' },
    { key: '000660.KS', label: 'SK하이닉스', color: 'var(--c4)' },
    { key: 'NVDA', label: 'NVIDIA', color: 'var(--c5)' },
  ];
  const RELOAD_MS = 10 * 60 * 1000;

  const view = { filter: 'all', segment: 'all', sort: 'marketCapUsd', dir: -1, mode: 'cards' };
  let root = null;
  let onClick = null;
  let onChange = null;
  let onResize = null;
  let resizeTimer = null;
  let detachHover = null;
  let detachRel = null;
  let loadedAt = 0;
  let loading = null;

  // ---------- lazy data ----------
  function loadData() {
    if (loading) return loading;
    loading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `js/semiData.js?v=${Date.now()}`;
      s.onload = s.onerror = () => { s.remove(); loadedAt = Date.now(); loading = null; resolve(); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // ---------- formatting ----------
  const pct = (v) => (v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
  const tone = (v) => (v == null || Number.isNaN(v) || v === 0 ? 'text-slate-500' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
  const arrow = (v) => (v == null || Number.isNaN(v) || v === 0 ? '■' : v > 0 ? '▲' : '▼');
  const price = (v, cur) => {
    if (v == null) return '-';
    const digits = ['KRW', 'JPY', 'TWD'].includes(cur) && v >= 100 ? 0 : 2;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const cap = (v) => (!v ? '-' : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${Math.round(v / 1e9)}B`);
  const name = (s) => s.nameKo || s.name || s.ticker;
  const pos52 = (s) => (s.high52 > s.low52 ? ((s.price - s.low52) / (s.high52 - s.low52)) * 100 : null);

  function filtered(stocks) {
    return stocks.filter((s) => {
      if (view.filter === 'sox' && !s.inSox) return false;
      if (view.filter === 'non' && s.inSox) return false;
      if (view.filter === 'kr' && s.country !== 'KR') return false;
      if (view.filter === 'watch' && !U.isWatched(s.ticker)) return false;
      if (view.segment !== 'all' && s.segment !== view.segment) return false;
      return true;
    });
  }

  // ---------- SOX hero + ETFs ----------
  function returnsGrid(r) {
    return `<dl class="grid grid-cols-4 gap-1 text-center">${[['1주', r?.w1], ['1개월', r?.m1], ['3개월', r?.m3], ['연초 대비', r?.ytd]].map(([l, v]) => `
      <div class="rounded-lg bg-slate-50 px-1 py-1.5 dark:bg-slate-800/60"><dt class="text-[10px] text-slate-500">${l}</dt>
        <dd class="font-mono text-xs font-semibold tabular-nums ${tone(v)}">${pct(v)}</dd></div>`).join('')}</dl>`;
  }

  function hero(d) {
    const x = d.index;
    if (!x) return '';
    const sox = (d.stocks || []).filter((s) => s.inSox && s.changePct != null);
    const up = sox.filter((s) => s.changePct > 0).length;
    const avg = sox.length ? sox.reduce((t, s) => t + s.changePct, 0) / sox.length : null;
    const etf = (e) => `<div class="min-w-0 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <p class="truncate text-xs text-slate-500">${esc(e.symbol)} · ${esc(e.name)}</p>
        <p class="font-mono font-bold tabular-nums">$${price(e.price)} <span class="text-xs ${tone(e.changePct)}">${arrow(e.changePct)} ${pct(e.changePct)}</span></p>
        <p class="text-[11px] text-slate-500">연초 대비 <b class="font-mono ${tone(e.r?.ytd)}">${pct(e.r?.ytd)}</b></p>
      </div>`;
    return `<section class="mb-6 grid gap-4 lg:grid-cols-3">
      <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
        <div class="mb-1 flex flex-wrap items-baseline gap-x-3">
          <h2 class="text-sm font-bold">${esc(x.name)}</h2>
          <span class="text-[11px] text-slate-400">${x.sessionDate ? `${esc(x.sessionDate)} 기준` : ''}</span>
        </div>
        <div class="mb-2 flex flex-wrap items-baseline gap-x-3">
          <p class="font-mono text-3xl font-bold tabular-nums">${price(x.price)}</p>
          <p class="font-mono text-sm tabular-nums ${tone(x.changePct)}">${arrow(x.changePct)} ${x.change != null ? price(Math.abs(x.change)) : ''} (${pct(x.changePct)})</p>
        </div>
        ${U.charts.sparkline((x.series || []).map((p) => ({ date: p.date, v: p.close })), { label: 'SOX', fmt: (v) => price(v) })}
        <div class="mt-3">${returnsGrid(x.r)}</div>
        <p class="mt-2 text-[11px] text-slate-500">52주 범위 ${price(x.low52)} – ${price(x.high52)}</p>
      </div>
      <div class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 class="text-sm font-bold">오늘의 SOX 구성종목</h2>
        <p class="text-sm">상승 <b class="font-mono text-emerald-600 dark:text-emerald-400">${up}</b> · 하락 <b class="font-mono text-rose-600 dark:text-rose-400">${sox.length - up}</b> <span class="text-slate-500">/ ${sox.length}종목</span></p>
        <div class="flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="img" aria-label="상승 ${up}, 하락 ${sox.length - up}">
          <div class="bg-emerald-500" style="width:${sox.length ? (up / sox.length) * 100 : 50}%"></div><div class="bg-rose-500" style="width:${sox.length ? 100 - (up / sox.length) * 100 : 50}%"></div>
        </div>
        <p class="text-xs text-slate-500">구성종목 평균 <b class="font-mono ${tone(avg)}">${pct(avg)}</b></p>
        ${(d.etfs || []).map(etf).join('')}
      </div>
    </section>`;
  }

  // ---------- relative performance (multi-line, indexed to 100, shared time axis) ----------
  function relSeries(d) {
    const bySym = new Map((d.stocks || []).map((s) => [s.symbol, s]));
    return REL.map((r) => {
      const src = r.key === 'sox' ? d.index : bySym.get(r.key);
      const pts = (src && src.series || []).filter((p) => p.close != null);
      if (pts.length < 2) return null;
      const base = pts[0].close;
      return { ...r, points: pts.map((p) => ({ t: Date.parse(`${p.date}T00:00:00Z`), date: p.date, v: (p.close / base) * 100 })) };
    }).filter(Boolean);
  }

  function relChart(d, W) {
    const series = relSeries(d);
    if (!series.length) return '';
    // Drawn at the container's pixel width (1:1) so text stays legible at every screen size.
    const H = 240, padL = 36, padR = 92, padT = 10, padB = 22;
    const all = series.flatMap((s) => s.points);
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
    let lo = Math.min(...all.map((p) => p.v)), hi = Math.max(...all.map((p) => p.v));
    const padV = (hi - lo) * 0.08 || 5; lo -= padV; hi += padV;
    const x = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
    const y = (v) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
    const ticks = [];
    const step = (hi - lo) > 80 ? 40 : (hi - lo) > 40 ? 20 : 10;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    if (lo < 100 && hi > 100 && !ticks.includes(100)) ticks.push(100); // always show the start baseline
    const grid = ticks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="currentColor" class="${v === 100 ? 'text-slate-400' : 'text-slate-200 dark:text-slate-800'}" ${v === 100 ? 'stroke-dasharray="4 3"' : ''}/>
      <text x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="currentColor" opacity=".55">${v}</text>`).join('');
    // Direct end labels, nudged apart so they never collide (≥ 12px).
    const ends = series.map((s) => ({ s, y: y(s.points[s.points.length - 1].v) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
    const lines = series.map((s) => `<path d="${s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}"
      fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke:${s.color}"/>`).join('');
    const labels = ends.map(({ s, y: ly }) => {
      const last = s.points[s.points.length - 1].v;
      return `<text x="${W - padR + 6}" y="${(ly + 3).toFixed(1)}" font-size="10.5" fill="currentColor"><tspan font-weight="600">${esc(s.label)}</tspan> ${last >= 100 ? '+' : '−'}${Math.abs(last - 100).toFixed(1)}%</text>`;
    }).join('');
    const legend = series.map((s) => `<li class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style="background:${s.color}"></span>${esc(s.label)}</li>`).join('');
    const firstDate = new Date(t0).toISOString().slice(5, 10).replace('-', '/'), lastDate = new Date(t1).toISOString().slice(5, 10).replace('-', '/');
    return `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      ${ui.sectionTitle('상대 성과 <span class="text-xs font-normal text-slate-500">약 6개월 · 시작일 = 100</span>', `<ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">${legend}</ul>`)}
      <div class="relative" data-rel-chart data-own-hover data-w="${W}">
        <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="max-w-full overflow-visible" role="img" aria-label="SOX, TSMC, 삼성전자, SK하이닉스, NVIDIA의 6개월 상대 성과 (시작=100)">
          ${grid}${lines}${labels}
          <line data-rel-cross x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="currentColor" class="hidden text-slate-400"/>
          <text x="${padL}" y="${H - 4}" font-size="10" fill="currentColor" opacity=".55">${firstDate}</text>
          <text x="${W - padR}" y="${H - 4}" font-size="10" text-anchor="end" fill="currentColor" opacity=".55">${lastDate}</text>
        </svg>
      </div>
      <p class="mt-1 text-[11px] text-slate-500">각 종목의 현지 통화 종가 기준이며 시장 휴일이 달라 날짜가 일부 다를 수 있습니다. TSMC는 대만 본주(2330) 기준.</p>
    </section>`;
  }

  // Hover for the relative chart: nearest date per series, one tooltip listing all values.
  function attachRelHover(rootEl, d) {
    const box = rootEl.querySelector('[data-rel-chart]');
    const tipEl = rootEl.querySelector('[data-chart-tip]');
    if (!box || !tipEl) return () => {};
    const series = relSeries(d);
    const all = series.flatMap((s) => s.points);
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
    const svg = box.querySelector('svg'), cross = box.querySelector('[data-rel-cross]');
    const W = Number(box.dataset.w) || 640, padL = 36, padR = 92;
    const onMove = (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * W;
      if (vx < padL || vx > W - padR) { onLeave(); return; }
      const t = t0 + ((vx - padL) / (W - padL - padR)) * (t1 - t0);
      cross.setAttribute('x1', vx); cross.setAttribute('x2', vx); cross.classList.remove('hidden');
      const rows = series.map((s) => {
        const p = s.points.reduce((best, q) => (Math.abs(q.t - t) < Math.abs(best.t - t) ? q : best), s.points[0]);
        return `${s.label} ${p.v.toFixed(1)}`;
      });
      tipEl.textContent = `${new Date(t).toISOString().slice(0, 10)} · ${rows.join(' · ')}`;
      tipEl.classList.remove('hidden');
      const tr = tipEl.getBoundingClientRect();
      tipEl.style.left = `${Math.min(window.innerWidth - tr.width - 8, Math.max(8, e.clientX - tr.width / 2))}px`;
      tipEl.style.top = `${Math.max(8, e.clientY - tr.height - 14)}px`;
    };
    const onLeave = () => { cross.classList.add('hidden'); tipEl.classList.add('hidden'); };
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerleave', onLeave);
    return () => { box.removeEventListener('pointermove', onMove); box.removeEventListener('pointerleave', onLeave); };
  }

  // ---------- heatmap (daily change; label always shown so color is never alone) ----------
  function heatmap(stocks) {
    const list = [...stocks].sort((a, b) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0));
    if (!list.length) return '';
    const tile = (s) => {
      const v = s.changePct ?? 0;
      const a = Math.min(1, Math.abs(v) / 4) * 0.75 + 0.12;
      const bg = v >= 0 ? `rgba(16,185,129,${a.toFixed(2)})` : `rgba(244,63,94,${a.toFixed(2)})`;
      const big = (s.marketCapUsd || 0) >= 5e11;
      // Big ($500B+) tiles span 2×2 only from sm up; on phones every tile is one cell so the grid stays short.
      return `<div class="flex min-w-0 flex-col justify-between rounded-lg p-2 ${big ? 'sm:col-span-2 sm:row-span-2' : ''} ${a > 0.5 ? 'text-white' : 'text-slate-800 dark:text-slate-100'}"
        style="background:${bg}" data-tip="${esc(`${name(s)} (${s.ticker}) · ${price(s.price, s.currency)} ${s.currency} · ${pct(s.changePct)} · 시총 ${cap(s.marketCapUsd)}`)}">
        <span class="truncate font-mono ${big ? 'text-xs sm:text-base' : 'text-xs'} font-bold">${esc(s.ticker)}</span>
        <span class="truncate ${big ? 'text-[10px] sm:text-xs' : 'text-[10px]'} opacity-90">${esc(name(s))}</span>
        <span class="font-mono ${big ? 'text-xs sm:text-lg' : 'text-xs'} font-semibold tabular-nums">${arrow(s.changePct)} ${pct(s.changePct)}</span>
      </div>`;
    };
    return `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      ${ui.sectionTitle('오늘의 히트맵 <span class="text-xs font-normal text-slate-500">시가총액 순 · 큰 칸 = $500B 이상</span>')}
      <div class="grid grid-flow-dense auto-rows-[4.25rem] grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-8">${list.map(tile).join('')}</div>
    </section>`;
  }

  // ---------- segment summary ----------
  function segments(stocks) {
    const rows = Object.entries(SEGMENTS).map(([k, label]) => {
      const list = stocks.filter((s) => s.segment === k);
      if (!list.length) return null;
      const avg = (f) => { const v = list.map(f).filter((x) => x != null); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };
      return { k, label, n: list.length, d1: avg((s) => s.changePct), m1: avg((s) => s.r?.m1), ytd: avg((s) => s.r?.ytd) };
    }).filter(Boolean).sort((a, b) => (b.ytd ?? -1e9) - (a.ytd ?? -1e9));
    if (!rows.length) return '';
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.ytd || 0)));
    const bar = (v) => `<span class="relative block h-3" aria-hidden="true"><span class="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-700"></span>
      <span class="absolute inset-y-0 ${v >= 0 ? 'left-1/2 rounded-r bg-emerald-500' : 'right-1/2 rounded-l bg-rose-500'}" style="width:${(Math.abs(v || 0) / max) * 50}%"></span></span>`;
    return `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      ${ui.sectionTitle('세그먼트별 평균 성과 <span class="text-xs font-normal text-slate-500">연초 대비 순</span>')}
      <div class="-mx-5 overflow-x-auto px-5"><table class="w-full text-sm sm:min-w-[560px]">
        <thead class="text-xs text-slate-500"><tr><th class="py-1.5 text-left font-medium">세그먼트</th><th class="hidden py-1.5 text-right font-medium sm:table-cell">종목</th>
          <th class="py-1.5 text-right font-medium">1일</th><th class="py-1.5 text-right font-medium">1개월</th><th class="py-1.5 text-right font-medium">연초 대비</th><th class="hidden w-1/3 py-1.5 sm:table-cell"></th></tr></thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${rows.map((r) => `<tr>
          <td class="py-2"><button data-semi="segment" data-value="${r.k}" class="text-left hover:text-indigo-600 dark:hover:text-indigo-400">${esc(r.label)}</button></td>
          <td class="hidden py-2 text-right font-mono text-slate-500 sm:table-cell">${r.n}</td>
          <td class="py-2 text-right font-mono tabular-nums ${tone(r.d1)}">${pct(r.d1)}</td>
          <td class="py-2 text-right font-mono tabular-nums ${tone(r.m1)}">${pct(r.m1)}</td>
          <td class="py-2 text-right font-mono font-semibold tabular-nums ${tone(r.ytd)}">${pct(r.ytd)}</td>
          <td class="hidden py-2 pl-3 sm:table-cell">${bar(r.ytd)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  }

  // ---------- sortable table ----------
  const COLS = [
    ['name', '종목', 'left'], ['segment', '세그먼트', 'left'], ['marketCapUsd', '시가총액', 'right'], ['price', '현재가', 'right'],
    ['changePct', '1일', 'right'], ['w1', '1주', 'right'], ['m1', '1개월', 'right'], ['m3', '3개월', 'right'], ['ytd', '연초 대비', 'right'],
    ['pos52', '52주 위치', 'right'], ['nextEarnings', '다음 실적', 'right'],
  ];
  const sortVal = (s, k) => ({
    name: name(s), segment: SEGMENTS[s.segment] || '', marketCapUsd: s.marketCapUsd, price: s.price, changePct: s.changePct,
    w1: s.r?.w1, m1: s.r?.m1, m3: s.r?.m3, ytd: s.r?.ytd, pos52: pos52(s), nextEarnings: s.nextEarnings || '9999',
  }[k]);

  function table(stocks) {
    const list = [...stocks].sort((a, b) => {
      const x = sortVal(a, view.sort), y = sortVal(b, view.sort);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * view.dir;
    });
    // Phones: the name column stays pinned while the numbers scroll; segment is hidden (also shown via filter).
    const thCls = (k) => (k === 'name' ? 'sticky left-0 z-10 bg-white dark:bg-slate-900' : k === 'segment' ? 'hidden sm:table-cell' : '');
    const th = ([k, label, align]) => `<th class="whitespace-nowrap px-2 py-2 font-medium text-${align} ${thCls(k)}" aria-sort="${view.sort === k ? (view.dir > 0 ? 'ascending' : 'descending') : 'none'}">
      <button data-semi="sort" data-value="${k}" class="inline-flex items-center gap-0.5 hover:text-slate-800 dark:hover:text-slate-200">${label}${view.sort === k ? (view.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    const cell = (v) => `<td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums ${tone(v)}">${pct(v)}</td>`;
    const rows = list.map((s) => {
      const p = pos52(s);
      const watched = U.isWatched(s.ticker);
      return `<tr class="${watched ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : ''}">
        <td class="sticky left-0 z-10 max-w-[9.5rem] px-2 py-2 sm:max-w-none ${watched ? 'bg-indigo-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900'}"><div class="flex items-center gap-2">
          <span aria-hidden="true">${FLAGS[s.country] || ''}</span>
          <div class="min-w-0"><p class="truncate font-medium">${esc(name(s))}${watched ? ' <span class="text-indigo-600 dark:text-indigo-400" title="관심종목">★</span>' : ''}</p>
            <p class="flex items-center gap-1 text-[11px] text-slate-500">${ui.ticker(s.ticker)}${s.inSox
              ? '<span class="rounded bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">SOX</span>'
              : '<span class="rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-800">비구성</span>'}</p></div></div></td>
        <td class="hidden whitespace-nowrap px-2 py-2 text-xs text-slate-600 dark:text-slate-300 sm:table-cell">${esc(SEGMENTS[s.segment] || '-')}</td>
        <td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">${cap(s.marketCapUsd)}</td>
        <td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">${price(s.price, s.currency)} <span class="text-[10px] text-slate-400">${esc(s.currency || '')}</span></td>
        ${cell(s.changePct)}${cell(s.r?.w1)}${cell(s.r?.m1)}${cell(s.r?.m3)}${cell(s.r?.ytd)}
        <td class="px-2 py-2" data-tip="${esc(`52주 ${price(s.low52, s.currency)} – ${price(s.high52, s.currency)} · 현재 ${p == null ? '-' : p.toFixed(0) + '%'}`)}">
          ${p == null ? '-' : `<div class="relative ml-auto h-1.5 w-16 rounded-full bg-slate-200 dark:bg-slate-700"><span class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style="left:${Math.min(100, Math.max(0, p))}%;background:var(--spark)"></span></div>`}</td>
        <td class="whitespace-nowrap px-2 py-2 text-right text-xs text-slate-600 dark:text-slate-300">${s.nextEarnings ? `${esc(U.formatDateKo(s.nextEarnings))}${s.earningsSession ? ` ${U.SESSIONS[s.earningsSession]}` : ''}` : '-'}</td>
      </tr>`;
    }).join('');
    return `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      ${ui.sectionTitle(`종목 비교 <span class="text-xs font-normal text-slate-500">${list.length}종목 · 머리글을 눌러 정렬</span>`)}
      <div class="-mx-5 overflow-x-auto px-5"><table class="w-full min-w-[980px] text-sm">
        <thead class="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800"><tr>${COLS.map(th).join('')}</tr></thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${rows}</tbody>
      </table></div>
    </section>`;
  }

  // ---------- fundamentals: valuation / profitability / efficiency (s.fund from fetch-semi-data.mjs) ----------
  // kind: 'x' ratio, 'pct' percent, 'days', 'usd'. hint = how to read it (neutral wording, not advice).
  const FUND_GROUPS = {
    valuation: { label: '밸류에이션', cols: [
      ['pe', 'PER', 'x', '주가 ÷ 최근 12개월 주당순이익. 이익 대비 주가 수준. 적자 기업은 표시하지 않습니다.'],
      ['fpe', 'Forward PER', 'x', '주가 ÷ 향후 12개월 예상 주당순이익(애널리스트 컨센서스). 성장 기대가 클수록 PER보다 낮게 나옵니다.'],
      ['peg', 'PEG', 'x', 'PER ÷ 예상 이익성장률. 1 안팎이면 성장 대비 가격이 중립적이라고 흔히 해석합니다.'],
      ['pb', 'PBR', 'x', '주가 ÷ 주당순자산. 장비·메모리처럼 자산이 큰 업종 비교에 자주 씁니다.'],
      ['evEbitda', 'EV/EBITDA', 'x', '기업가치(시총+순부채) ÷ 감가상각 전 영업이익. 부채·감가상각 차이를 줄여 비교합니다.'],
      ['divYield', '배당수익률', 'pct', '연간 주당배당금 ÷ 주가.'],
    ] },
    profit: { label: '수익성', cols: [
      ['grossMargin', '매출총이익률', 'pct', '(매출 − 매출원가) ÷ 매출. 제품 경쟁력·가격 결정력의 지표.'],
      ['opMargin', '영업이익률 (OPM)', 'pct', '영업이익 ÷ 매출. 판관비·R&D까지 반영한 본업의 수익성.'],
      ['netMargin', '순이익률', 'pct', '순이익 ÷ 매출.'],
      ['roe', 'ROE', 'pct', '순이익 ÷ 자기자본. 주주 자본으로 얼마나 벌었는지.'],
      ['revenueGrowth', '매출 성장률', 'pct', '최근 분기 매출의 전년 동기 대비 증감률.'],
    ] },
    efficiency: { label: '투자·효율', cols: [
      ['capexToSales', 'Capex/매출', 'pct', '설비투자 ÷ 매출. 파운드리·메모리는 높고 팹리스는 낮은 구조적 차이가 큽니다. 업황 사이클의 선행 신호로도 봅니다.'],
      ['invTurnover', '재고자산 회전율', 'x', '매출원가 ÷ 평균 재고자산. 높을수록 재고가 빨리 팔립니다. 업황 둔화 시 먼저 떨어지는 경향.'],
      ['dio', '재고일수 (DIO)', 'days', '365 ÷ 재고자산 회전율. 재고를 소진하는 데 걸리는 평균 일수.'],
      ['fcfMargin', 'FCF 마진', 'pct', '잉여현금흐름(영업현금흐름 − 설비투자) ÷ 매출.'],
      ['revenueUsd', '매출 (TTM)', 'usd', '최근 12개월 매출, USD 환산.'],
    ] },
  };
  const fview = { group: 'valuation', sort: 'fpe', dir: 1 };
  // Multiples, capex intensity and inventory days read low→high first; margins, growth and turnover high→low.
  const LOW_FIRST = ['pe', 'fpe', 'peg', 'pb', 'evEbitda', 'capexToSales', 'dio'];
  const defaultDir = (k) => (LOW_FIRST.includes(k) ? 1 : -1);

  const fmtFund = (v, kind) => {
    if (v == null || Number.isNaN(v)) return '-';
    if (kind === 'pct') return `${v.toFixed(1)}%`;
    if (kind === 'days') return `${Math.round(v)}일`;
    if (kind === 'usd') return cap(v);
    return `${v.toFixed(1)}x`;
  };
  const median = (vals) => {
    const v = vals.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  // Forward PER vs operating margin; bubble area ∝ market cap; 2 categorical colors (SOX member / not).
  function fundScatter(stocks) {
    const pts = stocks.filter((s) => s.fund && s.fund.fpe > 0 && s.fund.opMargin != null);
    if (pts.length < 3) return '';
    const W = Math.max(300, Math.min(1200, (root.clientWidth || 680) - 76)), H = 300, padL = 40, padR = 16, padT = 12, padB = 34;
    const CAP_Y = 80; // Forward PER above this is drawn at the top edge (marked ▲) so outliers don't flatten the rest.
    const xs = pts.map((s) => s.fund.opMargin);
    let x0 = Math.min(0, ...xs), x1 = Math.max(...xs);
    const xr = (x1 - x0) || 10; x0 -= xr * 0.05; x1 += xr * 0.05;
    const ymax = Math.min(CAP_Y, Math.max(...pts.map((s) => s.fund.fpe)) * 1.08);
    const x = (v) => padL + ((v - x0) / (x1 - x0)) * (W - padL - padR);
    const y = (v) => padT + (1 - Math.min(v, ymax) / ymax) * (H - padT - padB);
    const maxCap = Math.max(...pts.map((s) => s.marketCapUsd || 0)) || 1;
    const narrow = W < 480;
    const r = (s) => 4 + Math.sqrt((s.marketCapUsd || 0) / maxCap) * (narrow ? 9 : 14);
    const big = new Set([...pts].sort((a, b) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0)).slice(0, narrow ? 6 : 10).map((s) => s.symbol));
    // Greedy label placement: skip a label that would overlap one already placed (e.g. TSM vs 2330).
    const placed = [];
    const fits = (lx, ly, w) => {
      if (placed.some((p) => Math.abs(p.y - ly) < 11 && lx < p.x + p.w && p.x < lx + w)) return false;
      placed.push({ x: lx, y: ly, w });
      return true;
    };
    const xTicks = []; const xs0 = Math.ceil(x0 / 20) * 20; for (let v = xs0; v <= x1; v += 20) xTicks.push(v);
    const yTicks = []; for (let v = 0; v <= ymax; v += ymax > 50 ? 20 : 10) yTicks.push(v);
    const grid = yTicks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" class="text-slate-200 dark:text-slate-800"/>
        <text x="${padL - 6}" y="${y(v) + 3}" font-size="10" text-anchor="end" fill="currentColor" opacity=".55">${v}</text>`).join('')
      + xTicks.map((v) => `<text x="${x(v)}" y="${H - padB + 14}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".55">${v}%</text>`).join('');
    const dots = [...pts].sort((a, b) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0)).map((s) => {
      const capped = s.fund.fpe > ymax;
      const lx = x(s.fund.opMargin) + r(s) + 3, ly = y(s.fund.fpe) + 3;
      const label = (big.has(s.symbol) || U.isWatched(s.ticker)) && fits(lx, ly, String(s.ticker).length * 6.2);
      return `<g data-tip="${esc(`${name(s)} (${s.ticker}) · Forward PER ${fmtFund(s.fund.fpe, 'x')} · 영업이익률 ${fmtFund(s.fund.opMargin, 'pct')} · 시총 ${cap(s.marketCapUsd)}`)}">
        <circle cx="${x(s.fund.opMargin).toFixed(1)}" cy="${y(s.fund.fpe).toFixed(1)}" r="${r(s).toFixed(1)}" style="fill:${s.inSox ? 'var(--c1)' : 'var(--c2)'};stroke:var(--surface)" fill-opacity=".75" stroke-width="2"/>
        ${capped ? `<text x="${x(s.fund.opMargin).toFixed(1)}" y="${(y(s.fund.fpe) + 4).toFixed(1)}" font-size="9" text-anchor="middle" fill="#fff">▲</text>` : ''}
        ${label ? `<text x="${(x(s.fund.opMargin) + r(s) + 3).toFixed(1)}" y="${(y(s.fund.fpe) + 3).toFixed(1)}" font-size="10" font-weight="600" fill="currentColor">${esc(s.ticker)}</text>` : ''}
      </g>`;
    }).join('');
    const legend = `<ul class="flex flex-wrap gap-x-3 text-xs text-slate-600 dark:text-slate-300">
      <li class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background:var(--c1)"></span>SOX 구성</li>
      <li class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full" style="background:var(--c2)"></span>비구성</li>
      <li class="text-slate-400">원 크기 = 시가총액</li></ul>`;
    return `<div class="mb-5">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2"><p class="text-sm font-semibold">Forward PER × 영업이익률</p>${legend}</div>
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="max-w-full overflow-visible" role="img" aria-label="종목별 영업이익률(가로)과 Forward PER(세로) 산점도">
        ${grid}
        <line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" stroke="currentColor" class="text-slate-300 dark:text-slate-700"/>
        ${dots}
        <text x="${(W + padL) / 2}" y="${H - 2}" font-size="10.5" text-anchor="middle" fill="currentColor" opacity=".7">영업이익률 (OPM) →</text>
        <text x="${padL}" y="${padT - 2}" font-size="10.5" fill="currentColor" opacity=".7">↑ Forward PER</text>
      </svg>
      <p class="mt-1 text-[11px] text-slate-500">오른쪽 아래일수록 높은 수익성 대비 낮은 예상 이익 배수입니다. Forward PER ${CAP_Y}배 초과는 위쪽 끝에 ▲로 표시. 적자·컨센서스 없는 종목은 제외.</p>
    </div>`;
  }

  function fundamentals(stocks) {
    const have = stocks.filter((s) => s.fund);
    if (!have.length) return '';
    const g = FUND_GROUPS[fview.group];
    if (!g.cols.some(([k]) => k === fview.sort)) { fview.sort = g.cols[0][0]; fview.dir = defaultDir(fview.sort); }
    const list = [...have].sort((a, b) => {
      const va = a.fund[fview.sort], vb = b.fund[fview.sort];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * fview.dir;
    });
    const tab = (k) => `<button data-semi="fgroup" data-value="${k}" role="tab" aria-selected="${fview.group === k}"
      class="rounded-md px-3 py-1.5 text-sm font-medium transition ${fview.group === k
        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}">${FUND_GROUPS[k].label}</button>`;
    const th = ([k, label, , hint]) => `<th class="whitespace-nowrap px-2 py-2 text-right font-medium" aria-sort="${fview.sort === k ? (fview.dir > 0 ? 'ascending' : 'descending') : 'none'}" data-tip="${esc(`${label}: ${hint}`)}">
      <button data-semi="fsort" data-value="${k}" class="inline-flex items-center gap-0.5 border-b border-dotted border-slate-400 hover:text-slate-800 dark:hover:text-slate-200">${label}${fview.sort === k ? (fview.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    const medRow = `<tr class="bg-slate-50 font-semibold dark:bg-slate-800/60">
      <td class="sticky left-0 z-10 bg-slate-50 px-2 py-2 text-xs dark:bg-slate-800">표시 종목 중앙값 <span class="font-normal text-slate-500">(${have.length})</span></td>
      ${g.cols.map(([k, , kind]) => `<td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">${fmtFund(median(have.map((s) => s.fund[k])), kind)}</td>`).join('')}
    </tr>`;
    const rows = list.map((s) => `<tr class="${U.isWatched(s.ticker) ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : ''}">
      <td class="sticky left-0 z-10 max-w-[9.5rem] px-2 py-2 sm:max-w-none ${U.isWatched(s.ticker) ? 'bg-indigo-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900'}"><div class="flex items-center gap-2"><span aria-hidden="true">${FLAGS[s.country] || ''}</span>
        <div class="min-w-0"><p class="truncate font-medium">${esc(name(s))}</p><p class="truncate text-[11px] text-slate-500">${ui.ticker(s.ticker)}<span class="hidden sm:inline"> · ${esc(SEGMENTS[s.segment] || '')}</span></p></div></div></td>
      ${g.cols.map(([k, , kind]) => {
        const basis = s.fund.basis && s.fund.basis[k];
        // Metrics dropped by the fetcher because the quote and reporting currencies differ (e.g. TSM ADR vs TWD books).
        const ex = s.fund.excluded && (s.fund.excluded.keys || []).includes(k);
        if (ex) return `<td class="whitespace-nowrap px-2 py-2 text-right text-xs text-slate-400" data-tip="${esc(s.fund.excluded.reason || '통화 불일치로 제외')}">n/a</td>`;
        return `<td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums"${basis ? ` title="${esc(basis)} 기준"` : ''}>${fmtFund(s.fund[k], kind)}</td>`;
      }).join('')}
    </tr>`).join('');
    const asOfs = have.map((s) => s.fund.asOf).filter(Boolean).sort();
    return `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-bold">밸류에이션 · 수익성 · 효율 비교</h2>
          <p class="mt-0.5 text-xs text-slate-500">지표 이름에 마우스를 올리면 설명이 나옵니다 · 머리글을 눌러 정렬</p>
        </div>
        <div class="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="tablist">${Object.keys(FUND_GROUPS).map(tab).join('')}</div>
      </div>
      ${fview.group === 'valuation' || fview.group === 'profit' ? fundScatter(have) : ''}
      <div class="-mx-5 overflow-x-auto px-5"><table class="w-full min-w-[760px] text-sm">
        <thead class="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800"><tr>
          <th class="sticky left-0 z-10 bg-white px-2 py-2 text-left font-medium dark:bg-slate-900">종목</th>${g.cols.map(th).join('')}</tr></thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${medRow}${rows}</tbody>
      </table></div>
      <p class="mt-3 text-[11px] leading-relaxed text-slate-500">
        출처 Yahoo Finance (재무제표 기준일 ${esc(asOfs[0] || '-')} ~ ${esc(asOfs[asOfs.length - 1] || '-')}). 회계기준(US GAAP·IFRS·K-IFRS)과 결산월이 달라 종목 간 수치는 근사 비교입니다.
        Capex/매출·재고 지표는 최근 12개월(TTM)을 우선 쓰고 없으면 최근 회계연도 값입니다(숫자에 마우스를 올리면 기준 표시). 투자 권유가 아닙니다.
      </p>
    </section>`;
  }

  // ---------- upcoming earnings ----------
  function earnings(stocks) {
    const today = U.dateKey(new Date());
    const list = stocks.filter((s) => s.nextEarnings && s.nextEarnings >= today).sort((a, b) => a.nextEarnings.localeCompare(b.nextEarnings)).slice(0, 12);
    if (!list.length) return '';
    return `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      ${ui.sectionTitle('다가오는 반도체 실적', '<a href="#/calendar" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">캘린더 →</a>')}
      <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">${list.map((s) => `<li class="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
        <span class="w-24 shrink-0 text-xs text-slate-500">${esc(U.formatDateKo(s.nextEarnings))}</span>
        ${ui.ticker(s.ticker)}<span class="min-w-0 flex-1 truncate">${esc(name(s))}</span>
        <span class="shrink-0 text-xs text-slate-500">${s.earningsSession ? U.SESSIONS[s.earningsSession] : ''}</span></li>`).join('')}</ul>
    </section>`;
  }

  // ---------- render ----------
  function draw() {
    if (!root) return;
    if (detachHover) { detachHover(); detachHover = null; }
    if (detachRel) { detachRel(); detachRel = null; }
    U.charts.resetSparklines();
    const d = window.SEMI_DATA;
    if (!d || !Array.isArray(d.stocks)) {
      root.innerHTML = `<h1 class="mb-4 text-xl font-bold">반도체</h1>${ui.card(ui.empty(loading ? '반도체 데이터를 불러오는 중…' : '반도체 데이터가 없습니다. node scripts/fetch-semi-data.mjs 로 스냅샷을 만드세요.'))}`;
      return;
    }
    const stocks = filtered(d.stocks);
    const c = d.constituents || {};
    const chip = (key, label, n) => `<button data-semi="filter" data-value="${key}" aria-pressed="${view.filter === key}"
      class="shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${view.filter === key
        ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'}">${label}${n != null ? ` <span class="text-xs opacity-75">${n}</span>` : ''}</button>`;
    const segOpts = [['all', '세그먼트 전체'], ...Object.entries(SEGMENTS)].map(([k, l]) => `<option value="${k}" ${view.segment === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const counts = { all: d.stocks.length, sox: d.stocks.filter((s) => s.inSox).length, non: d.stocks.filter((s) => !s.inSox).length, kr: d.stocks.filter((s) => s.country === 'KR').length };
    root.innerHTML = `<div id="semi-root" class="relative">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold">반도체</h1>
          <p class="mt-0.5 text-xs text-slate-500">${ui.staleSnapshot(d.generatedAt)} 스냅샷 ${esc(new Date(d.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} KST ·
            SOX 구성종목 ${c.count || counts.sox}개(<a href="${esc(c.url || '#')}" target="_blank" rel="noopener noreferrer" class="underline decoration-dotted">${esc(c.asOf || '')} Nasdaq 공식</a>) + 주요 비구성 종목</p>
        </div>
      </div>
      ${hero(d)}
      ${relChart(d, Math.max(300, Math.min(1200, (root.clientWidth || 680) - 76)))}
      <div class="sticky z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 bg-slate-50/95 px-4 py-2 backdrop-blur dark:bg-slate-950/95" style="top: var(--header-h, 0px)">
        <div class="no-scrollbar flex gap-2 overflow-x-auto">
          ${chip('all', '전체', counts.all)}${chip('sox', 'SOX 구성', counts.sox)}${chip('non', '비구성 (TSMC 본주·삼성 등)', counts.non)}${chip('kr', '한국', counts.kr)}${chip('watch', '관심종목')}
        </div>
        <select data-semi="segment-select" class="ml-auto rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">${segOpts}</select>
      </div>
      ${stocks.length ? `${heatmap(stocks)}${segments(stocks)}${table(stocks)}${fundamentals(stocks)}${earnings(stocks)}` : ui.card(ui.empty('조건에 맞는 종목이 없습니다.'))}
      <div data-chart-tip role="tooltip" class="pointer-events-none fixed z-50 hidden max-w-sm rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-white dark:text-slate-900"></div>
      <p class="text-xs text-slate-500">가격·등락은 각 거래소 현지 통화 기준 스냅샷(Yahoo Finance)입니다. 시가총액은 USD 환산. 투자 권유가 아닙니다.</p>
    </div>`;
    const sr = root.querySelector('#semi-root');
    detachHover = U.charts.attachChartHover(sr);
    detachRel = attachRelHover(sr, d);
  }

  U.views.semi = {
    render(container) {
      this.unmount();
      root = container;
      onClick = (e) => {
        const el = e.target.closest('[data-semi]');
        if (!el || el.tagName === 'SELECT') return;
        const kind = el.dataset.semi;
        if (kind === 'filter') view.filter = el.dataset.value;
        else if (kind === 'segment') view.segment = el.dataset.value;
        else if (kind === 'fgroup') fview.group = el.dataset.value;
        else if (kind === 'fsort') {
          const k = el.dataset.value;
          if (fview.sort === k) fview.dir = -fview.dir;
          else { fview.sort = k; fview.dir = defaultDir(k); }
        } else if (kind === 'sort') {
          const k = el.dataset.value;
          if (view.sort === k) view.dir = -view.dir; else { view.sort = k; view.dir = ['name', 'segment', 'nextEarnings'].includes(k) ? 1 : -1; }
        } else return;
        draw();
      };
      onChange = (e) => {
        if (e.target.dataset.semi !== 'segment-select') return;
        view.segment = e.target.value;
        draw();
      };
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      // The relative chart is drawn at pixel width; redraw when the width actually changes.
      let lastWidth = root.clientWidth;
      onResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (root && root.clientWidth !== lastWidth) { lastWidth = root.clientWidth; draw(); } }, 200);
      };
      window.addEventListener('resize', onResize);
      if (!window.SEMI_DATA || Date.now() - loadedAt > RELOAD_MS) {
        draw(); // loading state
        loadData().then(() => { if (root === container) draw(); });
      } else {
        draw();
      }
    },
    unmount() {
      if (root && onClick) root.removeEventListener('click', onClick);
      if (root && onChange) root.removeEventListener('change', onChange);
      if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
      clearTimeout(resizeTimer);
      if (detachHover) { detachHover(); detachHover = null; }
      if (detachRel) { detachRel(); detachRel = null; }
      root = onClick = onChange = null;
    },
  };
})();
