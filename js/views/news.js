/* News & indicator summary view + news detail modal. */
(function () {
  'use strict';
  const { $, esc, ui, state, CATEGORIES, SENTIMENTS, IMPORTANCE, timeAgo, todayKey, dateKey, addDays,
    formatDateKo, eventTimeLabel, localTimeLabel, surprise, isWatched: inWatchlist } = window.UMB;

  // Persists across route changes.
  const filter = { category: 'all', q: '', sentiment: 'all', importance: 'all', sort: 'latest', watchOnly: false };

  function filtered() {
    const q = filter.q.trim().toLowerCase();
    const items = state.news.filter((n) => {
      if (filter.importance !== 'all' && n.importance !== filter.importance) return false;
      if (filter.category !== 'all' && n.category !== filter.category) return false;
      if (filter.sentiment !== 'all' && n.sentiment !== filter.sentiment) return false;
      if (filter.watchOnly && !n.tickers.some(inWatchlist)) return false;
      if (q) {
        const hay = [n.headline, ...n.summary, ...n.tickers].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const rank = (n) => (IMPORTANCE[n.importance] || IMPORTANCE.Medium).rank;
    return filter.sort === 'importance'
      ? items.sort((a, b) => rank(b) - rank(a) || b.datetime - a.datetime)
      : items;
  }

  const tickerChip = (t) => inWatchlist(t)
    ? `<span class="rounded bg-indigo-600 px-1.5 py-0.5 font-mono text-xs text-white" title="관심종목">${esc(t)}</span>`
    : ui.ticker(t);

  // Whole card is the click/keyboard target; app.js delegates [data-action="news-detail"] to UMB.showNews.
  function newsCard(n) {
    return `
      <article role="button" tabindex="0" data-action="news-detail" data-id="${esc(n.id)}" aria-label="${esc(n.headline)} 상세 보기"
        class="news-card group flex cursor-pointer flex-col rounded-2xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 ${ui.importanceCard(n.importance)} ${n.importance === 'Low' ? 'opacity-90' : ''}">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          ${ui.importance(n.importance)}
          ${ui.categoryBadge(n.category)}
          ${ui.sentiment(n.sentiment)}
          <span class="ml-auto text-xs text-slate-500">${esc(timeAgo(n.datetime))}</span>
        </div>
        <h3 class="mb-1 font-bold leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400">${esc(n.headline)}</h3>
        <p class="mb-3 text-xs text-slate-500">${esc(n.source)}</p>
        <ul class="mb-3 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          ${n.summary.map((s) => `<li>${esc(s)}</li>`).join('')}
        </ul>
        ${n.tickers.length ? `<div class="mt-auto flex flex-wrap gap-1">${n.tickers.map(tickerChip).join('')}</div>` : ''}
      </article>`;
  }

  // Ids in the order last rendered on the news page; the detail modal's ‹ › follow this order.
  let listOrder = [];

  function renderList(root) {
    const items = filtered();
    listOrder = items.map((n) => String(n.id));
    $('#news-count', root).textContent = `${items.length}건`;
    $('#news-list', root).innerHTML = items.length
      ? `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${items.map(newsCard).join('')}</div>`
      : ui.empty('조건에 맞는 뉴스가 없습니다.');
  }

  function chips() {
    const all = [['all', '전체'], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])];
    return all.map(([k, label]) => {
      const active = filter.category === k;
      return `<button data-cat="${k}" class="whitespace-nowrap rounded-full border px-3 py-1 text-sm ${active
        ? 'border-indigo-600 bg-indigo-600 text-white'
        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}">${esc(label)}</button>`;
    }).join('');
  }

  const surpriseBadge = (ev) => { const s = surprise(ev); return s ? ui.badge(s.label, s.badge) : ''; };

  const valueCell = (label, v, strong) => `<div><p class="text-[11px] text-slate-500">${label}</p>
    <p class="font-mono text-sm ${strong ? 'font-bold' : ''}">${esc(v ?? '-')}</p></div>`;

  function indicatorRow(ev, released) {
    return `<li class="rounded-xl border p-3 ${ev.importance === 3
      ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10'
      : 'border-slate-200 dark:border-slate-800'}">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold">${esc(ev.title)}</span>
        ${released ? surpriseBadge(ev) : ''}
        <span class="ml-auto text-right text-xs text-slate-500" title="미국 ${esc(formatDateKo(ev.date))} ${esc(eventTimeLabel(ev))}">${esc(localTimeLabel(ev) || formatDateKo(ev.date))} KST</span>
      </div>
      <div class="grid grid-cols-3 gap-2">
        ${released ? valueCell('실제', ev.actual, true) : '<div><p class="text-[11px] text-slate-500">실제</p><p class="text-sm text-slate-400">발표 전</p></div>'}${valueCell('예상', ev.forecast)}${valueCell('이전', ev.previous)}
      </div>
    </li>`;
  }

  function indicatorSummary() {
    const today = todayKey();
    const since = dateKey(addDays(new Date(), -14));
    const until = dateKey(addDays(new Date(), 7));
    const econ = state.events.filter((e) => e.type === 'economic' || (e.type === 'fed' && e.forecast));
    const released = econ.filter((e) => e.actual && e.date >= since && e.date <= today).reverse().slice(0, 4);
    const upcoming = econ.filter((e) => !e.actual && e.date >= today && e.date <= until).slice(0, 4);
    const block = (title, items, isReleased, emptyMsg) => ui.card(
      ui.sectionTitle(title) + (items.length
        ? `<ul class="space-y-2">${items.map((e) => indicatorRow(e, isReleased)).join('')}</ul>`
        : ui.empty(emptyMsg)));
    return `<div class="mb-8 grid gap-4 lg:grid-cols-2">
      ${block('최근 발표된 경제지표', released, true, '최근 2주간 발표된 지표가 없습니다.')}
      ${block('발표 예정 지표 (7일)', upcoming, false, '7일 내 예정된 지표가 없습니다.')}
    </div>`;
  }

  function render(container) {
    const sentOpts = [['all', '심리: 전체'], ...Object.entries(SENTIMENTS).map(([k, v]) => [k, `심리: ${v.label}`])]
      .map(([k, l]) => `<option value="${k}" ${filter.sentiment === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const impOpts = [['all', '중요도: 전체'], ['High', '중요도: High'], ['Medium', '중요도: Medium'], ['Low', '중요도: Low']]
      .map(([k, l]) => `<option value="${k}" ${filter.importance === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const sortOpts = [['latest', '최신순'], ['importance', '중요도순']]
      .map(([k, l]) => `<option value="${k}" ${filter.sort === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const highCount = state.news.filter((n) => n.importance === 'High').length;
    const selectCls = 'flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900';

    container.innerHTML = `
      <div id="news-root">
        <h1 class="mb-4 text-xl font-bold">뉴스 및 지표 요약</h1>
        ${indicatorSummary()}
        <div class="mb-4 flex items-end justify-between gap-2">
          <h2 class="text-base font-bold">뉴스 요약 ${highCount ? `<span class="ml-1 text-sm font-medium text-rose-600 dark:text-rose-400">· 중요 ${highCount}건</span>` : ''}</h2>
          <span id="news-count" class="text-sm text-slate-500"></span>
        </div>
        <div class="mb-5 space-y-3">
          <div id="news-chips" class="no-scrollbar flex gap-2 overflow-x-auto">${chips()}</div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input id="news-q" type="search" value="${esc(filter.q)}" placeholder="헤드라인, 요약, 티커 검색"
              class="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900" />
            <div class="flex flex-wrap gap-2">
              <select id="news-imp" class="${selectCls}">${impOpts}</select>
              <select id="news-sort" class="${selectCls}">${sortOpts}</select>
              <select id="news-sent" class="${selectCls}">${sentOpts}</select>
              <label class="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <input id="news-watch" type="checkbox" class="accent-indigo-600" ${filter.watchOnly ? 'checked' : ''} /> 관심종목만
              </label>
            </div>
          </div>
        </div>
        <div id="news-list"></div>
      </div>`;

    const root = $('#news-root', container);
    root.addEventListener('input', (e) => {
      if (e.target.id === 'news-q') { filter.q = e.target.value; renderList(root); }
    });
    root.addEventListener('change', (e) => {
      if (e.target.id === 'news-sent') filter.sentiment = e.target.value;
      else if (e.target.id === 'news-imp') filter.importance = e.target.value;
      else if (e.target.id === 'news-sort') filter.sort = e.target.value;
      else if (e.target.id === 'news-watch') filter.watchOnly = e.target.checked;
      else return;
      renderList(root);
    });
    root.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-cat]');
      if (!chip) return;
      filter.category = chip.dataset.cat;
      $('#news-chips', root).innerHTML = chips();
      renderList(root);
    });
    renderList(root);
  }

  // ---------- news detail modal ----------
  // Navigation order: the filtered list when opened from the news page, otherwise the full feed.
  function navOrder() {
    const onNewsPage = /^#\/?news\b/.test(location.hash);
    const ids = onNewsPage && listOrder.length ? listOrder : state.news.map((n) => String(n.id));
    return ids.filter((id) => state.news.some((n) => String(n.id) === id));
  }

  function relatedEvents(n) {
    if (!n.tickers.length) return [];
    const tickers = new Set(n.tickers.map((t) => String(t).toUpperCase()));
    const now = Date.now();
    return state.events
      .filter((ev) => ev.ticker && tickers.has(ev.ticker.toUpperCase()) && window.UMB.eventDate(ev).getTime() > now)
      .slice(0, 3);
  }

  const navBtn = (dir, targetId) => {
    const label = dir === 'prev' ? '‹ 이전' : '다음 ›';
    return targetId
      ? `<button data-action="news-detail" data-id="${esc(targetId)}" data-nav="${dir}" aria-label="${dir === 'prev' ? '이전 뉴스' : '다음 뉴스'}"
          class="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">${label}</button>`
      : `<button disabled data-nav="${dir}" class="cursor-not-allowed rounded-lg px-3 py-2 text-sm text-slate-300 dark:text-slate-600">${label}</button>`;
  };

  // focusNav: 'prev' | 'next' keeps keyboard focus on the nav button the user just used.
  window.UMB.showNews = function (id, focusNav) {
    const n = state.news.find((x) => String(x.id) === String(id));
    if (!n) {
      // The item was dropped by a data refresh while the dialog was open.
      window.UMB.closeModal();
      window.UMB.toast('뉴스가 갱신되어 해당 기사를 찾을 수 없습니다');
      return;
    }
    const order = navOrder();
    const idx = order.indexOf(String(n.id));
    const prevId = idx > 0 ? order[idx - 1] : null;
    const nextId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    const when = new Date(n.datetime).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
    });
    const link = /^https?:\/\//i.test(n.url || '')
      ? `<a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">원문 보기 ↗</a>`
      : '';
    const related = relatedEvents(n);
    const relatedHtml = related.length ? `
      <h3 class="mb-2 text-sm font-semibold">관련 일정</h3>
      <ul class="mb-4 space-y-2">${related.map((ev) => `
        <li class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
          ${ui.typeBadge(ev.type)}
          <span class="min-w-0 flex-1 font-medium">${esc(ev.title)}</span>
          <span class="text-xs text-slate-500">${esc(localTimeLabel(ev) || formatDateKo(ev.date))} KST</span>
        </li>`).join('')}
      </ul>` : '';

    window.UMB.openModal(`
      <div data-news-id="${esc(n.id)}" class="mb-3 flex flex-wrap items-center gap-2">
        ${ui.importance(n.importance)} ${ui.categoryBadge(n.category)} ${ui.sentiment(n.sentiment)}
        ${idx >= 0 ? `<span class="text-xs text-slate-400">${idx + 1} / ${order.length}</span>` : ''}
        <button data-action="close-modal" class="ml-auto rounded-lg p-1 text-xl leading-none text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="닫기" title="닫기 (Esc)">×</button>
      </div>
      <h2 id="news-modal-title" class="mb-2 text-lg font-bold leading-snug">${esc(n.headline)}</h2>
      <p class="mb-4 text-xs text-slate-500">${esc(n.source)} · ${esc(when)} KST · ${esc(timeAgo(n.datetime))}</p>
      <h3 class="mb-2 text-sm font-semibold">핵심 요약</h3>
      <ul class="mb-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        ${n.summary.map((s) => `<li>${esc(s)}</li>`).join('')}
      </ul>
      ${n.tickers.length ? `<h3 class="mb-2 text-sm font-semibold">관련 종목</h3><div class="mb-4 flex flex-wrap gap-1">${n.tickers.map(tickerChip).join('')}</div>` : ''}
      ${relatedHtml}
      <div class="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        ${navBtn('prev', prevId)}${navBtn('next', nextId)}
        <span class="hidden text-[11px] text-slate-400 sm:inline">← → 키로 이동</span>
        <div class="ml-auto flex gap-2">
          ${link}
          <button data-action="close-modal" class="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">닫기</button>
        </div>
      </div>`, { focus: focusNav ? `[data-nav="${focusNav}"]:not([disabled])` : null });
  };

  window.UMB.views.news = { render };
})();
