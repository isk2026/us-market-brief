/* Dashboard view: risk sensor, briefing, market panel, KPIs, top news, next key event countdown, week schedule, pre-market movers, major-company earnings. */
(function () {
  'use strict';
  const { $, esc, ui, state, dateKey, addDays, todayKey, EVENT_TYPES, SESSIONS,
    eventDate, eventTimeLabel, localTimeLabel, timeAgo, formatDateKo, parseKey } = window.UMB;

  let timer = null;

  const kpi = (label, value, sub = '') => `
    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p class="text-xs text-slate-500">${esc(label)}</p>
      <p class="mt-1 text-2xl font-bold">${value}</p>
      ${sub}
    </div>`;

  function nextKeyEvent() {
    const now = Date.now();
    return state.events
      .filter((e) => e.importance === 3 && eventDate(e).getTime() > now)
      .sort((a, b) => eventDate(a) - eventDate(b))[0] || null;
  }

  function countdownText(target) {
    let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    const p = (n) => String(n).padStart(2, '0');
    return `${d > 0 ? `${d}일 ` : ''}${p(h)}:${p(m)}:${p(s)}`;
  }

  function banners() {
    let html = '';
    if (state.source === 'sample') {
      html += `<div class="mb-4 flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
        <span>ℹ</span><span class="flex-1">${window.MARKET_DATA && window.MARKET_DATA.economic
          ? '뉴스는 샘플 데이터 표시 중(경제지표·실적 일정은 Nasdaq 실제 데이터) — ⚙ 설정에서 Finnhub API 키를 입력하면 실시간 뉴스를 불러옵니다.'
          : '샘플 데이터 표시 중 — ⚙ 설정에서 Finnhub API 키를 입력하면 실시간 뉴스·실적 일정을 불러옵니다.'}</span>
        <button data-action="settings" class="shrink-0 font-medium underline">설정 열기</button></div>`;
    }
    if (state.error) {
      html += `<div class="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">⚠ ${esc(state.error)}</div>`;
    }
    return html;
  }

  const TONES = {
    positive: { label: '낙관', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
    negative: { label: '경계', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
    neutral:  { label: '혼조', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300' },
  };

  function briefingCard() {
    const b = state.briefing;
    if (!b) return '';
    const tone = TONES[b.tone] || TONES.neutral;
    const list = (items, marker) => items.map((t) => `
      <li class="flex gap-2"><span class="shrink-0 text-indigo-500 dark:text-indigo-300">${marker}</span><span>${esc(t)}</span></li>`).join('');
    const when = new Date(b.generatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    return `
      <section class="mb-6 overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 shadow-sm dark:border-indigo-500/30 dark:from-indigo-500/10 dark:via-slate-900 dark:to-sky-500/10">
        <div class="flex flex-wrap items-center gap-2 border-b border-indigo-100 px-5 py-3 dark:border-indigo-500/20">
          <span class="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-sm text-white">✦</span>
          <h2 class="font-bold">오늘의 마켓 브리핑</h2>
          <span class="rounded-md bg-indigo-600/10 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300">AI 브리핑${b.mock ? ' · 샘플' : ' · 자동 요약'}</span>
          ${ui.badge(`시장 분위기: ${tone.label}`, tone.cls)}
          <span class="ml-auto text-xs text-slate-500">${esc(when)} 생성</span>
        </div>
        <div class="grid gap-5 p-5 lg:grid-cols-5">
          <div class="lg:col-span-3">
            <p class="mb-2 text-lg font-bold leading-snug">${esc(b.headline)}</p>
            <p class="text-sm leading-relaxed text-slate-600 dark:text-slate-300">${esc(b.overview)}</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
            ${b.keyPoints.length ? `<div><p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">핵심 포인트</p>
              <ul class="space-y-1 text-sm">${list(b.keyPoints, '•')}</ul></div>` : ''}
            ${b.watch.length ? `<div><p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">주목할 일정</p>
              <ul class="space-y-1 text-sm">${list(b.watch, '→')}</ul></div>` : ''}
          </div>
        </div>
      </section>`;
  }

  function kpis() {
    const today = todayKey();
    const weekEnd = dateKey(addDays(new Date(), 6));
    const todayCount = state.events.filter((e) => e.date === today).length;
    const weekKey = state.events.filter((e) => e.importance === 3 && e.date >= today && e.date <= weekEnd).length;
    const recent = state.news.filter((n) => Date.now() - n.datetime < 86400e3);
    const pos = state.news.filter((n) => n.sentiment === 'positive').length;
    const neg = state.news.filter((n) => n.sentiment === 'negative').length;
    const total = pos + neg;
    const posPct = total ? Math.round((pos / total) * 100) : 50;
    const sentBar = `
      <div class="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div class="bg-emerald-500" style="width:${posPct}%"></div><div class="bg-rose-500" style="width:${100 - posPct}%"></div>
      </div>
      <p class="mt-1 text-xs text-slate-500">긍정 ${pos} · 부정 ${neg}</p>`;
    const mood = !total ? '중립' : posPct >= 60 ? '긍정 우세' : posPct <= 40 ? '부정 우세' : '혼조';
    return `<div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      ${kpi('오늘 일정', `${todayCount}<span class="text-sm font-normal text-slate-500">건</span>`)}
      ${kpi('이번 주 핵심(★3) 일정', `${weekKey}<span class="text-sm font-normal text-slate-500">건</span>`)}
      ${kpi('최근 24시간 뉴스', `${recent.length}<span class="text-sm font-normal text-slate-500">건</span>`)}
      ${kpi('뉴스 심리', `<span class="text-lg">${mood}</span>`, sentBar)}
    </div>`;
  }

  function topNews() {
    const items = state.news.slice(0, 6);
    const rows = items.map((n) => `
      <li class="py-2">
        <button data-action="news-detail" data-id="${esc(n.id)}" class="news-card group w-full cursor-pointer rounded-xl px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${n.importance === 'High'
          ? 'border-l-4 border-rose-500 bg-rose-50 dark:bg-rose-500/10'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}">
          <div class="mb-1 flex flex-wrap items-center gap-2">${n.importance === 'High' ? ui.importance('High') : ''} ${ui.categoryBadge(n.category)} ${ui.sentiment(n.sentiment)}
            <span class="ml-auto text-xs text-slate-500">${esc(timeAgo(n.datetime))}</span></div>
          <p class="font-medium leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${esc(n.headline)}</p>
          ${n.summary[0] ? `<p class="mt-1 line-clamp-2 text-sm text-slate-500">${esc(n.summary[0])}</p>` : ''}
        </button>
      </li>`).join('');
    return ui.card(
      ui.sectionTitle('주요 뉴스', '<a href="#/news" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">전체 보기 →</a>') +
      (items.length ? `<ul class="divide-y divide-slate-100 dark:divide-slate-800">${rows}</ul>` : ui.empty('뉴스가 없습니다.')),
      'lg:col-span-2');
  }

  function nextEventCard(ev) {
    const body = ev ? `
      <div class="mb-2 flex items-center gap-2">${ui.typeBadge(ev.type)} ${ui.stars(ev.importance)}</div>
      <p class="font-bold">${esc(ev.title)}</p>
      <p class="mt-1 text-sm font-medium">${esc(localTimeLabel(ev) || formatDateKo(ev.date))} <span class="text-xs text-slate-500">KST</span></p>
      <p class="text-xs text-slate-500">미국 ${esc(formatDateKo(ev.date))} ${esc(eventTimeLabel(ev))}</p>
      <p id="dash-countdown" class="mt-3 font-mono text-3xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">${countdownText(eventDate(ev).getTime())}</p>`
      : ui.empty('예정된 핵심 이벤트가 없습니다.');
    return ui.card(ui.sectionTitle('다음 핵심 이벤트') + body);
  }

  function weekSchedule() {
    // Grouped and labelled in KST, like the calendar tab.
    const { kstTodayKey, kstDateKey, kstTime } = window.UMB;
    const today = kstTodayKey();
    const end = dateKey(addDays(parseKey(today), 6));
    const byDate = {};
    state.events.forEach((e) => {
      const k = kstDateKey(e);
      if (k >= today && k <= end) (byDate[k] ||= []).push(e);
    });
    // With the full major-company earnings calendar a day can hold 40+ events; show the most important
    // few per day (then by time) and send the rest to the calendar tab.
    const PER_DAY = 6;
    // Equal importance: macro releases (Fed, indicators, holidays) before single-company earnings.
    const TYPE_RANK = { fed: 0, economic: 1, holiday: 2, earnings: 3 };
    const groups = Object.keys(byDate).sort().map((d) => {
      const all = byDate[d];
      const shown = [...all].sort((a, b) => b.importance - a.importance
        || (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) || eventDate(a) - eventDate(b)).slice(0, PER_DAY)
        .sort((a, b) => eventDate(a) - eventDate(b));
      const more = all.length - shown.length;
      return `
      <div>
        <p class="mb-1 text-xs font-semibold ${d === today ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}">${esc(formatDateKo(d))}${d === today ? ' · 오늘' : ''}</p>
        <ul class="space-y-1.5">${shown.map((e) => `
          <li class="flex items-center gap-2 text-sm">
            <span class="h-2 w-2 shrink-0 rounded-full ${(EVENT_TYPES[e.type] || EVENT_TYPES.economic).dot}"></span>
            <span class="w-16 shrink-0 text-xs tabular-nums text-slate-500" title="미국 ${esc(eventTimeLabel(e))}">${esc(kstTime(e))}</span>
            <span class="min-w-0 flex-1 truncate">${esc(e.title)}</span>
            <span class="shrink-0 text-xs">${ui.stars(e.importance)}</span>
          </li>`).join('')}</ul>
        ${more > 0 ? `<a href="#/calendar" class="mt-1 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400">+${more}개 더 · 캘린더에서 보기</a>` : ''}
      </div>`;
    }).join('');
    return ui.card(
      ui.sectionTitle('이번 주 일정 <span class="text-xs font-normal text-slate-400">KST</span>', '<a href="#/calendar" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">캘린더 →</a>') +
      (groups ? `<div class="space-y-4">${groups}</div>` : ui.empty('이번 주 일정이 없습니다.')));
  }

  // ---------- 주요 기업 실적 (major-company earnings: upcoming / recently reported) ----------
  // Persists across re-renders.
  const earn = { tab: 'upcoming', cap: 'all', expanded: false };
  const EARN_WINDOW_DAYS = 14;
  const EARN_ROWS = 10;
  const CAP_FILTERS = [['all', '전체'], ['large', '대형주 $200B+'], ['watch', '관심종목']];

  const formatCap = (cap) => (!cap ? '-' : cap >= 1e12 ? `$${(cap / 1e12).toFixed(2)}T` : `$${Math.round(cap / 1e9)}B`);
  // Sample earnings have no market cap; fall back to importance so the large-cap filter still works.
  const isLarge = (e) => (e.marketCap ? e.marketCap >= 200e9 : e.importance >= 3);

  function earningsLists() {
    const { kstDateKey, kstTodayKey, isWatched } = window.UMB;
    const now = Date.now();
    const today = kstTodayKey();
    const from = dateKey(addDays(parseKey(today), -EARN_WINDOW_DAYS));
    const to = dateKey(addDays(parseKey(today), EARN_WINDOW_DAYS));
    const capOk = (e) => (earn.cap === 'watch' ? isWatched(e.ticker) : earn.cap === 'large' ? isLarge(e) : true);
    const byCap = (a, b) => (b.marketCap || 0) - (a.marketCap || 0) || b.importance - a.importance;
    const all = state.events.filter((e) => e.type === 'earnings' && capOk(e))
      .map((e) => ({ e, k: kstDateKey(e), t: eventDate(e).getTime() }))
      .filter((x) => x.k >= from && x.k <= to);
    return {
      upcoming: all.filter((x) => x.t > now).sort((a, b) => a.k.localeCompare(b.k) || byCap(a.e, b.e)).map((x) => x.e),
      reported: all.filter((x) => x.t <= now).sort((a, b) => b.k.localeCompare(a.k) || byCap(a.e, b.e)).map((x) => x.e),
    };
  }

  function surpriseCell(e) {
    // The free Nasdaq calendar has no actuals; never guess — link out instead (Finnhub live mode fills actuals).
    if (!e.actual) {
      return `<span class="text-xs text-slate-500">발표 완료</span>
        <a href="https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(String(e.ticker || '').toLowerCase())}/earnings"
          target="_blank" rel="noopener noreferrer" class="ml-1 text-xs text-indigo-600 underline decoration-dotted dark:text-indigo-400">결과 보기 ↗</a>`;
    }
    return `<span class="inline-flex items-center gap-1.5"><span class="font-mono font-semibold">${esc(e.actual)}</span>${ui.surpriseBadge(e)}</span>`;
  }

  function earningsRow(e, reported) {
    const { isWatched, kstDateKey, kstTime } = window.UMB;
    const watched = isWatched(e.ticker);
    // Nasdaq only gives pre-market / after-hours, so show a clock time only when the source has one.
    const when = `${formatDateKo(kstDateKey(e))}${e.time ? ` ${kstTime(e)}` : ''}`;
    return `<tr class="${watched ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : ''}">
      <td class="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-300" title="미국 ${esc(formatDateKo(e.date))} ${esc(SESSIONS[e.session] || '')}">${esc(when)}</td>
      <td class="px-3 py-2.5">
        <div class="flex items-center gap-2">
          ${ui.ticker(e.ticker || '-')}
          <span class="truncate font-medium">${esc(e.company || e.title)}</span>
          ${watched ? '<span class="text-indigo-600 dark:text-indigo-400" title="관심종목">★</span>' : ''}
        </div>
      </td>
      <td class="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">${esc(formatCap(e.marketCap))}</td>
      <td class="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">${esc(e.forecast ?? '-')}</td>
      <td class="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-slate-500">${esc(e.previous ?? '-')}</td>
      ${reported ? `<td class="whitespace-nowrap px-3 py-2.5">${surpriseCell(e)}</td>` : ''}
      <td class="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">${esc(SESSIONS[e.session] || '시간 미정')}</td>
    </tr>`;
  }

  function earningsCard() {
    const lists = earningsLists();
    const reported = earn.tab === 'reported';
    const items = lists[earn.tab];
    const shown = earn.expanded ? items : items.slice(0, EARN_ROWS);
    const tabBtn = (key, label, n) => `<button data-earn="tab" data-value="${key}" role="tab" aria-selected="${earn.tab === key}"
      class="rounded-md px-3 py-1.5 text-sm font-medium transition ${earn.tab === key
        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}">${label} <span class="text-xs text-slate-400">${n}</span></button>`;
    const capChip = ([key, label]) => `<button data-earn="cap" data-value="${key}" aria-pressed="${earn.cap === key}"
      class="rounded-full px-3 py-1 text-xs font-semibold transition ${earn.cap === key
        ? 'bg-indigo-600 text-white'
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}">${label}</button>`;
    const snap = window.MARKET_DATA && window.MARKET_DATA.earnings;
    const sourceNote = snap && snap.items && snap.items.length
      ? `${ui.staleSnapshot(window.MARKET_DATA.generatedAt)} Nasdaq 실적 캘린더 · 시가총액 $${Math.round((snap.minMarketCap || 50e9) / 1e9)}B 이상 + 관심종목 · 스냅샷 ${esc(snap.asOf || '')}`
      : '샘플 데이터 · node scripts/fetch-market-data.mjs 실행 시 Nasdaq 실제 일정으로 교체';

    const table = `<div class="-mx-5 overflow-x-auto px-5">
      <table class="w-full min-w-[680px] text-left text-sm">
        <thead class="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
          <tr>
            <th class="px-3 py-2 font-medium">발표 (KST)</th><th class="px-3 py-2 font-medium">기업</th>
            <th class="px-3 py-2 text-right font-medium">시가총액</th><th class="px-3 py-2 text-right font-medium">EPS 컨센서스</th>
            <th class="px-3 py-2 text-right font-medium">전년 EPS</th>
            ${reported ? '<th class="px-3 py-2 font-medium">실제 EPS</th>' : ''}
            <th class="px-3 py-2 font-medium">시점</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${shown.map((e) => earningsRow(e, reported)).join('')}</tbody>
      </table></div>`;
    const more = items.length > EARN_ROWS
      ? `<button data-earn="more" class="mt-3 w-full rounded-lg py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">${earn.expanded ? '접기' : `${items.length - EARN_ROWS}개 더 보기`}</button>`
      : '';
    return `<section id="earnings-card" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-bold">주요 기업 실적</h2>
          <p class="mt-0.5 text-xs text-slate-500">${sourceNote}</p>
        </div>
        <div class="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
          ${tabBtn('upcoming', `발표 예정 ${EARN_WINDOW_DAYS}일`, lists.upcoming.length)}${tabBtn('reported', `최근 발표 ${EARN_WINDOW_DAYS}일`, lists.reported.length)}
        </div>
      </div>
      <div class="mb-3 flex flex-wrap gap-2">${CAP_FILTERS.map(capChip).join('')}</div>
      ${items.length ? table + more : ui.empty(earn.cap === 'watch' ? '이 기간에 관심종목 실적 발표가 없습니다.' : '해당 기간에 실적 발표가 없습니다.')}
    </section>`;
  }

  // Only the earnings card re-renders on its own controls (keeps scroll position and the rest of the page).
  let earnRoot = null;
  function onEarnClick(e) {
    const el = e.target.closest('[data-earn]');
    if (!el) return;
    const kind = el.dataset.earn;
    if (kind === 'tab') { earn.tab = el.dataset.value; earn.expanded = false; }
    else if (kind === 'cap') { earn.cap = el.dataset.value; earn.expanded = false; }
    else if (kind === 'more') earn.expanded = !earn.expanded;
    const card = earnRoot && earnRoot.querySelector('#earnings-card');
    if (card) card.outerHTML = earningsCard();
  }

  function render(container) {
    unmount();
    const ev = nextKeyEvent();
    // Optional components: skip gracefully if a script failed to load.
    const risk = window.UMB.riskSensor;
    const pre = window.UMB.premarket;
    container.innerHTML = `
      ${banners()}
      ${risk ? risk.html() : ''}
      ${briefingCard()}
      ${window.UMB.marketPanel.html()}
      ${kpis()}
      <div class="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        ${topNews()}
        <div class="space-y-6">${nextEventCard(ev)}${weekSchedule()}</div>
      </div>
      ${pre ? pre.html() : ''}
      ${earningsCard()}`;
    window.UMB.marketPanel.mount(container);
    if (risk) risk.mount(container);
    if (pre) pre.mount(container);
    earnRoot = container;
    earnRoot.addEventListener('click', onEarnClick);

    if (ev) {
      const target = eventDate(ev).getTime();
      timer = setInterval(() => {
        const el = $('#dash-countdown');
        if (!el) return unmount();
        el.textContent = countdownText(target);
        if (target <= Date.now()) { unmount(); window.UMB.rerender?.(); }
      }, 1000);
    }
  }

  function unmount() {
    window.UMB.marketPanel.unmount();
    if (window.UMB.riskSensor) window.UMB.riskSensor.unmount();
    if (window.UMB.premarket) window.UMB.premarket.unmount();
    if (earnRoot) { earnRoot.removeEventListener('click', onEarnClick); earnRoot = null; }
    if (timer) { clearInterval(timer); timer = null; }
  }

  window.UMB.views.dashboard = { render, unmount };
})();
