#!/usr/bin/env node
/*
 * US sector ETF snapshot for the 미국 섹터 ETF tab → js/sectorData.js (window.SECTOR_DATA).
 *
 *   node scripts/fetch-sector-data.mjs
 *
 * Universe: the 11 SPDR Select Sector ETFs (XLK … XLV) plus SPY as the benchmark.
 * - Prices / returns: Yahoo chart (2y daily so the 1-year return works near year boundaries).
 * - Fund profile: Yahoo quoteSummary (expense ratio, assets, yield, trailing P/E, 3y beta, top-10 holdings),
 *   using the same cookie + crumb flow as fetch-semi-data.mjs (kept in memory only, never written).
 * Missing fields stay null — nothing is estimated. A symbol that fails keeps its previous entry (stale: true).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'js', 'sectorData.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT = 20000;
const KEEP_POINTS = 126;
const TZ = 'America/New_York';

// Morningstar super-sector groups: cyclical / sensitive / defensive.
const ETFS = [
  ['XLK', '기술', 'sensitive'],
  ['XLC', '커뮤니케이션 서비스', 'sensitive'],
  ['XLY', '경기소비재', 'cyclical'],
  ['XLF', '금융', 'cyclical'],
  ['XLI', '산업재', 'sensitive'],
  ['XLB', '소재', 'cyclical'],
  ['XLE', '에너지', 'sensitive'],
  ['XLRE', '부동산', 'cyclical'],
  ['XLU', '유틸리티', 'defensive'],
  ['XLP', '필수소비재', 'defensive'],
  ['XLV', '헬스케어', 'defensive'],
];
const BENCHMARK = 'SPY';

const errors = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}
async function json(url, opts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await http(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 1) throw err;
      await sleep(800);
    }
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
      await sleep(150);
    }
  }));
  return out;
}

const localDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const shiftKey = (key, days) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);
const round = (v, d = 4) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const raw = (v) => {
  const x = v && typeof v === 'object' ? v.raw : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};

async function readPrevious() {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(await readFile(OUT, 'utf8'), sandbox);
    return sandbox.window.SECTOR_DATA || null;
  } catch {
    return null;
  }
}

// ---------- prices & returns ----------
async function chart(symbol) {
  const j = await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.meta) throw new Error('empty chart');
  const m = r.meta;
  const closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  let series = (r.timestamp || []).map((ts, i) => ({ date: localDate(ts * 1000), close: closes[i] }))
    .filter((p) => p.close != null && !Number.isNaN(p.close));
  const byDate = new Map(series.map((p) => [p.date, p.close]));
  series = [...byDate].map(([date, close]) => ({ date, close }));
  const price = m.regularMarketPrice ?? (series.length ? series[series.length - 1].close : null);
  if (price == null) throw new Error('no price');
  const marketMs = (m.regularMarketTime || 0) * 1000;
  const sessionDate = marketMs ? localDate(marketMs) : series[series.length - 1]?.date;
  if (series.length && series[series.length - 1].date === sessionDate) series[series.length - 1].close = price;
  else if (sessionDate) series.push({ date: sessionDate, close: price });
  const before = (key) => { for (let i = series.length - 1; i >= 0; i--) if (series[i].date < key) return series[i].close; return null; };
  const onOrBefore = (key) => { for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= key) return series[i].close; return null; };
  const prevClose = before(sessionDate);
  const yearCloses = series.filter((p) => p.date > shiftKey(sessionDate, 365)).map((p) => p.close);
  return {
    price: round(price, 4),
    change: prevClose != null ? round(price - prevClose, 4) : null,
    changePct: round(pct(price, prevClose), 4),
    marketTime: marketMs ? new Date(marketMs).toISOString() : null,
    sessionDate,
    r: {
      w1: round(pct(price, onOrBefore(shiftKey(sessionDate, 7))), 4),
      m1: round(pct(price, onOrBefore(shiftKey(sessionDate, 30))), 4),
      m3: round(pct(price, onOrBefore(shiftKey(sessionDate, 91))), 4),
      ytd: round(pct(price, onOrBefore(`${Number(sessionDate.slice(0, 4)) - 1}-12-31`)), 4),
      y1: round(pct(price, onOrBefore(shiftKey(sessionDate, 365))), 4),
    },
    high52: yearCloses.length ? round(Math.max(...yearCloses, price), 4) : null,
    low52: yearCloses.length ? round(Math.min(...yearCloses, price), 4) : null,
    series: series.slice(-KEEP_POINTS).map((p) => ({ date: p.date, close: round(p.close, 2) })),
    longName: m.longName || m.shortName || symbol,
  };
}

// ---------- fund profile (cookie + crumb; kept in memory only) ----------
let sessionPromise = null;
function yahooSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const res = await http('https://fc.yahoo.com', { redirect: 'manual' });
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
      const cookie = set.map((c) => c.split(';')[0]).join('; ');
      if (!cookie) throw new Error('no cookie');
      const cr = await http('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { Cookie: cookie } });
      const crumb = (await cr.text()).trim();
      if (!cr.ok || !crumb || crumb.length > 40) throw new Error('no crumb');
      return { cookie, crumb };
    })();
  }
  return sessionPromise;
}

async function profile(symbol) {
  const { cookie, crumb } = await yahooSession();
  const j = await json(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=summaryDetail,defaultKeyStatistics,fundProfile,topHoldings,price&crumb=${encodeURIComponent(crumb)}`,
    { headers: { Cookie: cookie } });
  const r = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!r) throw new Error('empty quoteSummary');
  const sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {};
  const fees = (r.fundProfile && r.fundProfile.feesExpensesInvestment) || {};
  const th = r.topHoldings || {};
  const fraction = (v) => { const x = raw(v); return x == null ? null : round(x * 100, 4); };
  const expense = raw(fees.annualReportExpenseRatio) ?? raw(ks.annualReportExpenseRatio);
  const pe = raw(sd.trailingPE);
  return {
    nameEn: (r.price && (r.price.longName || r.price.shortName)) || null,
    expenseRatio: expense == null ? null : round(expense * 100, 4),
    aum: raw(sd.totalAssets) ?? raw(ks.totalAssets),
    divYield: fraction(sd.yield) ?? fraction(ks.yield),
    // Only the fund-level trailing P/E; topHoldings.equityHoldings.priceToEarnings uses a different definition.
    pe: pe != null && pe > 0 && pe < 1000 ? round(pe, 4) : null,
    beta3y: raw(ks.beta3Year) != null ? round(raw(ks.beta3Year), 4) : null,
    holdingsCount: null, // Yahoo exposes only the top 10 holdings, not the total count.
    topHoldings: (th.holdings || []).slice(0, 10).map((h) => ({
      symbol: h.symbol || null,
      name: h.holdingName || null,
      weight: fraction(h.holdingPercent),
    })),
  };
}

const EMPTY_PROFILE = { nameEn: null, expenseRatio: null, aum: null, divYield: null, pe: null, beta3y: null, holdingsCount: null, topHoldings: [] };

async function build(symbol, nameKo, sector, group) {
  const c = await chart(symbol);
  let p = EMPTY_PROFILE;
  try {
    p = await profile(symbol);
  } catch (err) {
    errors[`profile.${symbol}`] = err.message;
  }
  return {
    symbol, nameKo, nameEn: p.nameEn || c.longName, sector, group,
    price: c.price, change: c.change, changePct: c.changePct, marketTime: c.marketTime, sessionDate: c.sessionDate,
    r: c.r, high52: c.high52, low52: c.low52, series: c.series,
    expenseRatio: p.expenseRatio, aum: p.aum, divYield: p.divYield, pe: p.pe, beta3y: p.beta3y,
    holdingsCount: p.holdingsCount, topHoldings: p.topHoldings,
  };
}

async function main() {
  const previous = await readPrevious();
  const prevBySym = new Map([...(previous?.etfs || []), ...(previous?.benchmark ? [previous.benchmark] : [])].map((e) => [e.symbol, e]));
  const jobs = [[BENCHMARK, 'S&P 500 (SPY)', null, null], ...ETFS.map(([s, sector, group]) => [s, `${sector} (${s})`, sector, group])];

  const results = await pool(jobs, 3, async ([symbol, nameKo, sector, group]) => {
    try {
      return await build(symbol, nameKo, sector, group);
    } catch (err) {
      errors[symbol] = err.message;
      const prev = prevBySym.get(symbol);
      return prev ? { ...prev, stale: true } : null;
    }
  });

  const benchmark = results[0];
  const etfs = results.slice(1).filter(Boolean);
  if (!benchmark && !etfs.length) {
    console.error('all symbols failed; keeping the previous file');
    process.exitCode = 1;
    return;
  }

  const data = { generatedAt: new Date().toISOString(), source: 'Yahoo Finance (SPDR Select Sector ETFs)', benchmark, etfs, errors };

  const fmt = (v, d = 2) => (v == null ? '-' : v.toFixed(d));
  console.table([benchmark, ...etfs].filter(Boolean).map((e) => ({
    symbol: e.symbol, sector: e.sector || '-', price: fmt(e.price), '1D%': fmt(e.changePct), 'YTD%': fmt(e.r?.ytd), '1Y%': fmt(e.r?.y1),
    'exp%': fmt(e.expenseRatio, 3), aumB: e.aum ? (e.aum / 1e9).toFixed(1) : '-', 'yld%': fmt(e.divYield), pe: fmt(e.pe, 1), beta3y: fmt(e.beta3y),
    top: e.topHoldings?.length || 0, stale: e.stale ? 'yes' : '',
  })));
  const all = [benchmark, ...etfs].filter(Boolean);
  const cov = (k) => `${all.filter((e) => (k === 'topHoldings' ? e[k]?.length : e[k] != null)).length}/${all.length}`;
  console.log('coverage:', ['expenseRatio', 'aum', 'divYield', 'pe', 'beta3y', 'holdingsCount', 'topHoldings'].map((k) => `${k} ${cov(k)}`).join(' · '));
  if (Object.keys(errors).length) console.log('errors:', errors);

  const body = `/* generated by scripts/fetch-sector-data.mjs — do not edit. Regenerate: node scripts/fetch-sector-data.mjs */\n`
    + `window.SECTOR_DATA = ${JSON.stringify(data)};\n`;
  await writeFile(OUT, body, 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUT)} (${Math.round(body.length / 1024)} KB)`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
