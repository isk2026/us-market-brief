/*
 * Data loading. Without an API key the app runs on sample data; with a Finnhub key it pulls
 * live news, the earnings calendar (+ earnings surprises for reported companies) and ETF quotes
 * through the rate-limited, cached client in js/finnhub.js. Economic/Fed/holiday events always
 * come from the sample generator because Finnhub's economic calendar is a premium endpoint.
 */
(function () {
  'use strict';
  const { state, dateKey, addDays, eventDate, earningsId } = window.UMB;
  // All Finnhub traffic goes through UMB.finnhub (key handling, rate limit, cache, error mapping).
  const fh = (path, params, opts) => window.UMB.finnhub.get(path, params, opts);
  const TTL = { news: 5 * 60e3, calendar: 30 * 60e3, quote: 60e3, surprise: 12 * 3600e3 };
  const SURPRISE_LOOKUPS = 20; // reported companies checked per load (free tier: 60 calls/min)
  const QUOTE_SYMBOLS = [
    { symbol: 'SPY', name: 'S&P 500' },
    { symbol: 'QQQ', name: '나스닥 100' },
    { symbol: 'DIA', name: '다우존스' },
    { symbol: 'IWM', name: '러셀 2000' },
  ];
  const MAJOR = new Set(['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'BRK.B',
    'JPM', 'V', 'MA', 'LLY', 'UNH', 'XOM', 'WMT', 'NFLX', 'COST', 'ORCL']);

  const CATEGORY_RULES = [
    ['fed', /\b(fed|fomc|powell|federal reserve|rate cuts?|rate hikes?|interest rates?|treasury yields?|yields?)\b/i],
    ['earnings', /\b(earnings|quarterly|revenue|guidance|eps|profit|results|beats?|misses?)\b/i],
    ['tech', /\b(ai|chips?|semiconductors?|nvidia|apple|microsoft|google|alphabet|meta|tesla|software|cloud|tech)\b/i],
    ['energy', /\b(oil|crude|opec|natural gas|gold|copper|commodit(y|ies)|energy)\b/i],
    ['macro', /\b(inflation|cpi|pce|gdp|jobs|payrolls?|unemployment|tariffs?|economy|recession|consumer|retail sales)\b/i],
  ];
  const POSITIVE = /\b(surges?|soars?|rall(y|ies)|beats?|records?|gains?|rises?|jumps?|upgrades?|climbs?|boosts?|strong|tops?|optimism)\b/gi;
  const NEGATIVE = /\b(falls?|drops?|plunges?|slumps?|miss(es)?|loss(es)?|declines?|downgrades?|fears?|slides?|tumbles?|sinks?|weak|cuts? jobs|layoffs?|warns?|concerns?)\b/gi;

  const HIGH_IMPACT = /\b(fed|fomc|powell|cpi|inflation|jobs report|payrolls?|recession|tariffs?|record high|plunges?|soars?|crash|sell-?off)\b/i;

  function classify(text) {
    for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
    return 'market';
  }
  function sentimentOf(text) {
    const pos = (text.match(POSITIVE) || []).length;
    const neg = (text.match(NEGATIVE) || []).length;
    return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
  }

  // Heuristic until an AI ranking API exists: market-moving keywords or megacap tickers → High.
  function importanceOf(headline, category, tickers) {
    if (HIGH_IMPACT.test(headline) || tickers.some((t) => MAJOR.has(t))) return 'High';
    if (category !== 'market' || tickers.length) return 'Medium';
    return 'Low';
  }

  function normalizeNews(n) {
    const text = `${n.headline || ''} ${n.summary || ''}`;
    const sentences = String(n.summary || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    const category = classify(text);
    const tickers = String(n.related || '').split(',').map((t) => t.trim()).filter(Boolean);
    return {
      id: `fn-${n.id}`,
      datetime: n.datetime * 1000,
      headline: n.headline || '',
      summary: sentences.length ? sentences : [n.headline || ''],
      source: n.source || 'Finnhub',
      url: /^https?:\/\//i.test(n.url || '') ? n.url : '#', // never pass javascript:/data: links through
      importance: importanceOf(n.headline || '', category, tickers),
      category,
      sentiment: sentimentOf(text),
      tickers,
    };
  }

  function normalizeEarnings(rows) {
    const watch = new Set(state.watchlist);
    const sorted = [...rows].sort((a, b) => (b.revenueEstimate || 0) - (a.revenueEstimate || 0));
    const kept = sorted.filter((r, i) => i < 150 || watch.has(r.symbol));
    return kept.map((r) => {
      const session = r.hour === 'bmo' || r.hour === 'amc' ? r.hour : null;
      const importance = MAJOR.has(r.symbol) || watch.has(r.symbol) ? 3 : (r.revenueEstimate || 0) > 5e9 ? 2 : 1;
      const quarter = r.quarter && r.year ? ` ${r.year} Q${r.quarter}` : '';
      return {
        id: earningsId(r.symbol, r.date), // same id as sample mode so favorites survive switching sources
        date: r.date,
        time: null,
        session,
        type: 'earnings',
        importance,
        ticker: r.symbol,
        title: `${r.symbol} 실적`,
        detail: `${r.symbol}${quarter} 분기 실적 발표${session ? ` (${session === 'bmo' ? '장 시작 전' : '장 마감 후'})` : ''}.`,
        forecast: r.epsEstimate != null ? `$${Number(r.epsEstimate).toFixed(2)}` : undefined,
        actual: r.epsActual != null ? `$${Number(r.epsActual).toFixed(2)}` : undefined,
        dataSource: 'finnhub',
      };
    });
  }

  // Rule-based briefing from live data. Swap this for an AI summarization call later;
  // it only needs to return the Briefing shape documented in core.js.
  function buildBriefing() {
    const { CATEGORIES, formatDateKo } = window.UMB;
    const spy = state.quotes.find((q) => q.symbol === 'SPY');
    const qqq = state.quotes.find((q) => q.symbol === 'QQQ');
    const pos = state.news.filter((n) => n.sentiment === 'positive').length;
    const neg = state.news.filter((n) => n.sentiment === 'negative').length;
    const tone = pos > neg * 1.3 ? 'positive' : neg > pos * 1.3 ? 'negative' : 'neutral';
    const move = (q) => (q ? `${q.name} ${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : null);
    const counts = {};
    state.news.forEach((n) => { counts[n.category] = (counts[n.category] || 0) + 1; });
    const topCat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const high = state.news.filter((n) => n.importance === 'High');
    const now = Date.now();
    const upcoming = state.events.filter((e) => e.importance === 3 && eventDate(e).getTime() > now).slice(0, 3);
    const toneLabel = { positive: '낙관적', negative: '경계감이 큰', neutral: '혼조' }[tone];
    return {
      generatedAt: new Date().toISOString(),
      tone,
      headline: high[0] ? high[0].headline : '주요 뉴스 흐름 요약',
      overview: [
        [move(spy), move(qqq)].filter(Boolean).join(', ') + (spy || qqq ? '. ' : ''),
        `최근 뉴스 ${state.news.length}건 중 긍정 ${pos}건·부정 ${neg}건으로 시장 분위기는 ${toneLabel} 편입니다.`,
        topCat ? ` 가장 많이 다뤄진 주제는 '${(CATEGORIES[topCat[0]] || CATEGORIES.market).label}'입니다.` : '',
      ].join(''),
      keyPoints: high.slice(0, 3).map((n) => n.headline),
      watch: upcoming.map((e) => `${formatDateKo(e.date)} ${e.title}`),
    };
  }

  function useSample() {
    const s = window.UMB.sample;
    state.news = s.news();
    state.events = s.events();
    state.quotes = s.quotes();
    state.briefing = s.briefing();
    state.source = 'sample';
  }

  // Live-mode earnings. Inside Finnhub's queried range its real-time calendar is authoritative (date,
  // session, estimate, actual); the Nasdaq snapshot only contributes company name and market cap.
  // Outside that range — or when Finnhub returns nothing, which the free tier sometimes does — the
  // snapshot stays as is, so earnings never disappear. Sample (mock) earnings are dropped whenever
  // real data exists.
  function mergeEarnings(baseEvents, liveEarnings, from, to) {
    const hasSnapshot = !!(window.MARKET_DATA && window.MARKET_DATA.earnings && window.MARKET_DATA.earnings.items?.length);
    if (!liveEarnings.length) return baseEvents;
    const liveByTicker = new Map(liveEarnings.map((e) => [e.ticker, e]));
    const out = [];
    for (const e of baseEvents) {
      if (e.type !== 'earnings') { out.push(e); continue; }
      if (!hasSnapshot) continue; // illustrative sample earnings → replaced by real data
      const l = liveByTicker.get(e.ticker);
      const inRange = e.date >= from && e.date <= to;
      if (l && inRange) {
        // Finnhub wins; keep the snapshot's richer descriptive fields.
        liveByTicker.delete(e.ticker);
        out.push({ ...l, company: e.company, marketCap: e.marketCap, title: e.title, detail: e.detail,
          importance: Math.max(e.importance, l.importance), previous: e.previous });
      } else {
        out.push(e);
      }
    }
    return [...out, ...liveByTicker.values()];
  }

  // Earnings Surprises (stock/earnings): last 4 quarters of { actual, estimate, period, surprisePercent }.
  // Matched to a reported event by fiscal period: the latest period ending before the report date
  // (within ~4 months). Only reported events are looked up, most important first, cached 12h.
  async function applySurprises(events) {
    const now = Date.now();
    const horizon = now - 14 * 86400e3;
    const reported = events
      .filter((e) => e.type === 'earnings' && e.ticker && eventDate(e).getTime() <= now && eventDate(e).getTime() >= horizon)
      .sort((a, b) => Number(window.UMB.isWatched(b.ticker)) - Number(window.UMB.isWatched(a.ticker))
        || (b.marketCap || 0) - (a.marketCap || 0) || b.importance - a.importance)
      .slice(0, SURPRISE_LOOKUPS);
    const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
    const results = await Promise.allSettled(reported.map(async (e) => {
      const rows = await fh('stock/earnings', { symbol: e.ticker }, { ttl: TTL.surprise, priority: -1 });
      if (!Array.isArray(rows)) return;
      const reportTs = Date.parse(`${e.date}T00:00:00Z`);
      const match = rows
        .filter((r) => r.period && r.actual != null)
        .map((r) => ({ r, gap: reportTs - Date.parse(`${r.period}T00:00:00Z`) }))
        .filter((x) => x.gap >= 0 && x.gap <= 125 * 86400e3)
        .sort((a, b) => a.gap - b.gap)[0];
      if (!match) return;
      const r = match.r;
      e.actual = usd(r.actual);
      if (r.estimate != null) e.forecast = usd(r.estimate);
      e.surprisePct = r.surprisePercent != null ? r.surprisePercent
        : (r.estimate ? ((r.actual - r.estimate) / Math.abs(r.estimate)) * 100 : null);
      e.surpriseSource = 'finnhub';
      e.fiscalPeriod = r.period;
    }));
    const failed = results.filter((x) => x.status === 'rejected');
    if (failed.length) console.warn(`[UMB] earnings surprises: ${failed.length}/${results.length} lookups failed`, failed[0].reason && failed[0].reason.code);
    return { checked: reported.length, matched: reported.filter((e) => e.surpriseSource === 'finnhub').length };
  }

  async function loadLive() {
    const today = new Date();
    const from = dateKey(addDays(today, -7));
    const to = dateKey(addDays(today, 30));
    const [newsRaw, earn, quoteRaw] = await Promise.all([
      fh('news', { category: 'general' }, { ttl: TTL.news, priority: 2 }),
      fh('calendar/earnings', { from, to }, { ttl: TTL.calendar, priority: 2 }),
      Promise.all(QUOTE_SYMBOLS.map((q) => fh('quote', { symbol: q.symbol }, { ttl: TTL.quote, priority: 1 }).catch(() => null))),
    ]);

    const news = (Array.isArray(newsRaw) ? newsRaw : []).slice(0, 60).map(normalizeNews)
      .sort((a, b) => b.datetime - a.datetime);
    const earnings = normalizeEarnings((earn && earn.earningsCalendar) || []);
    const quotes = QUOTE_SYMBOLS.map((q, i) => {
      const r = quoteRaw[i];
      return r && r.c ? { symbol: q.symbol, name: q.name, price: r.c, change: r.dp ?? 0 } : null;
    }).filter(Boolean);

    state.news = news;
    const events = mergeEarnings(window.UMB.sample.events(), earnings, from, to);
    state.surpriseStats = await applySurprises(events);
    state.events = events.sort((a, b) => eventDate(a) - eventDate(b));
    state.quotes = quotes.length ? quotes : window.UMB.sample.quotes();
    state.briefing = buildBriefing();
    state.source = 'live';
  }

  // ---- Bitcoin: CoinGecko + Upbit allow browser CORS, so it is fetched live (24/7 market). ----
  const CG = 'https://api.coingecko.com/api/v3';
  async function getJson(url, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  // Replaces state.market.crypto with live values; on failure the snapshot (js/marketData.js) stays.
  async function refreshCrypto() {
    if (!state.market) return false;
    try {
      const [simple, chart, upbit] = await Promise.all([
        getJson(`${CG}/simple/price?ids=bitcoin&vs_currencies=usd,krw&include_24hr_change=true&include_last_updated_at=true`),
        getJson(`${CG}/coins/bitcoin/market_chart?vs_currency=usd&days=60&interval=daily`).catch(() => null),
        getJson('https://api.upbit.com/v1/ticker?markets=KRW-BTC').catch(() => null),
      ]);
      const b = simple && simple.bitcoin;
      if (!b || !b.usd) throw new Error('CoinGecko: empty response');
      const byDay = new Map();
      (chart && chart.prices || []).forEach(([ms, close]) => byDay.set(new Date(ms).toISOString().slice(0, 10), close));
      const prev = state.market.crypto && state.market.crypto.btc;
      const upbitKrw = Array.isArray(upbit) && upbit[0] ? upbit[0].trade_price : null;
      state.market = {
        ...state.market,
        crypto: {
          asOf: new Date((b.last_updated_at || Date.now() / 1000) * 1000).toISOString(),
          source: 'CoinGecko · Upbit (실시간)', url: 'https://www.coingecko.com/en/coins/bitcoin', live: true,
          btc: {
            usd: b.usd, krw: b.krw, change24hPct: b.usd_24h_change,
            series: byDay.size ? [...byDay].map(([date, close]) => ({ date, close })) : (prev ? prev.series : []),
            upbitKrw, kimchiPct: upbitKrw && b.krw ? (upbitKrw / b.krw - 1) * 100 : null,
          },
        },
      };
      return true;
    } catch (err) {
      console.warn('[UMB] live BTC failed, using snapshot', err);
      return false;
    }
  }

  // Re-read js/marketData.js (rewritten every morning by the scheduled task) so an already-open page
  // picks up the new snapshot on ⟳ / auto refresh. A failed load keeps the previous window.MARKET_DATA.
  function reloadSnapshot() {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `js/marketData.js?v=${Date.now()}`;
      s.onload = s.onerror = () => { s.remove(); resolve(); };
      document.head.appendChild(s);
    });
  }
  let loadedOnce = false;

  async function load() {
    state.loading = true;
    state.error = null;
    if (loadedOnce) await reloadSnapshot();
    loadedOnce = true;
    // Market indicators come from the generated snapshot (no CORS-free live source for most of them);
    // a shallow copy so live overrides (Bitcoin) never mutate window.MARKET_DATA.
    const snapshot = window.MARKET_DATA || window.MOCK_MARKET || null;
    state.market = snapshot ? { ...snapshot } : null;
    state.surpriseStats = null;
    try {
      const crypto = refreshCrypto();
      if (window.UMB.finnhub.hasKey()) await loadLive();
      else useSample();
      await crypto;
    } catch (err) {
      // FinnhubError messages are Korean and never contain the key (see js/finnhub.js).
      console.error('[UMB] live load failed', err && err.code, err && err.message);
      useSample();
      state.error = `실시간 데이터를 불러오지 못해 샘플 데이터를 표시합니다. ${err && err.code ? err.message : 'API 키와 네트워크를 확인하세요.'}`;
    } finally {
      state.loading = false;
      state.updatedAt = Date.now();
    }
  }

  window.UMB.api = { load, refreshCrypto };
})();
