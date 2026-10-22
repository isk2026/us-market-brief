/*
 * 채권·금리·환율·원자재 view.
 * Data: window.MACRO_DATA from js/macroData.js (scripts/fetch-macro-data.mjs — Treasury CSV, FRED / ECB via the
 * multi-asset-morning-briefing skill, Yahoo Finance for FX, commodities and bond ETFs), lazy-loaded on first visit.
 * Sparklines / hover reuse UMB.charts (marketPanel.js). Explanations are neutral reading guides, not advice.
 */
(function () {
  'use strict';
  const U = window.UMB;
  const { esc, ui } = U;

  const RELOAD_MS = 4 * 60 * 1000; // snapshots refresh about every 15 min (GitHub Actions)
  const COMMODITY_GROUPS = [['energy', '에너지'], ['metals', '금속'], ['agri', '농산물']];

  let root = null;
  let onResize = null;
  let resizeTimer = null;
  let detachHover = null;
  let loadedAt = 0;
  let loading = null;

  function loadData() {
    if (loading) return loading;
    loading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `js/macroData.js?v=${Date.now()}`;
      s.onload = s.onerror = () => { s.remove(); loadedAt = Date.now(); loading = null; resolve(); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // ---------- formatting ----------
  const num = (v, d = 2) => (v == null || Number.isNaN(v) ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v, d = 2) => (v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
  const bp = (v) => (v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}bp`);
  const tone = (v) => (v == null || Number.isNaN(v) || v === 0 ? 'text-slate-500' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
  const neutral = 'text-slate-600 dark:text-slate-300'; // rate moves are not good/bad by themselves
  const arrow = (v) => (v == null || Number.isNaN(v) || v === 0 ? '■' : v > 0 ? '▲' : '▼');
  const last = (a) => (a && a.length ? a[a.length - 1] : null);
  const valueAt = (series, days) => {
    if (!series || !series.length) return null;
    const lastDate = Date.parse(`${last(series).date}T00:00:00Z`);
    const target = lastDate - days * 86400e3;
    for (let i = series.length - 1; i >= 0; i--) if (Date.parse(`${series[i].date}T00:00:00Z`) <= target) return series[i].value ?? series[i].close;
    return null;
  };
  // FX quotes below 10 (EUR/USD, GBP/USD, USD/CNY) need 4 decimals; commodities and everything else use 2.
  const priceDigits = (i) => (i.pair && !/krw|jpy/i.test(i.key || '') && (i.price || 0) < 10 ? 4 : 2);
  // Own header (wraps on phones) instead of ui.sectionTitle, whose title and right side share one row.
  const section = (title, body, right = '') => `<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5"><h2 class="text-base font-bold">${title}</h2>${right}</div>${body}</section>`;
  const chartWidth = () => Math.max(300, Math.min(1200, (root && root.clientWidth || 680) - 76));

  // ---------- A. key signals ----------
  function signals(d) {
    const r = d.rates || {};
    const c = r.curve || {};
    const y10 = c.today && c.today['10Y'];
    const y10m = c.monthAgo && c.monthAgo['10Y'];
    const s = r.spreads || {};
    // Look up by key (case-insensitive) or Yahoo symbol, so data-file naming changes don't blank the tiles.
    const find = (list, key, sym) => (list || []).find((x) => String(x.key || '').toLowerCase() === key || x.symbol === sym);
    const dxy = find(d.fx, 'dxy', 'DX-Y.NYB'), krw = find(d.fx, 'usdkrw', 'KRW=X'), gold = find(d.commodities, 'gold', 'GC=F');
    const hy = r.credit && r.credit.hy;
    const tile = (label, value, sub, hint) => `<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-tip="${esc(hint)}">
      <p class="text-xs text-slate-500">${label}</p>
      <p class="mt-1 font-mono text-xl font-bold tabular-nums">${value}</p>
      <p class="mt-0.5 text-[11px] text-slate-500">${sub}</p></div>`;
    const inverted = s.s2s10 && s.s2s10.value < 0;
    return `<section class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      ${tile('미 국채 10년', y10 == null ? '-' : `${num(y10)}%`, `1개월 ${y10 != null && y10m != null ? bp((y10 - y10m) * 100) : '-'}`, '장기 금리의 기준. 오르면 성장주·장기채 가격에 부담이 되는 경향이 있습니다.')}
      ${tile('2s10s 스프레드', s.s2s10 ? bp(s.s2s10.value) : '-', inverted ? '<b class="text-rose-600 dark:text-rose-400">장단기 역전</b>' : `1개월 ${s.s2s10 ? bp(s.s2s10.change1m) : '-'}`, '10년 − 2년 금리차. 마이너스(역전)는 역사적으로 경기 둔화에 앞서 나타난 경우가 많습니다.')}
      ${tile('실질금리 10년', r.real10y ? `${num(r.real10y.value)}%` : '-', `기대인플레 ${r.breakeven10y ? `${num(r.breakeven10y.value)}%` : '-'}`, '물가연동국채(TIPS) 금리. 금·성장주의 기회비용으로 자주 쓰입니다. 기대인플레 = 명목 − 실질.')}
      ${tile('하이일드 스프레드', hy ? `${num(hy.value)}%` : '-', hy && hy.series ? `1개월 ${bp((hy.value - valueAt(hy.series, 30)) * 100)}` : '', '투기등급 회사채 가산금리. 확대되면 신용 위험 회피, 축소되면 위험 선호로 해석됩니다.')}
      ${tile('달러 인덱스', dxy ? num(dxy.price) : '-', dxy ? `<span class="${tone(dxy.changePct)}">${arrow(dxy.changePct)} ${pct(dxy.changePct)}</span> · 1개월 ${pct(dxy.r && dxy.r.m1)}` : '', '주요 6개 통화 대비 달러 가치. 달러 강세는 신흥국 증시·원자재에 부담이 되는 경향이 있습니다.')}
      ${tile('원/달러', krw ? num(krw.price) : '-', krw ? `<span class="${tone(krw.changePct)}">${arrow(krw.changePct)} ${pct(krw.changePct)}</span>${gold ? ` · 금 $${num(gold.price, 0)}` : ''}` : '', '1달러당 원화. 오르면(원화 약세) 수출주에 유리하고 해외 자산의 원화 환산 가치가 커집니다.')}
    </section>`;
  }

  // ---------- B. yield curve (today / 1M / 1Y ago) ----------
  function curveChart(d) {
    const c = d.rates && d.rates.curve;
    if (!c || !c.tenors || !c.today) return '';
    const W = chartWidth(), H = 240, padL = 40, padR = 20, padT = 14, padB = 30;
    const tenors = c.tenors.filter((t) => c.today[t.key] != null);
    const sets = [
      { key: 'today', label: `오늘 (${c.dates && c.dates.today || ''})`, color: 'var(--c1)', dash: '' },
      { key: 'monthAgo', label: `1개월 전 (${c.dates && c.dates.monthAgo || ''})`, color: 'var(--c2)', dash: '' },
      { key: 'yearAgo', label: `1년 전 (${c.dates && c.dates.yearAgo || ''})`, color: 'var(--neutral)', dash: '5 4' },
    ].filter((s) => c[s.key]);
    const vals = sets.flatMap((s) => tenors.map((t) => c[s.key][t.key]).filter((v) => v != null));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.15 || 0.25; lo -= pad; hi += pad;
    const x = (i) => padL + (i / (tenors.length - 1)) * (W - padL - padR);
    const y = (v) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
    const step = hi - lo > 2 ? 0.5 : 0.25;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(+v.toFixed(2));
    const grid = ticks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" class="text-slate-200 dark:text-slate-800"/>
      <text x="${padL - 6}" y="${y(v) + 3}" font-size="10" text-anchor="end" fill="currentColor" opacity=".55">${v.toFixed(2)}</text>`).join('');
    // Narrow charts: short tenor codes (1M, 3M … 30Y) so the 11 axis labels don't collide.
    const xl = tenors.map((t, i) => `<text x="${x(i)}" y="${H - 10}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">${esc(W < 560 ? t.key : t.label)}</text>`).join('');
    const lines = sets.map((s) => {
      const pts = tenors.map((t, i) => (c[s.key][t.key] == null ? null : [x(i), y(c[s.key][t.key]), t, c[s.key][t.key]])).filter(Boolean);
      return `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}" fill="none" stroke-width="2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} style="stroke:${s.color}"/>
        ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${s.key === 'today' ? 4 : 3}" style="fill:${s.color};stroke:var(--surface)" stroke-width="2"
          data-tip="${esc(`${s.label.split(' (')[0]} · ${p[2].label} ${num(p[3])}%`)}"/>`).join('')}`;
    }).join('');
    const legend = sets.map((s) => `<li class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style="background:${s.color}"></span>${esc(s.label)}</li>`).join('');
    const rows = tenors.map((t) => {
      const v = c.today[t.key], m = c.monthAgo && c.monthAgo[t.key], yv = c.yearAgo && c.yearAgo[t.key];
      return `<td class="px-2 py-1.5 text-right font-mono tabular-nums">${num(v)}<div class="text-[10px] ${neutral}">${m == null ? '' : bp((v - m) * 100)}</div><div class="text-[10px] text-slate-400">${yv == null ? '' : bp((v - yv) * 100)}</div></td>`;
    }).join('');
    const s = d.rates.spreads || {};
    const p = d.rates.policy;
    const CURVE = { bear_steepening: '베어 스티프닝 (장기금리 주도 상승)', bull_steepening: '불 스티프닝 (단기금리 주도 하락)', bear_flattening: '베어 플래트닝 (단기금리 주도 상승)', bull_flattening: '불 플래트닝 (장기금리 주도 하락)' };
    const chips = [
      s.s2s10 ? ui.badge(`2s10s ${bp(s.s2s10.value)}`, s.s2s10.value < 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200') : '',
      s.s3m10y ? ui.badge(`3M–10Y ${bp(s.s3m10y.value)}`, s.s3m10y.value < 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200') : '',
      CURVE[s.curveLabel] ? ui.badge(`최근 일간 움직임: ${CURVE[s.curveLabel]}`, 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300') : '',
      p ? ui.badge(`연준 기준금리 ${num(p.lower)}–${num(p.upper)}%`, 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300') : '',
    ].join(' ');
    return section('미국 국채 수익률 곡선', `
      <div class="mb-3 flex flex-wrap gap-2">${chips}</div>
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="max-w-full overflow-visible" role="img" aria-label="미국 국채 만기별 금리 곡선: 오늘, 1개월 전, 1년 전">${grid}${xl}${lines}</svg>
      <div class="-mx-4 mt-3 overflow-x-auto px-4 sm:-mx-5 sm:px-5"><table class="w-full min-w-[640px] text-xs">
        <thead class="text-slate-500"><tr><th class="px-2 py-1 text-left font-medium">만기</th>${tenors.map((t) => `<th class="px-2 py-1 text-right font-medium">${esc(t.label)}</th>`).join('')}</tr></thead>
        <tbody><tr><td class="px-2 py-1.5 text-slate-500">금리 %<div class="text-[10px]">1개월 변화</div><div class="text-[10px] text-slate-400">1년 변화</div></td>${rows}</tr></tbody>
      </table></div>
      <p class="mt-2 text-[11px] text-slate-500">${esc(c.source || 'U.S. Treasury')} 일별 par yield. 정상 곡선은 만기가 길수록 금리가 높고, 단기금리가 더 높은 '역전'은 경기 둔화 우려 신호로 자주 해석됩니다.</p>`,
      `<ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">${legend}</ul>`);
  }

  // ---------- B2. rate history + credit/inflation sparkline tiles ----------
  function seriesTile(title, obj, fmt, hint, unitChange) {
    if (!obj || obj.value == null) return '';
    const sr = (obj.series || []).map((p) => ({ date: p.date, v: p.value }));
    const m1 = valueAt(obj.series, 30);
    const chg = m1 == null ? null : unitChange === 'bp' ? bp((obj.value - m1) * 100) : pct(((obj.value - m1) / Math.abs(m1)) * 100);
    return `<div class="min-w-0 rounded-xl border border-slate-200 p-3 dark:border-slate-800" data-tip="${esc(hint)}">
      <div class="flex items-baseline justify-between gap-2"><p class="truncate text-xs text-slate-500">${title}</p><span class="text-[10px] text-slate-400">${esc(obj.asOf || '')}</span></div>
      <p class="font-mono text-lg font-bold tabular-nums">${fmt(obj.value)} <span class="text-[11px] font-normal ${neutral}">${chg ? `1개월 ${chg}` : ''}</span></p>
      ${sr.length > 1 ? U.charts.sparkline(sr, { label: title, fmt }) : ''}
    </div>`;
  }

  function ratesDetail(d) {
    const r = d.rates || {};
    const h = r.history || {};
    const hist = (key, label) => {
      const s = h[key];
      if (!s || !s.length) return '';
      return seriesTile(`미 국채 ${label}`, { value: last(s).value, asOf: last(s).date, series: s }, (v) => `${num(v)}%`, `미 국채 ${label} 금리 1년 추이`, 'bp');
    };
    const tiles = [
      hist('y3m', '3개월'), hist('y2', '2년'), hist('y10', '10년'),
      seriesTile('실질금리 10년 (TIPS)', r.real10y, (v) => `${num(v)}%`, 'FRED DFII10. 인플레이션을 뺀 금리. 높을수록 금·장기 성장주의 기회비용이 커집니다.', 'bp'),
      seriesTile('기대인플레이션 10년 (BEI)', r.breakeven10y, (v) => `${num(v)}%`, 'FRED T10YIE. 명목 10년 − TIPS 10년. 시장이 예상하는 향후 10년 평균 물가상승률.', 'bp'),
      seriesTile('하이일드 스프레드 (OAS)', r.credit && r.credit.hy, (v) => `${num(v)}%`, 'FRED BAMLH0A0HYM2. 투기등급 회사채와 국채의 금리차.', 'bp'),
      seriesTile('투자등급 스프레드 (OAS)', r.credit && r.credit.ig, (v) => `${num(v)}%`, 'FRED BAMLC0A0CM. 투자등급 회사채와 국채의 금리차.', 'bp'),
    ].filter(Boolean).join('');
    const g = (r.global10y || []).filter((x) => x.value != null);
    const max = Math.max(1, ...g.map((x) => x.value));
    const globalBars = g.length ? `<div class="mt-5">
      <p class="mb-2 text-sm font-semibold">주요국 10년 국채금리</p>
      <ul class="space-y-1.5">${g.sort((a, b) => b.value - a.value).map((x) => `<li class="grid grid-cols-[4rem_1fr_7.5rem] items-center gap-2 text-sm" data-tip="${esc(`${x.label} 10년 ${num(x.value)}% · ${x.asOf} · ${x.frequency === 'monthly' ? '월평균 (OECD)' : '일별'}`)}">
        <span>${esc(x.label)}</span>
        <span class="relative h-3 rounded-full bg-slate-100 dark:bg-slate-800"><span class="absolute inset-y-0 left-0 rounded-full" style="width:${(x.value / max) * 100}%;background:var(--c1)"></span></span>
        <span class="text-right font-mono text-xs tabular-nums">${num(x.value)}% <span class="text-[10px] text-slate-400">${esc(x.frequency === 'monthly' ? `${String(x.asOf || '').slice(0, 7)} 월평균` : 'daily')}</span></span></li>`).join('')}</ul>
      <p class="mt-1 text-[11px] text-slate-500">미국은 일별, 그 외는 FRED(OECD) 월평균 값이라 시점이 다를 수 있습니다.</p>
    </div>` : '';
    return section('금리·신용·물가 추이', `<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">${tiles}</div>${globalBars}`,
      '<span class="text-xs text-slate-500">FRED 지표는 multi-asset-morning-briefing 스킬로 수집</span>');
  }

  // ---------- C. bond ETFs ----------
  function bondEtfs(d) {
    const list = d.bondEtfs || [];
    if (!list.length) return '';
    const hasDur = list.some((e) => e.duration != null); // Yahoo often lacks duration; hide the column then
    const cell = (v) => `<td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums ${tone(v)}">${pct(v)}</td>`;
    const rows = list.map((e) => `<tr>
      <td class="px-2 py-2"><span class="font-mono text-xs font-bold">${esc(e.symbol)}</span> <span class="text-slate-600 dark:text-slate-300">${esc(e.name)}</span></td>
      <td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">$${num(e.price)}</td>
      ${cell(e.changePct)}${cell(e.r && e.r.m1)}${cell(e.r && e.r.ytd)}${cell(e.r && e.r.y1)}
      <td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">${e.yield == null ? (e.secYield == null ? '-' : `${num(e.secYield)}%`) : `${num(e.yield)}%`}</td>
      ${hasDur ? `<td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">${e.duration == null ? '-' : `${num(e.duration, 1)}년`}</td>` : ''}
      <td class="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">${e.expenseRatio == null ? '-' : `${num(e.expenseRatio)}%`}</td>
    </tr>`).join('');
    return section('채권 ETF', `<div class="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5"><table class="w-full min-w-[720px] text-sm">
      <thead class="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800"><tr>
        <th class="px-2 py-2 text-left font-medium">ETF</th><th class="px-2 py-2 text-right font-medium">가격</th><th class="px-2 py-2 text-right font-medium">1일</th>
        <th class="px-2 py-2 text-right font-medium">1개월</th><th class="px-2 py-2 text-right font-medium">연초 대비</th><th class="px-2 py-2 text-right font-medium">1년</th>
        <th class="px-2 py-2 text-right font-medium" data-tip="최근 12개월 분배금 기준 수익률">분배수익률</th>
        ${hasDur ? '<th class="px-2 py-2 text-right font-medium" data-tip="금리 1%p 변화 시 가격이 대략 몇 % 움직이는지">듀레이션</th>' : ''}
        <th class="px-2 py-2 text-right font-medium">보수율</th></tr></thead>
      <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${rows}</tbody></table></div>
      <p class="mt-2 text-[11px] text-slate-500">가격 수익률이며 분배금은 포함하지 않습니다. 금리가 오르면 듀레이션이 긴 ETF(TLT 등)일수록 가격이 더 크게 내립니다.</p>`);
  }

  // ---------- D/E. instrument cards (FX, commodities) ----------
  function instrumentCard(i, extra = '') {
    const digits = priceDigits(i);
    const pos = i.high52 > i.low52 ? ((i.price - i.low52) / (i.high52 - i.low52)) * 100 : null;
    return `<section class="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-1 flex items-start justify-between gap-2">
        <div class="min-w-0"><h3 class="truncate font-bold">${esc(i.name)}</h3>
          <p class="truncate text-[11px] text-slate-400">${esc(i.pair || i.unit || '')} · ${esc(i.symbol)}</p></div>
        ${i.stale ? ui.badge('갱신 실패 · 이전 값', 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300') : ''}
      </div>
      <div class="mb-1 flex flex-wrap items-baseline gap-x-2">
        <p class="font-mono text-xl font-bold tabular-nums">${num(i.price, digits)}</p>
        <p class="font-mono text-sm tabular-nums ${tone(i.changePct)}">${arrow(i.changePct)} ${pct(i.changePct)}</p>
      </div>
      <p class="mb-1 text-[10px] text-slate-400">${esc(i.sessionDate || '')} 기준</p>
      ${U.charts.sparkline((i.series || []).map((p) => ({ date: p.date, v: p.close })), { label: i.name, fmt: (v) => num(v, digits) })}
      <dl class="mt-2 grid grid-cols-4 gap-1 text-center">${[['1개월', i.r && i.r.m1], ['3개월', i.r && i.r.m3], ['연초', i.r && i.r.ytd], ['1년', i.r && i.r.y1]].map(([l, v]) => `
        <div class="rounded-lg bg-slate-50 px-1 py-1 dark:bg-slate-800/60"><dt class="text-[10px] text-slate-500">${l}</dt><dd class="font-mono text-[11px] font-semibold tabular-nums ${tone(v)}">${pct(v, 1)}</dd></div>`).join('')}</dl>
      ${pos == null ? '' : `<p class="mt-2 text-[10px] text-slate-500" data-tip="${esc(`52주 ${num(i.low52, digits)} – ${num(i.high52, digits)}`)}">52주 범위 중 <b class="font-mono">${pos.toFixed(0)}%</b> 위치</p>`}
      ${extra}
    </section>`;
  }

  function fxSection(d) {
    const list = d.fx || [];
    if (!list.length) return '';
    const ecb = d.ecbFx;
    const note = ecb && ecb.rates ? `<p class="mt-3 text-[11px] text-slate-500">ECB 공식 기준환율 (${esc(ecb.asOf || '')}, 1유로당): ${Object.entries(ecb.rates).filter(([, v]) => v != null).map(([k, v]) => `${esc(k)} ${num(v, 4)}`).join(' · ')} · ${esc(ecb.source || '')}</p>` : '';
    return section('환율', `<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">${list.map((i) => instrumentCard(i)).join('')}</div>
      <p class="mt-3 text-[11px] text-slate-500">원/달러·엔/달러·위안/달러는 1달러당 해당 통화(오르면 그 통화 약세), 유로/달러·파운드/달러는 1유로·1파운드당 달러(오르면 그 통화 강세)입니다.</p>${note}`);
  }

  function commoditiesSection(d) {
    const list = d.commodities || [];
    if (!list.length) return '';
    const groups = COMMODITY_GROUPS.map(([g, label]) => {
      const items = list.filter((i) => i.group === g);
      if (!items.length) return '';
      return `<div class="mb-5"><p class="mb-2 text-sm font-semibold">${label}</p>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">${items.map((i) => instrumentCard(i)).join('')}</div></div>`;
    }).join('');
    const ra = d.ratios || {};
    const ratio = (title, obj, hint, digits) => (obj && obj.value != null ? `<div class="min-w-0 rounded-xl border border-slate-200 p-3 dark:border-slate-800" data-tip="${esc(hint)}">
      <p class="text-xs text-slate-500">${title}</p>
      <p class="font-mono text-lg font-bold tabular-nums">${num(obj.value, digits)}</p>
      ${obj.series && obj.series.length > 1 ? U.charts.sparkline(obj.series.map((p) => ({ date: p.date, v: p.value })), { label: title, fmt: (v) => num(v, digits) }) : ''}
      <p class="mt-1 text-[11px] leading-snug text-slate-500">${esc(hint)}</p></div>` : '');
    const ratios = [
      ratio('금/은 비율', ra.goldSilver, '금 1온스로 살 수 있는 은의 온스 수. 높을수록 안전자산(금) 선호가 상대적으로 강하다고 해석됩니다.', 1),
      ratio('구리/금 비율 (×1000)', ra.copperGold, '경기에 민감한 구리 대 안전자산 금. 상승은 경기 기대 개선, 하락은 경기 우려로 흔히 해석되며 장기금리와 함께 움직이는 경향이 있습니다.', 3),
    ].filter(Boolean).join('');
    return section('원자재', `${groups}${ratios ? `<p class="mb-2 text-sm font-semibold">경기 신호 비율</p><div class="grid grid-cols-1 gap-3 sm:grid-cols-2">${ratios}</div>` : ''}
      <p class="mt-3 text-[11px] text-slate-500">선물 근월물 가격(Yahoo Finance)이며 만기 교체(롤오버) 시점에는 일간 변동이 크게 보일 수 있습니다.</p>`);
  }

  // ---------- render ----------
  function draw() {
    if (!root) return;
    if (detachHover) { detachHover(); detachHover = null; }
    U.charts.resetSparklines();
    const d = window.MACRO_DATA;
    if (!d || !d.rates) {
      root.innerHTML = `<h1 class="mb-4 text-xl font-bold">채권·금리·환율·원자재</h1>${ui.card(ui.empty(loading ? '데이터를 불러오는 중…' : '데이터가 없습니다. node scripts/fetch-macro-data.mjs 로 스냅샷을 만드세요.'))}`;
      return;
    }
    const jump = [['m-rates', '금리'], ['m-bonds', '채권 ETF'], ['m-fx', '환율'], ['m-cmd', '원자재']]
      .map(([id, l]) => `<a href="#/macro" data-jump="${id}" class="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">${l}</a>`).join('');
    root.innerHTML = `<div id="macro-root" class="relative">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold">채권·금리·환율·원자재</h1>
          <p class="mt-0.5 text-xs text-slate-500">${ui.staleSnapshot(d.generatedAt)} 스냅샷 ${esc(new Date(d.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} KST · 미 재무부 · FRED·ECB(스킬) · Yahoo Finance</p>
        </div>
        <div class="no-scrollbar flex gap-2 overflow-x-auto">${jump}</div>
      </div>
      ${signals(d)}
      <div id="m-rates">${curveChart(d)}${ratesDetail(d)}</div>
      <div id="m-bonds">${bondEtfs(d)}</div>
      <div id="m-fx">${fxSection(d)}</div>
      <div id="m-cmd">${commoditiesSection(d)}</div>
      <div data-chart-tip role="tooltip" class="pointer-events-none fixed z-50 hidden max-w-sm rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-white dark:text-slate-900"></div>
      <p class="text-xs text-slate-500">지표 해석은 일반적인 시장 관행을 요약한 참고 정보입니다. 투자 권유가 아닙니다.</p>
    </div>`;
    const mr = root.querySelector('#macro-root');
    detachHover = U.charts.attachChartHover(mr);
    // In-page jump links (keep the #/macro route; scroll below the sticky header).
    mr.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const t = document.getElementById(a.dataset.jump);
      if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h'), 10) || 0) - 12, behavior: 'smooth' });
    }));
  }

  U.views.macro = {
    render(container) {
      this.unmount();
      root = container;
      let lastWidth = root.clientWidth;
      onResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (root && root.clientWidth !== lastWidth) { lastWidth = root.clientWidth; draw(); } }, 200);
      };
      window.addEventListener('resize', onResize);
      if (!window.MACRO_DATA || Date.now() - loadedAt > RELOAD_MS) {
        draw();
        loadData().then(() => { if (root === container) draw(); });
      } else {
        draw();
      }
    },
    unmount() {
      if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
      clearTimeout(resizeTimer);
      if (detachHover) { detachHover(); detachHover = null; }
      root = null;
    },
  };
})();
