#!/usr/bin/env node
/*
 * Semiconductor snapshot for the 반도체 tab → js/semiData.js (window.SEMI_DATA).
 *
 *   node scripts/fetch-semi-data.mjs
 *
 * - SOX constituents: Nasdaq Global Indexes weighting data (fetched every run, never hardcoded;
 *   falls back to the previous snapshot's list when the site is unreachable).
 * - Universe: all SOX constituents + major non-constituents (TSMC Taiwan listing, Samsung, SK hynix, …).
 * - Prices/history: Yahoo Finance chart (1y daily) → returns computed locally.
 * - Market cap: Yahoo v7 quote (cookie + crumb), converted to USD; Nasdaq summary fallback for US tickers.
 * - Fundamentals (stock.fund): Yahoo quoteSummary (P/E, forward P/E, PEG, P/B, EV/EBITDA, margins, ROE, growth,
 *   FCF) + fundamentals-timeseries statements (capex/sales, inventory turnover, DIO). Missing → null.
 * - Next earnings (US tickers): from the earnings section of js/marketData.js.
 * Zero dependencies (Node 18+ global fetch).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'js', 'semiData.js');
const MARKET = path.join(ROOT, 'js', 'marketData.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT = 20000;
const KEEP_POINTS = 126;

// Segment map for US-listed names (SOX members and US non-members). Judgment calls are noted.
const SEGMENTS = {
  NVDA: 'compute', AMD: 'compute', INTC: 'compute', ARM: 'ip',
  AVGO: 'network', MRVL: 'network', ALAB: 'network', CRDO: 'network', MTSI: 'network', COHR: 'network',
  QCOM: 'compute', // mobile SoC / modem
  LSCC: 'compute', // FPGA
  SITM: 'analog',  // MEMS timing
  MU: 'memory',
  TSM: 'foundry', GFS: 'foundry', TSEM: 'foundry',
  ASML: 'equipment', AMAT: 'equipment', LRCX: 'equipment', KLAC: 'equipment',
  TER: 'materials', // test equipment → grouped with 테스트
  ENTG: 'materials', Q: 'materials', // Qnity Electronics (DuPont electronics spin-off: materials)
  ADI: 'analog', TXN: 'analog', MCHP: 'analog', NXPI: 'analog', ON: 'analog', MPWR: 'analog', STM: 'analog',
  SWKS: 'network', QRVO: 'network',
  SNPS: 'ip', CDNS: 'ip', AMKR: 'osat', ONTO: 'equipment', MKSI: 'equipment', SMCI: 'compute',
};
const KO_NAMES = {
  NVDA: '엔비디아', AMD: 'AMD', INTC: '인텔', ARM: 'Arm', AVGO: '브로드컴', MRVL: '마벨', ALAB: '아스테라 랩스', CRDO: '크레도',
  MTSI: 'MACOM', COHR: '코히런트', QCOM: '퀄컴', LSCC: '래티스', SITM: '사이타임', MU: '마이크론', TSM: 'TSMC (ADR)',
  GFS: '글로벌파운드리스', TSEM: '타워 세미컨덕터', ASML: 'ASML', AMAT: '어플라이드 머티리얼즈', LRCX: '램리서치', KLAC: 'KLA',
  TER: '테라다인', ENTG: '엔테그리스', Q: '큐니티 일렉트로닉스', ADI: '아날로그 디바이스', TXN: '텍사스 인스트루먼트',
  MCHP: '마이크로칩', NXPI: 'NXP', ON: '온세미', MPWR: '모놀리식 파워', STM: 'ST마이크로', SWKS: '스카이웍스', QRVO: '코보',
  SNPS: '시놉시스', CDNS: '케이던스', AMKR: '앰코', ONTO: '온투 이노베이션', MKSI: 'MKS', SMCI: '슈퍼마이크로',
};
const COUNTRY_US_LISTED = { TSM: 'TW', ASML: 'NL', ARM: 'GB', NXPI: 'NL', TSEM: 'IL', STM: 'CH' };

// Major semiconductor companies that are not SOX members (skipped if they turn out to be members).
const EXTRA = [
  { symbol: '005930.KS', ticker: '005930', nameKo: '삼성전자', segment: 'memory', country: 'KR' },
  { symbol: '000660.KS', ticker: '000660', nameKo: 'SK하이닉스', segment: 'memory', country: 'KR' },
  { symbol: '042700.KS', ticker: '042700', nameKo: '한미반도체', segment: 'equipment', country: 'KR' },
  { symbol: '2330.TW', ticker: '2330', nameKo: 'TSMC (대만 본주)', segment: 'foundry', country: 'TW' },
  { symbol: '8035.T', ticker: '8035', nameKo: '도쿄일렉트론', segment: 'equipment', country: 'JP' },
  { symbol: '6857.T', ticker: '6857', nameKo: '어드반테스트', segment: 'materials', country: 'JP' },
  { symbol: '6146.T', ticker: '6146', nameKo: '디스코', segment: 'equipment', country: 'JP' },
  { symbol: '6723.T', ticker: '6723', nameKo: '르네사스', segment: 'analog', country: 'JP' },
  { symbol: 'IFX.DE', ticker: 'IFX', nameKo: '인피니언', segment: 'analog', country: 'DE' },
  { symbol: 'STM', ticker: 'STM', nameKo: 'ST마이크로', segment: 'analog', country: 'CH' },
  { symbol: 'ASM.AS', ticker: 'ASM', nameKo: 'ASM 인터내셔널', segment: 'equipment', country: 'NL' },
  { symbol: 'BESI.AS', ticker: 'BESI', nameKo: 'BE 세미컨덕터', segment: 'osat', country: 'NL' },
  { symbol: '0981.HK', ticker: '0981', nameKo: 'SMIC', segment: 'foundry', country: 'CN' },
  { symbol: 'SNPS', ticker: 'SNPS', nameKo: '시놉시스', segment: 'ip', country: 'US' },
  { symbol: 'CDNS', ticker: 'CDNS', nameKo: '케이던스', segment: 'ip', country: 'US' },
  { symbol: 'AMKR', ticker: 'AMKR', nameKo: '앰코', segment: 'osat', country: 'US' },
];
const FX_SYMBOLS = { KRW: 'KRW=X', TWD: 'TWD=X', JPY: 'JPY=X', EUR: 'EUR=X', HKD: 'HKD=X' };

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
      await sleep(120);
    }
  }));
  return out;
}

const localDate = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const shiftKey = (key, days) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);
const round = (v, d = 4) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

async function readWindowVar(file, name) {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(await readFile(file, 'utf8'), sandbox);
    return sandbox.window[name] || null;
  } catch {
    return null;
  }
}

// ---------- SOX constituents ----------
async function fetchConstituents(previous) {
  const today = new Date();
  for (let back = 0; back <= 7; back++) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const key = d.toISOString().slice(0, 10);
    try {
      const res = await http('https://indexes.nasdaqomx.com/Index/WeightingData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: `id=SOX&tradeDate=${key}T00:00:00.000&timeOfDay=SOD`,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const symbols = (j.aaData || []).map((r) => String(r.Symbol || '').trim()).filter(Boolean);
      if (symbols.length) return { asOf: key, symbols, method: 'fetched' };
    } catch (err) {
      errors['constituents.fetch'] = `${key}: ${err.message}`;
    }
  }
  if (previous && previous.constituents && previous.constituents.symbols?.length) {
    errors.constituents = 'Nasdaq 구성종목 조회 실패 — 이전 스냅샷 목록 사용';
    return { asOf: previous.constituents.asOf, symbols: previous.constituents.symbols, method: 'previous' };
  }
  throw new Error('SOX constituents unavailable and no previous snapshot');
}

// ---------- Yahoo chart → quote record ----------
async function chart(symbol) {
  const j = await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.meta) throw new Error('empty chart');
  const m = r.meta;
  const tz = m.exchangeTimezoneName || 'UTC';
  const closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  let series = (r.timestamp || []).map((ts, i) => ({ date: localDate(ts * 1000, tz), close: closes[i] }))
    .filter((p) => p.close != null && !Number.isNaN(p.close));
  // One point per local date (keep the last).
  const byDate = new Map(series.map((p) => [p.date, p.close]));
  series = [...byDate].map(([date, close]) => ({ date, close }));
  const price = m.regularMarketPrice ?? (series.length ? series[series.length - 1].close : null);
  if (price == null) throw new Error('no price');
  const marketMs = (m.regularMarketTime || 0) * 1000;
  const sessionDate = marketMs ? localDate(marketMs, tz) : series[series.length - 1]?.date;
  if (series.length && series[series.length - 1].date === sessionDate) series[series.length - 1].close = price;
  else if (sessionDate) series.push({ date: sessionDate, close: price });
  const before = (key) => { for (let i = series.length - 1; i >= 0; i--) if (series[i].date < key) return series[i].close; return null; };
  const onOrBefore = (key) => { for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= key) return series[i].close; return null; };
  const prevClose = before(sessionDate);
  const yearCloses = series.filter((p) => p.date > shiftKey(sessionDate, 365)).map((p) => p.close);
  return {
    currency: m.currency || null,
    tz,
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
    },
    high52: yearCloses.length ? round(Math.max(...yearCloses, price), 4) : null,
    low52: yearCloses.length ? round(Math.min(...yearCloses, price), 4) : null,
    series: series.slice(-KEEP_POINTS).map((p) => ({ date: p.date, close: round(p.close, 2) })),
    shortName: m.shortName || m.longName || symbol,
  };
}

// ---------- Yahoo session (cookie + crumb; kept in memory only, never written) ----------
let yahooSessionPromise = null;
function yahooSession() {
  if (!yahooSessionPromise) {
    yahooSessionPromise = (async () => {
      const res = await http('https://fc.yahoo.com', { redirect: 'manual' });
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
      const cookie = raw.map((c) => c.split(';')[0]).join('; ');
      if (!cookie) throw new Error('no cookie');
      const cr = await http('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { Cookie: cookie } });
      const crumb = (await cr.text()).trim();
      if (!cr.ok || !crumb || crumb.length > 40) throw new Error('no crumb');
      return { cookie, crumb };
    })();
  }
  return yahooSessionPromise;
}

// ---------- market caps ----------
async function yahooCaps(symbols) {
  const caps = {};
  try {
    const { cookie, crumb } = await yahooSession();
    for (let i = 0; i < symbols.length; i += 40) {
      const batch = symbols.slice(i, i + 40);
      const j = await json(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${batch.map(encodeURIComponent).join(',')}&crumb=${encodeURIComponent(crumb)}`,
        { headers: { Cookie: cookie } });
      for (const q of (j && j.quoteResponse && j.quoteResponse.result) || []) {
        if (q.marketCap) caps[q.symbol] = { cap: q.marketCap, currency: q.financialCurrency && q.currency ? q.currency : q.currency };
      }
    }
  } catch (err) {
    errors['marketCap.yahoo'] = err.message;
  }
  return caps;
}
async function nasdaqCap(ticker) {
  try {
    const j = await json(`https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/summary?assetclass=stocks`,
      { headers: { Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' } });
    const v = j && j.data && j.data.summaryData && j.data.summaryData.MarketCap && j.data.summaryData.MarketCap.value;
    const n = v ? Number(String(v).replace(/[$,]/g, '')) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// ---------- fundamentals (valuation, margins, capex intensity, inventory turnover) ----------
// quoteSummary gives ratios/margins; fundamentals-timeseries gives statement lines for capex/sales and
// inventory turnover. Missing values arrive as {} or absent → null. Nothing is estimated or filled in.
const FUND_TYPES = ['trailingCapitalExpenditure', 'annualCapitalExpenditure', 'trailingTotalRevenue', 'annualTotalRevenue',
  'trailingCostOfRevenue', 'annualCostOfRevenue', 'quarterlyInventory', 'annualInventory'];
const num = (v) => {
  const x = v && typeof v === 'object' ? v.raw : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};
const ratio = (v) => { const x = num(v); return x == null || x <= 0 || x > 1000 ? null : x; };      // P/E-style multiples
const pctOf = (v) => { const x = num(v); return x == null || Math.abs(x) > 50 ? null : x * 100; };   // fraction → percent (drop absurd)

async function timeseries(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = now - 5 * 365 * 86400;
  const j = await json(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${FUND_TYPES.join(',')}&period1=${p1}&period2=${now}`);
  const out = {};
  for (const s of (j && j.timeseries && j.timeseries.result) || []) {
    const type = s.meta && s.meta.type && s.meta.type[0];
    if (!type) continue;
    out[type] = (s[type] || []).filter((x) => x && x.asOfDate && x.reportedValue && Number.isFinite(x.reportedValue.raw))
      .map((x) => ({ date: x.asOfDate, value: x.reportedValue.raw, currency: x.currencyCode || null }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

const latest = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);
const daysBetween = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400e3;

function statementMetrics(ts) {
  const res = { capexToSales: null, invTurnover: null, dio: null, asOf: null, currency: null, basis: { capexToSales: null, invTurnover: null } };
  // Capex / sales: TTM when both lines exist for the same period, else the latest common fiscal year.
  const tCap = latest(ts.trailingCapitalExpenditure), tRev = latest(ts.trailingTotalRevenue);
  if (tCap && tRev && tCap.date === tRev.date && tRev.value > 0) {
    res.capexToSales = (Math.abs(tCap.value) / tRev.value) * 100;
    res.basis.capexToSales = 'TTM';
    res.asOf = tRev.date; res.currency = tRev.currency;
  } else {
    const aRev = ts.annualTotalRevenue || [];
    const aCap = new Map((ts.annualCapitalExpenditure || []).map((x) => [x.date, x.value]));
    const fy = [...aRev].reverse().find((r) => aCap.has(r.date) && r.value > 0);
    if (fy) {
      res.capexToSales = (Math.abs(aCap.get(fy.date)) / fy.value) * 100;
      res.basis.capexToSales = `FY${fy.date.slice(0, 4)}`;
      res.asOf = fy.date; res.currency = fy.currency;
    }
  }
  // Inventory turnover = COGS / average inventory over the same span.
  const inv = [...(ts.quarterlyInventory || []), ...(ts.annualInventory || [])].filter((x) => x.value > 0);
  const invByDate = new Map(inv.map((x) => [x.date, x.value]));
  const invNear = (date, maxGap) => {
    let best = null;
    for (const [d, v] of invByDate) { const g = daysBetween(d, date); if (g <= maxGap && (!best || g < best.g)) best = { d, v, g }; }
    return best;
  };
  const tCogs = latest(ts.trailingCostOfRevenue);
  let turnover = null;
  if (tCogs && tCogs.value > 0) {
    const end = invNear(tCogs.date, 10);
    const startDate = new Date(Date.parse(`${tCogs.date}T00:00:00Z`) - 365 * 86400e3).toISOString().slice(0, 10);
    const start = invNear(startDate, 50);
    if (end && start) {
      turnover = tCogs.value / ((end.v + start.v) / 2);
      res.basis.invTurnover = 'TTM';
      if (!res.asOf || tCogs.date > res.asOf) { res.asOf = tCogs.date; res.currency = tCogs.currency; }
    }
  }
  if (turnover == null) {
    const aCogs = ts.annualCostOfRevenue || [];
    const aInv = ts.annualInventory || [];
    for (let i = aCogs.length - 1; i >= 0 && turnover == null; i--) {
      const c = aCogs[i];
      const endInv = aInv.find((x) => x.date === c.date);
      const prevInv = [...aInv].reverse().find((x) => x.date < c.date && daysBetween(x.date, c.date) <= 400);
      if (c.value > 0 && endInv && endInv.value > 0 && prevInv && prevInv.value > 0) {
        turnover = c.value / ((endInv.value + prevInv.value) / 2);
        res.basis.invTurnover = `FY${c.date.slice(0, 4)}`;
        if (!res.asOf) { res.asOf = c.date; res.currency = c.currency; }
      }
    }
  }
  if (turnover != null && turnover > 0 && turnover < 1000) {
    res.invTurnover = turnover;
    res.dio = 365 / turnover;
  }
  return res;
}

async function fundamentals(symbol, ticker, quoteCurrency, toUsd) {
  const errs = [];
  let qs = null;
  let ts = {};
  try {
    const { cookie, crumb } = await yahooSession();
    const j = await json(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics,financialData&crumb=${encodeURIComponent(crumb)}`,
      { headers: { Cookie: cookie } });
    qs = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  } catch (err) {
    errs.push(`quoteSummary: ${err.message}`);
  }
  try {
    ts = await timeseries(symbol);
  } catch (err) {
    errs.push(`timeseries: ${err.message}`);
  }
  const sd = (qs && qs.summaryDetail) || {}, ks = (qs && qs.defaultKeyStatistics) || {}, fd = (qs && qs.financialData) || {};
  const st = statementMetrics(ts);
  const revenue = num(fd.totalRevenue);
  const fcf = num(fd.freeCashflow);
  const financialCurrency = (typeof fd.financialCurrency === 'string' && fd.financialCurrency) || st.currency || null;
  const fund = {
    asOf: st.asOf,
    financialCurrency,
    source: 'Yahoo Finance',
    pe: round(ratio(sd.trailingPE) ?? ratio(ks.trailingPE), 2),
    fpe: round(ratio(sd.forwardPE) ?? ratio(ks.forwardPE), 2),
    peg: round(ratio(ks.pegRatio), 2),
    pb: round(ratio(ks.priceToBook) ?? ratio(sd.priceToBook), 2),
    evEbitda: round(ratio(ks.enterpriseToEbitda), 2),
    divYield: round(pctOf(sd.dividendYield), 2),
    grossMargin: round(pctOf(fd.grossMargins), 2),
    opMargin: round(pctOf(fd.operatingMargins), 2),
    netMargin: round(pctOf(fd.profitMargins), 2),
    roe: round(pctOf(fd.returnOnEquity), 2),
    revenueGrowth: round(pctOf(fd.revenueGrowth), 2),
    fcfMargin: round(revenue && fcf != null && revenue > 0 ? Math.max(-500, Math.min(500, (fcf / revenue) * 100)) : null, 2),
    capexToSales: round(st.capexToSales, 2),
    invTurnover: round(st.invTurnover, 2),
    dio: round(st.dio, 1),
    revenueUsd: revenue != null ? (() => { const u = toUsd(revenue, financialCurrency); return u != null ? Math.round(u) : null; })() : null,
    basis: st.basis,
  };
  // ADRs / foreign listings: Yahoo mixes the quote currency (e.g. USD) with the reporting currency (e.g. TWD)
  // in P/B and EV/EBITDA, giving meaningless values (TSM P/B ~81). Exclude them rather than show a wrong number.
  if (quoteCurrency && financialCurrency && quoteCurrency !== financialCurrency) {
    fund.pb = null;
    fund.evEbitda = null;
    fund.excluded = { keys: ['pb', 'evEbitda'], reason: `거래 통화(${quoteCurrency})와 재무제표 통화(${financialCurrency})가 달라 제외` };
  }
  const metricKeys = ['pe', 'fpe', 'peg', 'pb', 'evEbitda', 'divYield', 'grossMargin', 'opMargin', 'netMargin', 'roe', 'revenueGrowth', 'fcfMargin', 'capexToSales', 'invTurnover', 'dio', 'revenueUsd'];
  if (errs.length) errors[`fund.${ticker}`] = errs.join('; ');
  return metricKeys.some((k) => fund[k] != null) ? fund : null;
}

// ---------- main ----------
async function main() {
  const previous = await readWindowVar(OUT, 'SEMI_DATA');
  const market = await readWindowVar(MARKET, 'MARKET_DATA');

  const cons = await fetchConstituents(previous);
  const soxSet = new Set(cons.symbols);

  const universe = [
    ...cons.symbols.map((t) => ({ symbol: t, ticker: t, nameKo: KO_NAMES[t] || null, segment: SEGMENTS[t] || null, country: COUNTRY_US_LISTED[t] || 'US', inSox: true })),
    ...EXTRA.filter((e) => !soxSet.has(e.ticker) && !soxSet.has(e.symbol)).map((e) => ({ ...e, inSox: false })),
  ];
  const unmapped = universe.filter((u) => !u.segment).map((u) => u.ticker);
  if (unmapped.length) errors['segment.unmapped'] = unmapped.join(',');

  // FX (units per USD)
  const fx = {};
  await pool(Object.entries(FX_SYMBOLS), 3, async ([cur, sym]) => {
    try { fx[cur] = (await chart(sym)).price; } catch (err) { errors[`fx.${cur}`] = err.message; }
  });

  const idx = async (symbol, name) => {
    try {
      const c = await chart(symbol);
      return { symbol, name, price: c.price, change: c.change, changePct: c.changePct, marketTime: c.marketTime, sessionDate: c.sessionDate, r: c.r, high52: c.high52, low52: c.low52, series: c.series };
    } catch (err) {
      errors[`index.${symbol}`] = err.message;
      return null;
    }
  };
  const [index, smh, soxx] = await Promise.all([
    idx('^SOX', '필라델피아 반도체 지수 (SOX)'), idx('SMH', 'VanEck 반도체 ETF'), idx('SOXX', 'iShares 반도체 ETF'),
  ]);

  const quotes = await pool(universe, 4, async (u) => {
    try { return { u, c: await chart(u.symbol) }; } catch (err) { errors[`stock.${u.symbol}`] = err.message; return null; }
  });
  const ok = quotes.filter(Boolean);

  const caps = await yahooCaps(ok.map((x) => x.u.symbol));
  const toUsd = (value, currency) => {
    if (!value) return null;
    if (!currency || currency === 'USD') return value;
    const cur = currency === 'GBp' ? 'GBP' : currency;
    return fx[cur] ? value / fx[cur] : null;
  };

  const funds = {};
  await pool(ok, 3, async ({ u, c }) => { funds[u.symbol] = await fundamentals(u.symbol, u.ticker, c.currency, toUsd); });

  const earnings = (market && market.earnings && market.earnings.items) || [];
  const todayKey = localDate(Date.now(), 'America/New_York');

  const stocks = [];
  for (const { u, c } of ok) {
    let capUsd = caps[u.symbol] ? toUsd(caps[u.symbol].cap, caps[u.symbol].currency || c.currency) : null;
    if (capUsd == null && /^[A-Z.]+$/.test(u.symbol)) capUsd = await nasdaqCap(u.ticker);
    const next = earnings.filter((e) => e.symbol === u.ticker && e.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date))[0];
    stocks.push({
      symbol: u.symbol, ticker: u.ticker, name: c.shortName, nameKo: u.nameKo || c.shortName, country: u.country, currency: c.currency,
      inSox: u.inSox, segment: u.segment || 'materials',
      price: c.price, change: c.change, changePct: c.changePct, marketTime: c.marketTime, sessionDate: c.sessionDate,
      r: c.r, high52: c.high52, low52: c.low52, marketCapUsd: capUsd != null ? Math.round(capUsd) : null,
      series: c.series, nextEarnings: next ? next.date : null, earningsSession: next ? (next.session || null) : null,
      fund: funds[u.symbol] || null,
    });
  }
  stocks.sort((a, b) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0));

  if (!stocks.length && previous) {
    previous.stale = true;
    previous.errors = { ...errors, run: 'all stock fetches failed — previous snapshot kept' };
    await write(previous);
    console.error('All stock fetches failed; kept previous snapshot (stale).');
    process.exitCode = 1;
    return;
  }

  const data = {
    generatedAt: new Date().toISOString(),
    constituents: { source: 'Nasdaq Global Indexes (PHLX Semiconductor Sector, SOX)', url: 'https://indexes.nasdaqomx.com/Index/Overview/SOX',
      asOf: cons.asOf, count: cons.symbols.length, symbols: cons.symbols, method: cons.method },
    index: index || (previous && previous.index) || null,
    etfs: [smh, soxx].filter(Boolean),
    stocks,
    fx,
    errors,
  };
  await write(data);

  const inSox = stocks.filter((s) => s.inSox).length;
  console.table(stocks.slice(0, 50).map((s) => ({ ticker: s.ticker, name: s.nameKo, sox: s.inSox ? 'Y' : '', seg: s.segment,
    price: s.price, '1D%': s.changePct?.toFixed(2), 'YTD%': s.r.ytd?.toFixed(1), capB: s.marketCapUsd ? Math.round(s.marketCapUsd / 1e9) : null, next: s.nextEarnings })));
  console.log(`SOX ${data.index ? data.index.price : '-'} (${data.index ? data.index.changePct?.toFixed(2) : '-'}%) · constituents ${cons.symbols.length} (${cons.method}, ${cons.asOf}) · stocks ${stocks.length} (SOX ${inSox} / non-SOX ${stocks.length - inSox}) · marketCap ${stocks.filter((s) => s.marketCapUsd).length}/${stocks.length}`);
  const FUND_METRICS = ['pe', 'fpe', 'peg', 'pb', 'evEbitda', 'divYield', 'grossMargin', 'opMargin', 'netMargin', 'roe', 'revenueGrowth', 'fcfMargin', 'capexToSales', 'invTurnover', 'dio', 'revenueUsd'];
  console.log(`fundamentals coverage (/${stocks.length}): ` + FUND_METRICS.map((k) => `${k} ${stocks.filter((x) => x.fund && x.fund[k] != null).length}`).join(' · '));
  if (Object.keys(errors).length) console.log('errors:', errors);
}

async function write(data) {
  const body = `/* generated by scripts/fetch-semi-data.mjs — do not edit. Regenerate: node scripts/fetch-semi-data.mjs */\n`
    + `window.SEMI_DATA = ${JSON.stringify(data)};\n`;
  await writeFile(OUT, body, 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUT)} (${Math.round(body.length / 1024)} KB)`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
