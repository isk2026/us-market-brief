/*
 * 글로벌 증시 view: KOSPI · KOSDAQ · Nikkei · Hang Seng · Shanghai · TAIEX · STOXX 600 · Euro STOXX 50 ·
 * FTSE 100 · DAX · CAC 40 · S&P 500 · Nasdaq · Dow · Nasdaq-100 · SOX · S&P 500 / Nasdaq-100 futures.
 * Data: UMB.state.market.globalIndices (js/marketData.js, built by scripts/fetch-market-data.mjs from
 * Yahoo Finance; KOSPI/KOSDAQ official closes from Bank of Korea ECOS via the morning-briefing skill).
 * Charts reuse UMB.charts (sparkline + hover layer from marketPanel.js).
 */
(function () {
  'use strict';
  const U = window.UMB;
  const { esc, ui } = U;

  const REGIONS = [
    ['asia', '아시아', '🌏'],
    ['europe', '유럽', '🌍'],
    ['americas', '미국', '🌎'],
  ];
  const FLAGS = { KR: '🇰🇷', JP: '🇯🇵', HK: '🇭🇰', CN: '🇨🇳', TW: '🇹🇼', EU: '🇪🇺', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', US: '🇺🇸' };
  // Regular trading hours in exchange-local time (holidays are not modelled; see status()).
  const HOURS = {
    kospi: ['09:00', '15:30'], kosdaq: ['09:00', '15:30'], nikkei: ['09:00', '15:30'], hangseng: ['09:30', '16:00'],
    shanghai: ['09:30', '15:00'], taiex: ['09:00', '13:30'], stoxx600: ['09:00', '17:30'], eurostoxx50: ['09:00', '17:30'],
    ftse: ['08:00', '16:30'], dax: ['09:00', '17:30'], cac: ['09:00', '17:30'], sp500: ['09:30', '16:00'],
    nasdaq: ['09:30', '16:00'], dow: ['09:30', '16:00'], ndx: ['09:30', '16:00'], sox: ['09:30', '16:00'],
  };
  const PERIODS = [['1W', 7], ['1M', 30], ['3M', 91]];

  const view = { region: 'all', table: false };
  let root = null;
  let onClick = null;
  let detachHover = null;

  // ---------- helpers ----------
  const fmtPrice = (v) => (v == null ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pctText = (v) => (v == null || Number.isNaN(v) ? '-' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
  const tone = (v) => (v == null || Number.isNaN(v) || v === 0 ? 'text-slate-500' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
  const arrow = (v) => (v == null || Number.isNaN(v) || v === 0 ? '■' : v > 0 ? '▲' : '▼');
  const shift = (key, days) => { const d = U.parseKey(key); d.setDate(d.getDate() - days); return U.dateKey(d); };

  function localParts(tz, date = new Date()) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date);
    const g = (t) => p.find((x) => x.type === t).value;
    return { key: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}`, weekday: g('weekday') };
  }

  // Exchange schedule status right now (snapshot prices may be older — the card shows their timestamp).
  // CME Globex equity futures (ES, NQ): Sun 18:00 → Fri 17:00 ET with a daily 17:00–18:00 ET halt.
  function futuresStatus() {
    const now = localParts('America/New_York');
    const open = { label: '거래 중 (24h)', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', open: true };
    const closed = (label) => ({ label, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', open: false });
    if (now.weekday === 'Sat') return closed('휴장 (주말)');
    if (now.weekday === 'Sun') return now.hm >= '18:00' ? open : closed('휴장 · 일 18:00 ET 개장');
    if (now.hm >= '17:00' && now.hm < '18:00') return closed('일일 정산 휴장');
    if (now.weekday === 'Fri' && now.hm >= '17:00') return closed('휴장 (주말)');
    return open;
  }

  function status(item) {
    if (item.futures) return futuresStatus();
    const hours = HOURS[item.key];
    if (!hours || !item.tz) return null;
    const now = localParts(item.tz);
    if (now.weekday === 'Sat' || now.weekday === 'Sun') return { label: '휴장 (주말)', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', open: false };
    if (now.hm < hours[0]) return { label: `개장 전 · ${hours[0]}`, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', open: false };
    if (now.hm >= hours[1]) return { label: '마감', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', open: false };
    return { label: '개장 중', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', open: true };
  }

  // Close on or before a date (series ascending).
  function closeAt(series, key) {
    for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= key) return series[i].close;
    return null;
  }
  function returns(item) {
    const s = item.series || [];
    const last = s.length ? s[s.length - 1] : null;
    if (!last) return {};
    const price = item.price ?? last.close;
    const out = {};
    for (const [label, days] of PERIODS) {
      const base = closeAt(s, shift(last.date, days));
      out[label] = base ? ((price - base) / base) * 100 : null;
    }
    const ytdBase = closeAt(s, `${Number(last.date.slice(0, 4)) - 1}-12-31`);
    out.YTD = ytdBase ? ((price - ytdBase) / ytdBase) * 100 : null;
    const year = s.filter((p) => p.date > shift(last.date, 365)).map((p) => p.close);
    out.low52 = year.length ? Math.min(...year, price) : null;
    out.high52 = year.length ? Math.max(...year, price) : null;
    return out;
  }

  const visibleItems = (items) => (view.region === 'all' ? items : items.filter((i) => i.region === view.region));

  // ---------- today's change (diverging bars, sorted; direct labels + arrows so color is never alone) ----------
  function moversChart(items) {
    const rows = items.filter((i) => i.changePct != null).sort((a, b) => b.changePct - a.changePct);
    if (!rows.length) return '';
    const max = Math.max(1, ...rows.map((i) => Math.abs(i.changePct)));
    const bar = (i) => {
      const w = (Math.abs(i.changePct) / max) * 50;
      const up = i.changePct >= 0;
      return `<li class="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-sm sm:grid-cols-[8rem_1fr_4.5rem]"
          data-tip="${esc(`${i.name} ${fmtPrice(i.price)} · ${pctText(i.changePct)} (${i.sessionDate || ''} 현지)`)}">
        <span class="truncate"><span aria-hidden="true">${FLAGS[i.country] || ''}</span> ${esc(i.name)}</span>
        <span class="relative h-5" aria-hidden="true">
          <span class="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-700"></span>
          <span class="absolute inset-y-0.5 ${up ? 'left-1/2 rounded-r bg-emerald-500' : 'right-1/2 rounded-l bg-rose-500'}" style="width:${w}%"></span>
        </span>
        <span class="text-right font-mono text-xs tabular-nums ${tone(i.changePct)}">${arrow(i.changePct)} ${pctText(i.changePct)}</span>
      </li>`;
    };
    const up = rows.filter((i) => i.changePct > 0).length;
    return ui.card(`
      ${ui.sectionTitle('오늘의 등락률', `<span class="text-xs text-slate-500">상승 ${up} · 하락 ${rows.length - up} / ${rows.length}개 지수</span>`)}
      <ul class="space-y-1.5" role="list" aria-label="지수별 전일 대비 등락률, 높은 순">${rows.map(bar).join('')}</ul>`);
  }

  // ---------- index card ----------
  function indexCard(i) {
    const st = status(i);
    const r = returns(i);
    const recent = (i.series || []).slice(-63).map((p) => ({ date: p.date, v: p.close }));
    const pos = r.high52 > r.low52 ? ((i.price - r.low52) / (r.high52 - r.low52)) * 100 : null;
    const local = i.marketTime ? localParts(i.tz || 'UTC', new Date(i.marketTime)) : null;
    const official = i.official ? `<p class="mt-1 text-[11px] text-slate-500" title="${esc(i.official.source || '')}">공식 종가 (${esc(i.official.date)}) <b class="font-mono">${fmtPrice(i.official.close)}</b> · 한국은행 ECOS</p>` : '';
    return `<section class="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-2 flex items-start gap-2">
        <span class="text-2xl leading-none" aria-hidden="true">${FLAGS[i.country] || '🏳'}</span>
        <div class="min-w-0 flex-1">
          <h3 class="truncate font-bold leading-tight">${esc(i.name)}</h3>
          <p class="truncate text-[11px] text-slate-400">${i.futures ? '<span class="mr-1 rounded bg-violet-100 px-1 font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">선물 · 근월물</span>' : ''}${esc(i.nameEn || i.symbol)} · ${esc(i.currency || '')}</p>
        </div>
        ${st ? `<span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}">${st.open ? '<span class="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 align-middle"></span>' : ''}${st.label}</span>` : ''}
      </div>
      <div class="flex flex-wrap items-baseline gap-x-2">
        <p class="font-mono text-2xl font-bold tabular-nums">${fmtPrice(i.price)}</p>
        <p class="font-mono text-sm tabular-nums ${tone(i.changePct)}">${arrow(i.changePct)} ${i.change != null ? fmtPrice(Math.abs(i.change)) : '-'} (${pctText(i.changePct)})</p>
      </div>
      <p class="mb-2 text-[11px] text-slate-400">${local ? `현지 ${esc(local.key.slice(5).replace('-', '/'))} ${esc(local.hm)} 기준` : ''}</p>
      ${official}
      ${recent.length > 1 ? U.charts.sparkline(recent, { label: i.name, fmt: (v) => fmtPrice(v) }) : ''}
      <dl class="mt-3 grid grid-cols-4 gap-1 text-center">
        ${[['1주', r['1W']], ['1개월', r['1M']], ['3개월', r['3M']], ['연초 대비', r.YTD]].map(([l, v]) => `
          <div class="rounded-lg bg-slate-50 px-1 py-1.5 dark:bg-slate-800/60">
            <dt class="text-[10px] text-slate-500">${l}</dt>
            <dd class="font-mono text-xs font-semibold tabular-nums ${tone(v)}">${pctText(v)}</dd>
          </div>`).join('')}
      </dl>
      ${pos == null ? '' : `<div class="mt-3" data-tip="${esc(`52주 최저 ${fmtPrice(r.low52)} · 최고 ${fmtPrice(r.high52)} · 현재 위치 ${pos.toFixed(0)}%`)}">
        <div class="mb-1 flex justify-between text-[10px] text-slate-400"><span>52주 최저 ${fmtPrice(r.low52)}</span><span>최고 ${fmtPrice(r.high52)}</span></div>
        <div class="relative h-1.5 rounded-full bg-slate-200 dark:bg-slate-700" role="img" aria-label="52주 범위 중 ${pos.toFixed(0)}% 위치">
          <span class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2" style="left:${Math.min(100, Math.max(0, pos))}%;background:var(--spark);--tw-ring-color:var(--surface)"></span>
        </div>
      </div>`}
    </section>`;
  }

  function regionSection(items, [key, label, icon]) {
    const list = items.filter((i) => i.region === key);
    if (!list.length) return '';
    const avg = list.filter((i) => i.changePct != null);
    const mean = avg.length ? avg.reduce((t, i) => t + i.changePct, 0) / avg.length : null;
    return `<section class="mb-8">
      <div class="mb-3 flex items-baseline gap-2">
        <h2 class="text-base font-bold"><span aria-hidden="true">${icon}</span> ${label}</h2>
        <span class="text-xs text-slate-500">평균 <b class="font-mono ${tone(mean)}">${pctText(mean)}</b></span>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">${list.map(indexCard).join('')}</div>
    </section>`;
  }

  // Table view (accessible alternative to the charts; same numbers).
  function table(items) {
    const rows = items.map((i) => {
      const r = returns(i);
      const cell = (v) => `<td class="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${tone(v)}">${pctText(v)}</td>`;
      return `<tr>
        <td class="whitespace-nowrap px-3 py-2"><span aria-hidden="true">${FLAGS[i.country] || ''}</span> ${esc(i.name)}</td>
        <td class="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">${fmtPrice(i.price)}</td>
        ${cell(i.changePct)}${cell(r['1W'])}${cell(r['1M'])}${cell(r['3M'])}${cell(r.YTD)}
        <td class="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-slate-500">${fmtPrice(r.low52)} – ${fmtPrice(r.high52)}</td>
      </tr>`;
    }).join('');
    return ui.card(`<div class="-mx-5 overflow-x-auto px-5"><table class="w-full min-w-[760px] text-left text-sm">
      <thead class="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800"><tr>
        <th class="px-3 py-2 font-medium">지수</th><th class="px-3 py-2 text-right font-medium">현재</th><th class="px-3 py-2 text-right font-medium">전일 대비</th>
        <th class="px-3 py-2 text-right font-medium">1주</th><th class="px-3 py-2 text-right font-medium">1개월</th><th class="px-3 py-2 text-right font-medium">3개월</th>
        <th class="px-3 py-2 text-right font-medium">연초 대비</th><th class="px-3 py-2 text-right font-medium">52주 범위</th>
      </tr></thead>
      <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${rows}</tbody></table></div>`);
  }

  // ---------- render ----------
  function draw() {
    if (!root) return;
    if (detachHover) { detachHover(); detachHover = null; }
    U.charts.resetSparklines();
    const g = U.state.market && U.state.market.globalIndices;
    const items = (g && Array.isArray(g.items)) ? g.items : [];
    const chip = (key, label) => `<button data-gl="region" data-value="${key}" aria-pressed="${view.region === key}"
      class="shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${view.region === key
        ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'}">${label}</button>`;
    const head = `
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold">글로벌 증시</h1>
          <p class="mt-0.5 text-xs text-slate-500">${g ? `${ui.staleSnapshot(U.state.market.generatedAt)} 스냅샷 ${esc(new Date(g.asOf || U.state.market.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} KST · Yahoo Finance · 코스피·코스닥 공식 종가는 한국은행 ECOS` : ''}</p>
        </div>
        <button data-gl="table" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">${view.table ? '카드로 보기' : '표로 보기'}</button>
      </div>
      <div class="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        ${chip('all', '전체')}${REGIONS.map(([k, l]) => chip(k, l)).join('')}
      </div>`;
    if (!items.length) {
      root.innerHTML = head + ui.card(ui.empty('글로벌 지수 데이터가 없습니다. node scripts/fetch-market-data.mjs 로 스냅샷을 갱신하세요.'));
      return;
    }
    const vis = visibleItems(items);
    const body = view.table
      ? table(vis)
      : `<div class="mb-8">${moversChart(vis)}</div>${REGIONS.map((r) => regionSection(vis, r)).join('')}`;
    root.innerHTML = `<div id="global-root" class="relative">${head}${body}
      <div data-chart-tip role="tooltip" class="pointer-events-none fixed z-50 hidden max-w-xs rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-white dark:text-slate-900"></div>
      <p class="mt-2 text-xs text-slate-500">개장 상태는 각 거래소 정규장 시간 기준이며 공휴일은 반영하지 않습니다. 가격은 스냅샷 시점 값입니다(매일 07:00 KST 갱신).</p>
    </div>`;
    detachHover = U.charts.attachChartHover(root.querySelector('#global-root'));
  }

  U.views.global = {
    render(container) {
      this.unmount();
      root = container;
      onClick = (e) => {
        const el = e.target.closest('[data-gl]');
        if (!el) return;
        if (el.dataset.gl === 'region') view.region = el.dataset.value;
        else if (el.dataset.gl === 'table') view.table = !view.table;
        draw();
      };
      root.addEventListener('click', onClick);
      draw();
    },
    unmount() {
      if (root && onClick) root.removeEventListener('click', onClick);
      if (detachHover) { detachHover(); detachHover = null; }
      root = onClick = null;
    },
  };
})();
