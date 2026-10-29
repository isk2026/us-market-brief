/* App shell: hash router, header ticker, modal, settings, theme, global actions, auto refresh. */
(function () {
  'use strict';
  const U = window.UMB;
  const { $, $$, esc, state, store, KEYS } = U;

  const ROUTES = ['dashboard', 'global', 'macro', 'sector', 'semi', 'news', 'calendar'];
  const REFRESH_MS = 5 * 60 * 1000;
  const LIVE_MS = 60 * 1000;
  let currentView = null;

  // ---------- modal (accessible dialog) / toast ----------
  // #modal is the backdrop, #modal-body the dialog panel (role="dialog" aria-modal in index.html).
  const modal = $('#modal');
  const panel = $('#modal-body');
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let returnFocus = null;
  let hideTimer = null;
  let open = false;            // logical state; the backdrop stays visible ~150ms longer while fading out
  let pendingRerender = false; // data refreshed while the dialog was open → re-render the view on close

  U.isModalOpen = () => open;

  // opts.focus: selector of the element to focus inside the dialog (defaults to the first focusable).
  U.openModal = (html, opts = {}) => {
    clearTimeout(hideTimer);
    if (!open) returnFocus = document.activeElement;
    open = true;
    panel.innerHTML = html;
    const title = panel.querySelector('h2');
    if (title) {
      if (!title.id) title.id = 'modal-title';
      panel.setAttribute('aria-labelledby', title.id);
    } else {
      panel.removeAttribute('aria-labelledby');
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    void panel.offsetWidth; // commit the hidden state so the enter transition runs
    modal.classList.remove('opacity-0');
    panel.classList.remove('opacity-0', 'scale-95');
    const target = (opts.focus && panel.querySelector(opts.focus)) || panel.querySelector(FOCUSABLE) || panel;
    target.focus({ preventScroll: true });
  };

  U.closeModal = () => {
    if (!open) return;
    open = false;
    modal.classList.add('opacity-0');
    panel.classList.add('opacity-0', 'scale-95');
    document.body.style.overflow = '';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      panel.innerHTML = '';
    }, reducedMotion() ? 0 : 150);
    if (pendingRerender) {
      pendingRerender = false;
      U.rerender();
    }
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  };

  function trapTab(e) {
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) { e.preventDefault(); panel.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

  modal.addEventListener('click', (e) => { if (e.target === modal) U.closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (U.isModalOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); U.closeModal(); return; }
      if (e.key === 'Tab') { trapTab(e); return; }
      // ← / → step through news while a news detail is shown.
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isTyping(e.target)) {
        const btn = panel.querySelector(`[data-nav="${e.key === 'ArrowLeft' ? 'prev' : 'next'}"]:not([disabled])`);
        if (btn) { e.preventDefault(); U.showNews(btn.dataset.id, btn.dataset.nav); }
      }
      return;
    }
    // Enter / Space on non-native "button" cards (role="button") opens the news detail.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-action="news-detail"]')) {
      e.preventDefault();
      U.showNews(e.target.dataset.id);
    }
  });

  let toastTimer;
  U.toast = (msg) => {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('opacity-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('opacity-0'), 2200);
  };

  // ---------- header ----------
  // Oil (futures when available, else lagged spot) and Bitcoin from UMB.state.market, after the indices.
  function marketQuotes() {
    const m = state.market;
    if (!m) return [];
    const out = [];
    const fut = m.oil && m.oil.futures && m.oil.futures.wti;
    const spot = m.oil && m.oil.wti;
    if (fut && fut.price) {
      const prev = fut.series && fut.series.length > 1 ? fut.series[fut.series.length - 2].date : null;
      out.push({ name: 'WTI 원유', symbol: '', price: fut.price, change: fut.changePct, prefix: '$',
        title: `WTI 선물 ${fut.symbol || ''} · ${fut.date || ''}${prev ? ` · ${prev} 종가 대비` : ''}` });
    } else if (spot && spot.length > 1) {
      const a = spot[spot.length - 1], b = spot[spot.length - 2];
      out.push({ name: 'WTI 원유', symbol: '', price: a.close, change: ((a.close - b.close) / b.close) * 100, prefix: '$', title: `WTI 현물 · ${a.date} 기준` });
    }
    const btc = m.crypto && m.crypto.btc;
    if (btc && btc.usd) {
      out.push({ name: '비트코인', symbol: '', price: btc.usd, change: btc.change24hPct, prefix: '$', title: `BTC · 24시간 변동${m.crypto.live ? ' · 실시간' : ''}` });
    }
    return out;
  }

  // US index chips show real index levels from the global-indices snapshot (js/marketData.js).
  // Only when an index is missing there do we fall back to its ETF quote, labelled as an ETF so the
  // two price scales (S&P 500 ≈ 7,700 vs SPY ≈ 670) can't be confused.
  const TICKER_INDICES = [
    { key: 'sp500', name: 'S&P 500', etf: 'SPY' },
    { key: 'nasdaq', name: '나스닥', etf: 'QQQ' },
    { key: 'dow', name: '다우', etf: 'DIA' },
    { key: 'rut', name: '러셀', etf: 'IWM' },
  ];
  function indexQuotes() {
    const items = (state.market && state.market.globalIndices && state.market.globalIndices.items) || [];
    return TICKER_INDICES.map((t) => {
      const i = items.find((x) => x.key === t.key);
      if (i && i.price != null) {
        return { name: t.name, price: i.price, change: i.changePct, title: `${i.nameEn || t.name} 지수 · ${i.sessionDate || ''} 현지 기준` };
      }
      const etf = state.quotes.find((q) => q.symbol === t.etf);
      return etf ? { name: `${t.name} ETF`, price: etf.price, change: etf.change, prefix: '$',
        title: `${t.etf} ETF 가격${state.source === 'live' ? '' : ' · 샘플'}` } : null;
    }).filter(Boolean);
  }

  const priceText = (v) => (v >= 10000
    ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  function renderTicker() {
    const el = $('#ticker');
    const all = [...indexQuotes(), ...marketQuotes()];
    if (!all.length) { el.innerHTML = ''; return; }
    el.innerHTML = all.map((q) => {
      const up = q.change >= 0;
      const cls = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
      const change = q.change == null || Number.isNaN(q.change) ? '' : `<span class="font-mono ${cls}">${up ? '+' : ''}${Number(q.change).toFixed(2)}%</span>`;
      return `<div class="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-800" title="${esc(q.title || (q.symbol ? `${q.name} · ${q.symbol}` : q.name))}">
        <span class="text-slate-500">${esc(q.name)}</span>
        <span class="font-mono font-medium">${esc(q.prefix || '')}${priceText(q.price)}</span>
        ${change}
      </div>`;
    }).join('') + (state.updatedAt
      ? `<span class="ml-auto hidden shrink-0 self-center text-xs text-slate-400 2xl:inline">업데이트 ${new Date(state.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>`
      : '');
  }

  function renderSourceBadge() {
    const el = $('#source-badge');
    el.textContent = state.loading ? '불러오는 중…' : state.source === 'live' ? '● 실시간 (Finnhub)' : '샘플 데이터';
    el.className = 'hidden shrink-0 rounded-full px-2 py-1 text-xs font-medium md:inline ' + (state.source === 'live'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
      : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300');
  }

  function highlightNav(route) {
    $$('#nav .nav-link').forEach((a) => {
      const active = a.dataset.route === route;
      a.classList.toggle('bg-indigo-50', active);
      a.classList.toggle('text-indigo-700', active);
      a.classList.toggle('font-semibold', active);
      a.classList.toggle('dark:bg-indigo-500/15', active);
      a.classList.toggle('dark:text-indigo-300', active);
      a.setAttribute('aria-current', active ? 'page' : 'false');
      // On narrow screens the tab row scrolls; keep the active tab in view (no page scroll).
      if (active) {
        const nav = $('#nav');
        if (nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' });
      }
    });
  }

  // ---------- router ----------
  function currentRoute() {
    const r = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
    return ROUTES.includes(r) ? r : 'dashboard';
  }

  function render() {
    const route = currentRoute();
    if (currentView && currentView.unmount) currentView.unmount();
    currentView = U.views[route];
    highlightNav(route);
    const container = $('#view');
    if (!currentView) { container.innerHTML = U.ui.empty('화면을 불러올 수 없습니다.'); return; }
    if (state.loading && !state.updatedAt) {
      container.innerHTML = '<div class="py-24 text-center text-slate-500">데이터를 불러오는 중…</div>';
      return;
    }
    currentView.render(container);
  }
  U.rerender = () => { renderTicker(); renderSourceBadge(); syncHeaderHeight(); render(); };

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  // A tab left open overnight would keep yesterday's snapshot; reload when the user comes back after a while.
  // Coming back sooner (e.g. unlocking the phone) still pulls fresh live quotes right away.
  const STALE_TAB_MS = 10 * 60 * 1000;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (state.updatedAt && Date.now() - state.updatedAt > STALE_TAB_MS) refresh(false);
    else refreshLive();
  });

  // Re-render without swapping the view out from under an open dialog (see refresh()).
  function rerenderSafely() {
    if (U.isModalOpen()) {
      renderTicker();
      renderSourceBadge();
      pendingRerender = true;
    } else {
      U.rerender();
    }
  }

  // Live quote overlay (js/live.js) on top of the snapshots; re-render only when something changed.
  let liveInflight = null;
  function refreshLive(opts) {
    if (!U.live || inflight || liveInflight) return liveInflight || Promise.resolve(false);
    liveInflight = U.live.refresh(opts)
      .then((applied) => { if (applied) rerenderSafely(); return applied; })
      .finally(() => { liveInflight = null; });
    return liveInflight;
  }
  U.refreshLive = refreshLive;

  // ---------- data ----------
  // One load at a time: a manual ⟳ during an auto refresh joins the in-flight request.
  let inflight = null;
  function refresh(showToast) {
    if (inflight) return inflight;
    inflight = (async () => {
      state.loading = true;
      renderSourceBadge();
      try {
        await U.api.load();
        // The reload replaced the snapshot objects: overlay live quotes (fresh fetch on manual ⟳).
        if (U.live) await U.live.refresh({ force: !!showToast });
      } finally {
        state.loading = false;
      }
      // Don't swap the view out from under an open dialog (news ‹ › ids, focus return); do it on close.
      rerenderSafely();
      if (state.error) U.toast(state.error);
      else if (showToast) U.toast('최신 데이터로 갱신했습니다');
    })().finally(() => { inflight = null; });
    return inflight;
  }

  // ---------- settings ----------
  function openSettings() {
    const fhc = U.finnhub;
    const saved = fhc.getKey();
    // The saved key is never written back into the DOM — only a masked hint.
    const savedHint = saved ? `저장된 키 ••••${saved.slice(-4)} · 비워 두면 그대로 유지` : '비워두면 샘플 데이터 사용';
    const s = fhc.stats();
    const liveInfo = state.source === 'live'
      ? `실시간 연결됨 · 호출 ${s.calls}회 · 캐시 ${s.cacheHits}회 · 전송 방식 ${s.authMode === 'header' ? '헤더' : 'URL 파라미터'}${state.surpriseStats ? ` · 실적 서프라이즈 ${state.surpriseStats.matched}/${state.surpriseStats.checked}건 매칭` : ''}`
      : '';
    U.openModal(`
      <div class="mb-5 flex items-center justify-between">
        <h2 class="text-lg font-bold">설정</h2>
        <button data-action="close-modal" class="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
      </div>
      <form id="settings-form" class="space-y-5">
        <div>
          <label for="fh-key" class="text-sm font-medium">Finnhub API 키</label>
          <div class="mt-1 flex gap-2">
            <input id="fh-key" name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(savedHint)}"
              class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" />
            <button type="button" id="fh-test" class="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">연결 테스트</button>
          </div>
          <p id="fh-status" role="status" class="mt-1 min-h-[1.25rem] text-xs ${liveInfo ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}">${esc(liveInfo)}</p>
          ${saved ? '<button type="button" id="fh-clear" class="text-xs text-rose-600 underline decoration-dotted dark:text-rose-400">저장된 키 삭제</button>' : ''}
          <div class="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 dark:bg-slate-800/60">
            <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" class="text-indigo-600 underline dark:text-indigo-400">finnhub.io</a>에서 무료 키를 발급받을 수 있습니다.
            실시간: 뉴스 · 실적 일정 · 실적 서프라이즈 · 지수 ETF 시세. 경제지표·실적 일정은 키 없이도 Nasdaq 스냅샷(약 15분 주기)으로 표시됩니다.<br>
            🔒 키는 이 브라우저(localStorage)에만 저장되고 Finnhub에만 전송됩니다. 화면·로그·캐시에 남기지 않으며 다른 서버로 보내지 않습니다.
            다만 브라우저 앱 특성상 이 기기에 접근할 수 있는 사람은 키를 볼 수 있으니, <b>공용 PC에서는 저장하지 말고</b> 무료 키만 사용하세요.
          </div>
        </div>
        <label class="block">
          <span class="text-sm font-medium">관심 종목 (쉼표로 구분)</span>
          <input name="watchlist" value="${esc(state.watchlist.join(', '))}" placeholder="AAPL, NVDA, MSFT"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm uppercase dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <div class="flex justify-end gap-2">
          <button type="button" data-action="close-modal" class="rounded-lg px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">취소</button>
          <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">저장</button>
        </div>
      </form>`);
    const statusEl = $('#fh-status');
    const setStatus = (msg, tone) => {
      statusEl.textContent = msg;
      statusEl.className = `mt-1 min-h-[1.25rem] text-xs ${tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
        : tone === 'err' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`;
    };
    $('#fh-test').addEventListener('click', async (e) => {
      const candidate = $('#fh-key').value.trim() || fhc.getKey();
      if (!candidate) { setStatus('테스트할 키를 입력하세요.', 'err'); return; }
      e.currentTarget.disabled = true;
      setStatus('연결 확인 중…');
      try {
        const r = await fhc.verifyKey(candidate);
        setStatus(r.message, r.ok ? 'ok' : 'err');
      } finally {
        e.currentTarget.disabled = false;
      }
    });
    const clearBtn = $('#fh-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        fhc.clearKey();
        fhc.clearCache();
        U.closeModal();
        U.toast('API 키를 삭제했습니다 · 샘플 데이터로 전환');
        refresh(false);
      });
    }
    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newKey = String(fd.get('apiKey') || '').trim();
      // Empty input keeps the saved key; a new key is format-checked before it is stored.
      if (newKey) {
        try {
          fhc.setKey(newKey);
          fhc.clearCache();
        } catch (err) {
          setStatus(err.message || 'API 키 형식이 올바르지 않습니다.', 'err');
          $('#fh-key').focus();
          return;
        }
      }
      state.watchlist = [...new Set(String(fd.get('watchlist') || '')
        .split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
      store.set(KEYS.watchlist, state.watchlist);
      U.closeModal();
      refresh(true);
    });
  }

  // ---------- global actions ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'refresh') refresh(true);
    else if (action === 'settings') openSettings();
    else if (action === 'close-modal') U.closeModal();
    else if (action === 'theme') {
      const dark = document.documentElement.classList.toggle('dark');
      store.set(KEYS.theme, dark ? 'dark' : 'light');
    } else if (action === 'news-detail' && U.showNews) {
      e.preventDefault();
      U.showNews(el.dataset.id, el.dataset.nav);
    }
  });

  // Expose the sticky header height so in-page sticky bars (calendar filter chips) sit right below it.
  const syncHeaderHeight = () =>
    document.documentElement.style.setProperty('--header-h', `${$('header').offsetHeight}px`);
  window.addEventListener('resize', syncHeaderHeight);

  // ---------- boot ----------
  syncHeaderHeight();
  render();
  refresh(false);
  // Snapshots are republished about every 15 min (GitHub Actions), so poll them even without a Finnhub key.
  setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
  // Live quotes (indices, futures, VIX, yields, FX, commodities, stocks) every minute while visible.
  setInterval(() => { if (!document.hidden) refreshLive(); }, LIVE_MS);
  // Bitcoin trades 24/7: refresh it every minute regardless of data source, touching only the ticker
  // and the dashboard's crypto card (no full re-render, so scroll/expanded state is kept).
  setInterval(async () => {
    if (document.hidden || inflight || !(await U.api.refreshCrypto())) return;
    renderTicker();
    U.marketPanel?.updateCrypto?.();
  }, 60 * 1000);
})();
