/*
 * Live quote overlay (window.UMB.live). The snapshot files (js/*Data.js) are rebuilt by GitHub Actions
 * about every 15 minutes; on top of that, prices the browser CAN fetch directly are refreshed here.
 *
 * Source: CNBC's public quote service (quote.cnbc.com), which allows cross-origin browser requests
 * and covers global indices, index futures, VIX, Treasury yields, FX, commodity futures and US /
 * Japan / Taiwan / Hong Kong / Europe listed stocks and ETFs. Korean stocks (005930.KS …) are not
 * available there and stay on the snapshot. Some exchanges' quotes are delayed by the provider.
 *
 *   refresh()   fetch quotes for every loaded dataset and overlay them (throttled; returns true if applied)
 *   reapply()   overlay the last fetched quotes again (after a snapshot reload replaced the objects)
 *   lastAt()    ms timestamp of the last successful fetch, or 0
 *
 * Only "latest" fields change (price, change, changePct, prevClose, marketTime, sessionDate, the last
 * series point, market cap scaled by the price move). Period returns, 52-week ranges and fundamentals
 * stay as in the snapshot. Nothing is overlaid when a quote is missing or unparsable.
 */
(function () {
  'use strict';
  const U = window.UMB;
  const ENDPOINT = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';
  const BATCH = 40;
  const MIN_INTERVAL_MS = 20 * 1000;

  // Yahoo symbols used by the snapshots → CNBC symbols. Stocks/ETFs not listed here map by suffix.
  const MAP = {
    '^KS11': '.KS11', '^KQ11': '.KQ11', '^N225': '.N225', '^HSI': '.HSI', '000001.SS': '.SSEC', '^TWII': '.TWII',
    '^STOXX': '.STOXX', '^STOXX50E': '.STOXX50E', '^FTSE': '.FTSE', '^GDAXI': '.GDAXI', '^FCHI': '.FCHI',
    '^GSPC': '.SPX', '^IXIC': '.IXIC', '^DJI': '.DJI', '^NDX': '.NDX', '^RUT': '.RUT', '^SOX': '.SOX',
    'ES=F': '@SP.1', 'NQ=F': '@ND.1', '^VIX': '.VIX',
    'CL=F': '@CL.1', 'BZ=F': '@LCO.1', 'NG=F': '@NG.1', 'GC=F': '@GC.1', 'SI=F': '@SI.1', 'HG=F': '@HG.1',
    'ZC=F': '@C.1', 'ZW=F': '@W.1', 'ZS=F': '@S.1',
    'DX-Y.NYB': '.DXY', 'KRW=X': 'KRW=', 'JPY=X': 'JPY=', 'EURUSD=X': 'EUR=', 'CNY=X': 'CNY=', 'GBPUSD=X': 'GBP=',
  };
  const YIELDS = { y3m: 'US3M', y2: 'US2Y', y10: 'US10Y', y30: 'US30Y' };

  function cnbcSymbol(sym) {
    if (!sym) return null;
    if (MAP[sym]) return MAP[sym];
    if (/\.KS$|\.KQ$/.test(sym)) return null; // Korean listings: not served by CNBC
    if (/[\^=]/.test(sym)) return null;       // other indices/futures/FX without a known mapping
    return sym.replace(/\.TW$/, '-TW').replace(/\.DE$/, '-DE').replace(/\.AS$/, '-NL'); // .T / .HK work as is
  }

  // ---------- fetch ----------
  const num = (s) => {
    if (s == null) return null;
    if (/^UNCH$/i.test(String(s))) return 0;
    const v = parseFloat(String(s).replace(/[,%+\s]/g, ''));
    return Number.isFinite(v) ? v : null;
  };

  function parse(q) {
    if (!q || String(q.code) !== '0') return null;
    const price = num(q.last);
    if (price == null) return null;
    const t = Date.parse(q.last_time || '');
    // last_time carries the exchange's own UTC offset, so its first 10 chars are the local session date.
    const sessionDate = /^\d{4}-\d{2}-\d{2}/.test(q.last_time || '') ? q.last_time.slice(0, 10) : null;
    const ext = q.ExtendedMktQuote;
    return {
      price,
      change: num(q.change),
      changePct: num(q.change_pct),
      prevClose: num(q.previous_day_closing),
      time: Number.isFinite(t) ? t : null,
      sessionDate,
      status: q.curmktstatus || null,
      ext: ext && num(ext.last) != null ? { price: num(ext.last), changePct: num(ext.change_pct), type: ext.type } : null,
    };
  }

  async function fetchBatch(symbols) {
    const url = `${ENDPOINT}?symbols=${encodeURIComponent(symbols.join('|'))}`
      + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = json && json.FormattedQuoteResult && json.FormattedQuoteResult.FormattedQuote;
      return Array.isArray(list) ? list : [];
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- targets ----------
  // Every overlay-able item in the loaded datasets: { item, sym } (items share the {symbol, price,
  // change, changePct, series} shape across marketData / macroData / sectorData / semiData).
  function targets() {
    const out = [];
    const add = (item) => { const sym = item && cnbcSymbol(item.symbol); if (sym) out.push({ item, sym }); };
    const m = U.state.market;
    if (m && !m.mock) {
      (m.globalIndices && m.globalIndices.items || []).forEach(add);
      if (m.oil && m.oil.futures) { add(m.oil.futures.wti); add(m.oil.futures.brent); }
    }
    const x = window.MACRO_DATA;
    if (x) [x.fx, x.commodities, x.bondEtfs].forEach((list) => (list || []).forEach(add));
    const s = window.SECTOR_DATA;
    if (s) { add(s.benchmark); (s.etfs || []).forEach(add); }
    const e = window.SEMI_DATA;
    if (e) { add(e.index); (e.etfs || []).forEach(add); (e.stocks || []).forEach(add); }
    return out;
  }

  function upsertPoint(series, date, value, key) {
    if (!Array.isArray(series) || !date || value == null) return;
    const last = series[series.length - 1];
    if (last && last.date === date) last[key] = value;
    else if (!last || last.date < date) series.push({ date, [key]: value });
  }

  function applyItem(item, q) {
    const oldPrice = item.price;
    item.price = q.price;
    if (q.change != null) item.change = q.change;
    if (q.changePct != null) item.changePct = q.changePct;
    if (q.prevClose != null) item.prevClose = q.prevClose;
    if (q.time) item.marketTime = new Date(q.time).toISOString();
    if (q.sessionDate) { item.sessionDate = q.sessionDate; if ('date' in item) item.date = q.sessionDate; }
    if (Array.isArray(item.series)) upsertPoint(item.series, q.sessionDate, q.price, item.series[0] && 'value' in item.series[0] ? 'value' : 'close');
    if (item.marketCapUsd && oldPrice) item.marketCapUsd *= q.price / oldPrice;
    item.ext = q.ext && q.ext.type !== 'REG_MKT' ? q.ext : null;
    item.live = { at: q.time || Date.now(), source: 'CNBC' };
  }

  let quotes = new Map(); // cnbc symbol → parsed quote
  let lastAt = 0;
  let inflight = null;

  function reapply() {
    if (!quotes.size) return false;
    let n = 0;
    for (const { item, sym } of targets()) {
      const q = quotes.get(sym);
      if (q) { applyItem(item, q); n++; }
    }
    const m = U.state.market;
    if (m && !m.mock) {
      const v = quotes.get('.VIX');
      if (m.vix && v && v.sessionDate) {
        upsertPoint(m.vix.series, v.sessionDate, v.price, 'close');
        m.vix.live = { at: v.time || Date.now(), source: 'CNBC', status: v.status };
        if (v.time) m.vix.asOf = new Date(v.time).toISOString(); // card footer shows the quote time (KST)
        m.vix.source = 'Cboe VIX · 실시간 CNBC';
        n++;
      }
      if (m.rates) {
        const live = {};
        for (const [k, sym] of Object.entries(YIELDS)) {
          const q = quotes.get(sym);
          if (q) live[k] = { value: q.price, time: q.time };
        }
        if (Object.keys(live).length) { m.rates.live = { ...live, source: 'CNBC' }; n++; }
      }
    }
    return n > 0;
  }

  // Fetch quotes for all loaded datasets. Throttled unless `force` (manual ⟳) or new symbols appeared
  // (e.g. the semiconductor tab was just loaded).
  function refresh({ force = false } = {}) {
    if (inflight) return inflight;
    const symbols = [...new Set([...targets().map((t) => t.sym), '.VIX', ...Object.values(YIELDS)])];
    const missing = symbols.some((s) => !quotes.has(s));
    if (!force && !missing && Date.now() - lastAt < MIN_INTERVAL_MS) return Promise.resolve(reapply());
    inflight = (async () => {
      const batches = [];
      for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));
      const results = await Promise.allSettled(batches.map(fetchBatch));
      const next = new Map(quotes);
      let ok = 0;
      results.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        for (const raw of r.value) {
          const q = parse(raw);
          if (q) { next.set(raw.symbol, q); ok++; }
        }
      });
      if (!ok) {
        const err = results.find((r) => r.status === 'rejected');
        console.warn('[UMB] live quotes unavailable, showing snapshot', err && err.reason && err.reason.message);
        return false;
      }
      quotes = next;
      lastAt = Date.now();
      return reapply();
    })().catch((err) => {
      console.warn('[UMB] live quotes failed', err && err.message);
      return false;
    }).finally(() => { inflight = null; });
    return inflight;
  }

  U.live = { refresh, reapply, lastAt: () => lastAt, cnbcSymbol };
})();
