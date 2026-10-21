/*
 * Economic indicator & earnings calendar (app style).
 * Filter chips switch between all / indicators / earnings / starred; every event is placed and labelled in KST.
 * Starred event ids persist in localStorage via UMB.toggleFavorite.
 */
(function () {
  'use strict';
  const U = window.UMB;
  const { esc, ui, EVENT_TYPES } = U;

  // "경제지표" also covers Fed events (FOMC decision, chair speeches), which move markets like indicators.
  const FILTERS = {
    all:      { label: '전체 보기',  icon: '🗓', types: null },
    economic: { label: '경제지표만', icon: '📊', types: ['economic', 'fed'] },
    earnings: { label: '실적발표만', icon: '💼', types: ['earnings'] },
    favorites: { label: '즐겨찾기', icon: '★', types: null },
  };

  const today0 = U.parseKey(U.kstTodayKey());
  const cal = {
    filter: 'all',
    mode: 'week',              // 'week' | 'month' | 'list'
    weekStart: mondayOf(today0),
    year: today0.getFullYear(),
    month: today0.getMonth(), // 0-based
    selected: U.kstTodayKey(),
    minImportance: 1,
    expanded: new Set(),       // date keys whose full list is shown on phones
  };
  // Phones: a busy earnings day can hold 40+ cards; show the first few and a "더 보기" toggle (md+ unchanged).
  const MOBILE_MAX = 5;

  let root = null;
  let onClick = null;
  let onChange = null;

  function mondayOf(d) { return U.addDays(d, -((d.getDay() + 6) % 7)); }
  const isFavorite = (ev) => U.state.favorites.has(ev.id);

  // Events annotated with their KST date key, filtered by importance (and optionally by chip filter).
  function scopedEvents(useFilter = true) {
    const types = useFilter ? FILTERS[cal.filter].types : null;
    const favOnly = useFilter && cal.filter === 'favorites';
    return U.state.events
      .filter((ev) => ev.importance >= cal.minImportance && (!types || types.includes(ev.type)) && (!favOnly || isFavorite(ev)))
      .map((ev) => ({ ev, kst: U.kstDateKey(ev) }));
  }

  function groupByKst(items) {
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.kst)) map.set(it.kst, []);
      map.get(it.kst).push(it.ev);
    }
    return map;
  }

  // Visible KST date range for the current mode.
  function range() {
    if (cal.mode === 'week') return [U.dateKey(cal.weekStart), U.dateKey(U.addDays(cal.weekStart, 6))];
    const first = new Date(cal.year, cal.month, 1);
    return [U.dateKey(first), U.dateKey(new Date(cal.year, cal.month + 1, 0))];
  }

  const isReleased = (ev) => (U.hasTime(ev) ? U.eventDate(ev).getTime() <= Date.now() : U.kstDateKey(ev) < U.kstTodayKey());

  // ---------- header & chips ----------
  function header() {
    const [from, to] = range();
    const inRange = scopedEvents(false).filter((x) => x.kst >= from && x.kst <= to);
    const count = (key) => (key === 'favorites'
      ? scopedEvents(false).filter((x) => isFavorite(x.ev)).length
      : inRange.filter((x) => !FILTERS[key].types || FILTERS[key].types.includes(x.ev.type)).length);
    const favMode = cal.filter === 'favorites';

    const chips = Object.entries(FILTERS).map(([key, f]) => {
      const on = cal.filter === key;
      return `<button data-cal-action="filter" data-filter="${key}" role="tab" aria-selected="${on}"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95 ${key === 'favorites' ? 'ml-auto' : ''} ${on
          ? (key === 'favorites' ? 'bg-amber-400 text-amber-950 shadow-md shadow-amber-400/40' : 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30')
          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800'}">
        <span aria-hidden="true" class="${key === 'favorites' && !on ? 'text-amber-400' : ''}">${f.icon}</span>${esc(f.label)}
        <span class="rounded-full px-1.5 text-xs ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}">${count(key)}</span>
      </button>`;
    }).join('');

    const seg = (m, label) => `<button data-cal-action="mode" data-mode="${m}" class="rounded-md px-3 py-1.5 text-sm font-medium transition ${cal.mode === m
      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}">${label}</button>`;
    const navBtn = 'grid h-9 w-9 place-items-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800';
    const isCurrent = cal.mode === 'week'
      ? U.dateKey(cal.weekStart) === U.dateKey(mondayOf(U.parseKey(U.kstTodayKey())))
      : cal.year === today0.getFullYear() && cal.month === today0.getMonth();
    const opt = (v, label) => `<option value="${v}" ${cal.minImportance === v ? 'selected' : ''}>${label}</option>`;

    return `
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold">경제지표 · 실적 캘린더</h1>
          <p class="mt-0.5 text-xs text-slate-500">모든 시간은 <b class="text-slate-700 dark:text-slate-300">한국시간(KST)</b> 기준입니다 · 미국 현지 시각(ET)은 보조 표기</p>
        </div>
        <div class="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800 ${favMode ? 'pointer-events-none opacity-40' : ''}" ${favMode ? 'aria-disabled="true"' : ''}>${seg('week', '주간')}${seg('month', '월간')}${seg('list', '목록')}</div>
      </div>

      <div class="sticky z-20 -mx-4 mb-4 bg-slate-50/95 px-4 py-2 backdrop-blur dark:bg-slate-950/95" style="top: var(--header-h, 0px)">
        <div role="tablist" aria-label="일정 필터" class="no-scrollbar flex gap-2 overflow-x-auto pb-1">${chips}</div>
      </div>

      <div class="mb-4 flex items-center justify-between gap-2">
        ${favMode ? `<p class="text-sm text-slate-500"><b class="text-slate-800 dark:text-slate-200">저장한 일정</b> · 전체 기간 · 다가오는 일정 먼저</p>` : `<div class="flex items-center gap-1">
          <button data-cal-action="prev" class="${navBtn}" aria-label="이전">‹</button>
          <span class="min-w-[9rem] text-center text-base font-bold">${esc(rangeLabel())}</span>
          <button data-cal-action="next" class="${navBtn}" aria-label="다음">›</button>
          ${isCurrent ? '' : `<button data-cal-action="today" class="ml-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">${cal.mode === 'week' ? '이번 주' : '이번 달'}</button>`}
        </div>`}
        <select data-cal-action="importance" class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
          ${opt(1, '중요도 전체')}${opt(2, '★2 이상')}${opt(3, '★3만')}
        </select>
      </div>`;
  }

  function rangeLabel() {
    if (cal.mode !== 'week') return `${cal.year}년 ${cal.month + 1}월`;
    const s = cal.weekStart;
    const e = U.addDays(s, 6);
    return `${s.getMonth() + 1}.${s.getDate()} ~ ${e.getMonth() + 1}.${e.getDate()}`;
  }

  // ---------- event card (shared by all modes) ----------
  function metricCells(ev) {
    const earnings = ev.type === 'earnings';
    const labels = earnings ? ['EPS 전망', '전년 EPS', '실제 EPS'] : ['예상', '이전', '실제'];
    const values = [ev.forecast, ev.previous, ev.actual];
    if (values.every((v) => v == null || v === '')) return '';
    const beat = U.surprise(ev);
    const cells = labels.map((label, i) => {
      const v = values[i];
      const isActual = i === 2;
      const cls = isActual && v != null ? `font-bold ${beat ? beat.text : ''}` : 'font-medium';
      return `<div class="min-w-0">
        <p class="text-[11px] text-slate-500">${label}</p>
        <p class="truncate font-mono text-sm ${cls}">${v == null || v === '' ? (isActual ? '<span class="font-sans text-xs text-slate-400">발표 전</span>' : '-') : esc(v)}</p>
      </div>`;
    }).join('');
    return `<div class="mt-2.5 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">${cells}</div>`;
  }

  function eventCard(ev) {
    const released = isReleased(ev);
    const watched = U.isWatched(ev.ticker);
    const [ampm, clock] = U.hasTime(ev) ? U.kstTime(ev).split(' ') : ['', '종일'];
    const beat = ev.actual ? U.surprise(ev) : null;
    const accent = ev.importance === 3 ? 'border-l-4 border-l-rose-500' : '';
    const sub = esc(ev.detail || '');

    return `
      <li class="flex min-w-0 gap-3 rounded-2xl border bg-white p-3.5 shadow-sm transition dark:bg-slate-900 ${accent} ${watched
        ? 'border-indigo-300 dark:border-indigo-500/50'
        : 'border-slate-200 dark:border-slate-800'} ${released ? 'opacity-75' : ''}">
        <div class="w-14 shrink-0 pt-0.5 text-center">
          <p class="text-[11px] text-slate-500">${esc(ampm)}</p>
          <p class="font-mono text-lg font-bold leading-tight tabular-nums">${esc(clock)}</p>
          <span class="mx-auto mt-1 block h-1.5 w-1.5 rounded-full ${(EVENT_TYPES[ev.type] || EVENT_TYPES.economic).dot}"></span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="mb-1 flex flex-wrap items-center gap-1.5">
            ${ui.typeBadge(ev.type)} ${ui.stars(ev.importance)}
            ${ev.ticker ? ui.ticker(ev.ticker) : ''}
            ${watched ? ui.badge('관심종목', 'bg-indigo-600 text-white') : ''}
            ${released && ev.actual
              ? (ev.type === 'earnings' && ui.surpriseBadge(ev)) || ui.badge(beat ? `발표 · ${beat.label}` : '발표 완료', 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')
              : ''}
          </div>
          <p class="font-semibold leading-snug">${esc(ev.title)}</p>
          ${sub ? `<p class="mt-0.5 truncate text-xs text-slate-500">${sub}</p>` : ''}
          <p class="mt-0.5 text-[11px] text-slate-400">미국 ${esc(U.formatDateKo(ev.date))} ${esc(U.eventTimeLabel(ev))}</p>
          ${metricCells(ev)}
        </div>
        ${favButton(ev)}
      </li>`;
  }

  function favButton(ev) {
    const on = isFavorite(ev);
    return `<button data-cal-action="fav" data-id="${esc(ev.id)}" aria-pressed="${on}"
      aria-label="${on ? '즐겨찾기 해제' : '즐겨찾기에 추가'}" title="${on ? '즐겨찾기 해제' : '즐겨찾기에 추가'}"
      class="-mr-1 -mt-1 grid h-10 w-10 shrink-0 place-items-center self-start rounded-full text-2xl leading-none transition hover:bg-amber-50 active:scale-90 dark:hover:bg-amber-500/10 ${on
        ? 'text-amber-400'
        : 'text-slate-300 hover:text-amber-400 dark:text-slate-600'}">${on ? '★' : '☆'}</button>`;
  }

  function dayHeader(key, n) {
    const today = U.kstTodayKey();
    const d = U.parseKey(key);
    const dow = d.getDay();
    const color = key === today ? 'text-indigo-600 dark:text-indigo-400' : dow === 0 ? 'text-rose-500' : dow === 6 ? 'text-sky-500' : '';
    return `<div class="mb-2 flex items-center gap-2">
      <h3 class="text-sm font-bold ${color}">${esc(U.formatDateKo(key))}</h3>
      ${key === today ? '<span class="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white">오늘</span>' : ''}
      <span class="text-xs text-slate-400">${n}건</span>
      <span class="h-px flex-1 bg-slate-200 dark:bg-slate-800"></span>
    </div>`;
  }

  // Event cards for one day; beyond MOBILE_MAX they are hidden below md unless that day is expanded.
  function cardList(key, evs, ulCls) {
    const open = cal.expanded.has(key);
    const items = evs.map((ev, i) => {
      const html = eventCard(ev);
      return i < MOBILE_MAX || open ? html : html.replace('<li class="', '<li class="max-md:hidden ');
    }).join('');
    const extra = evs.length - MOBILE_MAX;
    const toggle = extra > 0
      ? `<button data-cal-action="expand" data-date="${key}" class="mt-2 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-indigo-600 md:hidden dark:border-slate-800 dark:text-indigo-400">${open ? '접기' : `+${extra}건 더 보기`}</button>`
      : '';
    return `<ul class="${ulCls}">${items}</ul>${toggle}`;
  }

  // One date heading plus its event cards (week / list / favorites views).
  function daySection(key, evs, extraCls = '') {
    return `<section class="${extraCls}">
      ${dayHeader(key, evs.length)}
      ${evs.length
        ? cardList(key, evs, 'grid grid-cols-1 gap-2.5 md:grid-cols-2')
        : '<p class="rounded-xl border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400 dark:border-slate-800">예정된 일정이 없습니다</p>'}
    </section>`;
  }

  // ---------- modes ----------
  function weekView(byKst) {
    const today = U.kstTodayKey();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const key = U.dateKey(U.addDays(cal.weekStart, i));
      const evs = byKst.get(key) || [];
      const dow = U.parseKey(key).getDay();
      if (!evs.length && (dow === 0 || dow === 6)) continue; // hide empty weekends
      days.push(daySection(key, evs, key < today ? 'opacity-90' : ''));
    }
    return `<div class="space-y-6">${days.join('')}</div>`;
  }

  function monthGrid(byKst) {
    const first = new Date(cal.year, cal.month, 1);
    const start = U.addDays(first, -first.getDay());
    const today = U.kstTodayKey();
    const head = U.WEEKDAYS.map((w, i) =>
      `<div class="py-2 text-center text-xs font-medium ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-500' : 'text-slate-500'}">${w}</div>`).join('');

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = U.addDays(start, i);
      const key = U.dateKey(d);
      const evs = byKst.get(key) || [];
      const dow = d.getDay();
      const cellCls = [
        'flex min-h-[3.5rem] flex-col gap-1 border-t border-slate-100 p-1 text-left transition sm:min-h-[6.5rem] dark:border-slate-800',
        d.getMonth() === cal.month ? '' : 'opacity-40',
        evs.some((e) => e.type === 'holiday') ? 'bg-rose-50/70 dark:bg-rose-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
        key === cal.selected ? 'bg-indigo-50 ring-2 ring-inset ring-indigo-500 dark:bg-indigo-500/10' : '',
      ].join(' ');
      const num = key === today
        ? `<span class="grid h-6 w-6 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">${d.getDate()}</span>`
        : `<span class="grid h-6 w-6 place-items-center text-xs font-medium ${dow === 0 ? 'text-rose-500' : dow === 6 ? 'text-sky-500' : ''}">${d.getDate()}</span>`;
      const chips = evs.slice(0, 3).map((ev) => {
        const t = U.kstShortTime(ev);
        const label = ev.type === 'earnings' && ev.ticker ? ev.ticker : ev.title;
        return `<span class="block truncate rounded px-1 py-0.5 text-[11px] leading-tight ${(EVENT_TYPES[ev.type] || EVENT_TYPES.economic).chip}" title="${esc(ev.title)}">${isFavorite(ev) ? '<span class="text-amber-500">★</span>' : ''}${t ? `<span class="opacity-70">${t}</span> ` : ''}${esc(label)}</span>`;
      }).join('');
      const more = evs.length > 3 ? `<span class="px-1 text-[11px] text-slate-500">+${evs.length - 3}</span>` : '';
      const dots = evs.slice(0, 4).map((ev) => `<span class="h-1.5 w-1.5 rounded-full ${(EVENT_TYPES[ev.type] || EVENT_TYPES.economic).dot}"></span>`).join('');
      cells += `<button data-cal-action="select" data-date="${key}" class="${cellCls}" aria-label="${esc(U.formatDateKo(key))} 일정 ${evs.length}건">
        ${num}
        <span class="hidden w-full flex-col gap-0.5 sm:flex">${chips}${more}</span>
        <span class="flex flex-wrap gap-0.5 px-1 sm:hidden">${dots}</span>
      </button>`;
    }

    const evs = byKst.get(cal.selected) || [];
    const panel = ui.card(
      dayHeader(cal.selected, evs.length) +
      (evs.length ? cardList(cal.selected, evs, 'space-y-2.5') : ui.empty('선택한 날짜에 일정이 없습니다.')),
      'min-w-0 lg:max-h-[48rem] lg:overflow-y-auto');
    // grid-cols-1 (minmax(0,1fr)) so long card text can't widen the track past the phone width.
    return `<div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
      ${ui.card(`<div class="grid grid-cols-7">${head}${cells}</div>`, 'p-2 sm:p-3 lg:col-span-2')}
      ${panel}
    </div>`;
  }

  function listView(byKst) {
    const [from, to] = range();
    const keys = [...byKst.keys()].filter((k) => k >= from && k <= to).sort();
    if (!keys.length) return ui.empty('이번 달에 조건에 맞는 일정이 없습니다.');
    return `<div class="space-y-6">${keys.map((k) => daySection(k, byKst.get(k))).join('')}</div>`;
  }

  function favoritesView(items) {
    if (!items.length) {
      return `<div class="rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
        <p class="text-4xl text-amber-400">☆</p>
        <p class="mt-3 font-semibold">저장한 일정이 없습니다</p>
        <p class="mt-1 text-sm text-slate-500">일정 카드 오른쪽의 ☆ 버튼을 누르면 여기에 모아 볼 수 있어요.</p>
      </div>`;
    }
    const today = U.kstTodayKey();
    const section = (title, list, desc) => {
      if (!list.length) return '';
      const byKst = groupByKst(list);
      const keys = [...byKst.keys()].sort();
      if (desc) keys.reverse();
      return `<div class="space-y-6"><h2 class="text-xs font-bold uppercase tracking-wide text-slate-500">${title}</h2>${keys.map((k) => daySection(k, byKst.get(k))).join('')}</div>`;
    };
    const upcoming = items.filter((x) => x.kst >= today);
    const past = items.filter((x) => x.kst < today);
    return `<div class="space-y-10">${section(`다가오는 일정 ${upcoming.length}`, upcoming, false)}${section(`지난 일정 ${past.length}`, past, true)}</div>`;
  }

  function draw() {
    if (!root) return;
    const items = scopedEvents();
    const byKst = groupByKst(items);
    const body = cal.filter === 'favorites' ? favoritesView(items)
      : cal.mode === 'week' ? weekView(byKst) : cal.mode === 'month' ? monthGrid(byKst) : listView(byKst);
    root.innerHTML = header() + body;
  }

  // ---------- navigation ----------
  // The month a week "belongs" to is the month of its Thursday (ISO-8601 convention).
  function syncMonthToWeek() {
    const thu = U.addDays(cal.weekStart, 3);
    cal.year = thu.getFullYear();
    cal.month = thu.getMonth();
  }

  function shift(delta) {
    if (cal.mode === 'week') {
      cal.weekStart = U.addDays(cal.weekStart, 7 * delta);
      syncMonthToWeek();
    } else {
      const d = new Date(cal.year, cal.month + delta, 1);
      cal.year = d.getFullYear();
      cal.month = d.getMonth();
    }
  }

  function goToday() {
    const t = U.parseKey(U.kstTodayKey());
    cal.weekStart = mondayOf(t);
    cal.year = t.getFullYear();
    cal.month = t.getMonth();
    cal.selected = U.kstTodayKey();
  }

  function detach() {
    if (root && onClick) root.removeEventListener('click', onClick);
    if (root && onChange) root.removeEventListener('change', onChange);
    onClick = onChange = null;
  }

  U.views.calendar = {
    render(container) {
      detach();
      root = container;
      onClick = (e) => {
        const el = e.target.closest('[data-cal-action]');
        if (!el || !root.contains(el) || el.tagName === 'SELECT') return;
        switch (el.dataset.calAction) {
          case 'filter': cal.filter = el.dataset.filter; break;
          case 'expand': {
            const k = el.dataset.date;
            if (cal.expanded.has(k)) cal.expanded.delete(k); else cal.expanded.add(k);
            break;
          }
          case 'fav': {
            const on = U.toggleFavorite(el.dataset.id);
            U.toast(on ? '★ 즐겨찾기에 저장했습니다' : '즐겨찾기에서 해제했습니다');
            break;
          }
          case 'prev': shift(-1); break;
          case 'next': shift(1); break;
          case 'today': goToday(); break;
          case 'mode': {
            const next = el.dataset.mode;
            if (next === 'week' && cal.mode !== 'week') {
              // Return to the last viewed week if it still belongs to the viewed month; otherwise show the
              // selected day's week when it is in that month, else the month's first week.
              const thu = U.addDays(cal.weekStart, 3);
              const sel = U.parseKey(cal.selected);
              const inView = (d) => d.getFullYear() === cal.year && d.getMonth() === cal.month;
              if (!inView(thu)) cal.weekStart = mondayOf(inView(sel) ? sel : new Date(cal.year, cal.month, 1));
            } else if (next !== 'week' && cal.mode === 'week') {
              syncMonthToWeek();
            }
            cal.mode = next;
            break;
          }
          case 'select': {
            cal.selected = el.dataset.date;
            const d = U.parseKey(cal.selected);
            cal.year = d.getFullYear();
            cal.month = d.getMonth();
            break;
          }
          default: return;
        }
        draw();
        // Re-rendering replaces the buttons; keep keyboard focus on the star that was pressed.
        if (el.dataset.calAction === 'fav') {
          const again = root.querySelector(`[data-cal-action="fav"][data-id="${CSS.escape(el.dataset.id)}"]`);
          if (again) again.focus({ preventScroll: true });
        }
      };
      onChange = (e) => {
        if (e.target.dataset.calAction !== 'importance') return;
        cal.minImportance = Number(e.target.value) || 1;
        draw();
      };
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      draw();
    },
    unmount() {
      detach();
      root = null;
    },
  };
})();
