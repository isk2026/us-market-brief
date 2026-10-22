#!/usr/bin/env node
/*
 * Fetches market indicators the browser cannot load directly (CORS / bot checks) and writes
 * js/marketData.js as `window.MARKET_DATA = {...}` for the dashboard.
 *
 *   node scripts/fetch-market-data.mjs
 *
 * Primary source for rates / vix / oil is the installed `multi-asset-morning-briefing` skill's
 * helper (scripts/market_data.py: U.S. Treasury, Cboe, FRED). If Python or the skill is missing,
 * or a call fails, the direct fetchers below are used instead. fearGreed (CNN) and aaii (AAII
 * Sentiment Survey) are not covered by the skill and are always fetched directly.
 * Override the helper location with MARKET_DATA_PY (and the interpreter with PYTHON).
 *
 * A failed section keeps the previous snapshot's value marked `stale: true`; nothing is ever fabricated.
 */
import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'js', 'marketData.js');
const KEEP = 40; // observations per daily series
const TIMEOUT_MS = 15000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

// ---------- http ----------
async function fetchText(url, headers = {}, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`${lastError.name === 'TimeoutError' ? 'timeout' : lastError.message} (${new URL(url).host})`);
}
const fetchJson = async (url, headers) => JSON.parse(await fetchText(url, { Accept: 'application/json', ...headers }));

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const usDate = (s) => { const [m, d, y] = s.trim().split('/').map(Number); return `${y}-${pad(m)}-${pad(d)}`; };
const num = (s) => { const v = parseFloat(String(s ?? '').replace(/[,%]/g, '')); return Number.isFinite(v) ? v : null; };
const round = (v, digits = 2) => (v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const nyDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const lastN = (arr, n = KEEP) => arr.slice(-n);

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const split = (line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]);
  return lines.slice(1).map((l) => { const cells = split(l); return Object.fromEntries(header.map((h, i) => [h, cells[i]])); });
}

// ---------- multi-asset-morning-briefing skill helper ----------
const SKILL_PY = process.env.MARKET_DATA_PY
  || path.join(os.homedir(), '.claude', 'skills', 'multi-asset-morning-briefing', 'scripts', 'market_data.py');
const PYTHON = process.env.PYTHON || 'python';
const SKILL_TAG = 'via multi-asset-morning-briefing';

// Runs `python -I market_data.py <subcommand> ...args` and returns its parsed JSON (ok:true) or throws.
async function runSkill(subcommand, args = []) {
  const json = await execSkill(subcommand, args);
  if (!json.ok) throw new Error(`${subcommand}: ${json.error?.message || json.message || 'ok:false'}`);
  if (!Array.isArray(json.rows) || !json.rows.length) throw new Error(`${subcommand}: no rows`);
  return json;
}

// Raw JSON from the skill helper (the `snapshot` command returns an envelope without ok/rows).
async function execSkill(subcommand, args = []) {
  await access(SKILL_PY).catch(() => { throw new Error(`skill helper not found: ${SKILL_PY}`); });
  const stdout = await new Promise((resolve, reject) => {
    execFile(PYTHON, ['-I', SKILL_PY, subcommand, ...args], {
      timeout: 90_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    }, (err, out, errOut) => {
      // The helper prints a JSON error envelope on stdout even when it exits non-zero.
      if (err && !out) reject(new Error(`${subcommand}: ${String(errOut || err.message).trim().split('\n').pop()}`));
      else resolve(out);
    });
  });
  try { return JSON.parse(stdout); } catch { throw new Error(`${subcommand}: non-JSON output`); }
}

// Try the skill first; on any failure use the direct fetcher and record why.
async function withFallback(primary, fallback) {
  try {
    return await primary();
  } catch (skillErr) {
    const result = await fallback();
    return { ...result, note: `skill helper failed, used direct fetch: ${skillErr.message}` };
  }
}

async function ratesFromSkill() {
  const json = await runSkill('yields', ['--last', '45']);
  const rows = json.rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const pick = (key) => lastN(rows.filter((r) => r[key] != null).map((r) => ({ date: r.date, value: r[key] })));
  const last = rows[rows.length - 1];
  return {
    asOf: last.date,
    source: `U.S. Treasury (${SKILL_TAG})`,
    url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve',
    series: { y3m: [], y2: pick('y2'), y10: pick('y10'), y30: pick('y30') },
    latest: {
      spread_2s10s_bp: last.spread_2s10s_bp ?? null,
      d_y2_bp: last.d_y2_bp ?? null,
      d_y10_bp: last.d_y10_bp ?? null,
      d_spread_2s10s_bp: last.d_spread_2s10s_bp ?? null,
      curve: last.curve ?? null,
    },
  };
}

async function vixFromSkill() {
  const json = await runSkill('cboe-vix', ['--last', '45']);
  const series = lastN(json.rows.filter((r) => r.value != null)
    .map((r) => ({ date: r.date, close: round(r.value) })).sort((a, b) => a.date.localeCompare(b.date)));
  return { asOf: series[series.length - 1].date, source: `Cboe (${SKILL_TAG})`, url: 'https://www.cboe.com/tradable_products/vix/', series };
}

async function oilFromSkill() {
  const json = await runSkill('series', ['--ids', 'DCOILWTICO,DCOILBRENTEU', '--last', '45']);
  const rows = json.rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const pick = (id) => lastN(rows.filter((r) => r.values?.[id] != null).map((r) => ({ date: r.date, close: round(r.values[id]) })));
  const wti = pick('DCOILWTICO');
  const brent = pick('DCOILBRENTEU');
  if (!wti.length || !brent.length) throw new Error('series: FRED oil rows had no values');
  const asOf = [wti, brent].map((s) => s[s.length - 1].date).sort().pop();
  return {
    asOf,
    source: `FRED spot WTI/Brent (${SKILL_TAG})`,
    url: 'https://fred.stlouisfed.org/series/DCOILWTICO',
    wti,
    brent,
  };
}

// ---------- direct fetchers (fallbacks for rates/vix/oil; primary for fearGreed/aaii) ----------
async function fetchRates() {
  const treasuryUrl = (y) => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;
  const year = new Date().getFullYear();
  const years = new Date().getMonth() < 3 ? [year - 1, year] : [year];
  const rows = (await Promise.all(years.map(async (y) => parseCsv(await fetchText(treasuryUrl(y)))))).flat();
  const cols = { y3m: '3 Mo', y2: '2 Yr', y10: '10 Yr', y30: '30 Yr' };
  const data = rows.filter((r) => r.Date).map((r) => ({ date: usDate(r.Date), r })).sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) throw new Error('Treasury CSV had no rows');
  const series = Object.fromEntries(Object.entries(cols).map(([key, col]) => [key,
    lastN(data.map(({ date, r }) => ({ date, value: num(r[col]) })).filter((p) => p.value != null))]));
  // Same `latest` fields the skill's `yields` rows carry (spread, 1-day bp moves, curve shape).
  const [p, c] = data.slice(-2).map(({ r }) => ({ y2: num(r[cols.y2]), y10: num(r[cols.y10]) }));
  const d = (a, b) => (a != null && b != null ? round((a - b) * 100, 1) : null);
  const dy2 = p && c ? d(c.y2, p.y2) : null, dy10 = p && c ? d(c.y10, p.y10) : null;
  return {
    asOf: data[data.length - 1].date,
    source: 'U.S. Treasury (direct)',
    url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve',
    series,
    latest: {
      spread_2s10s_bp: c ? d(c.y10, c.y2) : null,
      d_y2_bp: dy2,
      d_y10_bp: dy10,
      d_spread_2s10s_bp: dy2 != null && dy10 != null ? round(dy10 - dy2, 1) : null,
      curve: classifyCurve(dy2, dy10),
    },
  };
}

// Same rule as the skill's classify_curve (1-day 2Y/10Y bp moves).
function classifyCurve(d2, d10) {
  if (d2 == null || d10 == null) return null;
  if ((Math.abs(d2) < 0.05 && Math.abs(d10) < 0.05) || Math.abs(d2 - d10) < 0.05) return 'flat';
  if (d2 > 0 && d10 > 0) return d2 > d10 ? 'bear_flattening' : 'bear_steepening';
  if (d2 < 0 && d10 < 0) return Math.abs(d2) > Math.abs(d10) ? 'bull_steepening' : 'bull_flattening';
  return 'mixed';
}

async function yahooChart(symbol, range = '3mo') {
  const json = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`);
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${symbol}: ${json?.chart?.error?.description || 'no result'}`);
  const closes = r.indicators?.quote?.[0]?.close || [];
  const byDate = new Map(); // one point per NY trading date (the live bar can repeat the last date)
  (r.timestamp || []).forEach((t, i) => { if (closes[i] != null) byDate.set(nyDate(t * 1000), round(closes[i])); });
  const series = [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length) throw new Error(`Yahoo ${symbol}: empty series`);
  return { meta: r.meta || {}, series: lastN(series) };
}

const yahooCloses = async (symbol, range) => (await yahooChart(symbol, range)).series;

// Latest futures quote. prevClose is the last settled close before the quote's trading date
// (meta.chartPreviousClose is the close before the whole range, so it is not used).
async function yahooFuture(symbol) {
  const { meta, series } = await yahooChart(symbol);
  const last = series[series.length - 1];
  const price = round(meta.regularMarketPrice ?? last.close);
  const date = meta.regularMarketTime ? nyDate(meta.regularMarketTime * 1000) : last.date;
  const prevClose = [...series].reverse().find((p) => p.date < date)?.close ?? null;
  const changePct = prevClose ? round(((price - prevClose) / prevClose) * 100) : null;
  return { symbol, price, prevClose, changePct, date, series };
}

async function fetchOilFutures() {
  const [wti, brent] = await Promise.all([yahooFuture('CL=F'), yahooFuture('BZ=F')]);
  return { asOf: new Date().toISOString(), source: 'NYMEX/ICE futures via Yahoo Finance', url: 'https://finance.yahoo.com/quote/CL%3DF/', wti, brent };
}

// Oil section: FRED spot history (skill) stays primary; fresh futures are attached when Yahoo answers.
// A futures failure is recorded separately and never fails the oil section.
const extraErrors = {};
async function fetchOilSection() {
  const base = await withFallback(oilFromSkill, fetchOil);
  try {
    base.futures = await fetchOilFutures();
  } catch (err) {
    extraErrors['oil.futures'] = err.message;
  }
  return base;
}

// ---------- crypto (CoinGecko + Upbit; the app also refreshes BTC live in the browser) ----------
async function fetchCrypto() {
  const [simple, chart, upbit] = await Promise.all([
    fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,krw&include_24hr_change=true&include_last_updated_at=true'),
    fetchJson('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=60&interval=daily'),
    fetchJson('https://api.upbit.com/v1/ticker?markets=KRW-BTC').catch(() => null),
  ]);
  const b = simple?.bitcoin;
  if (!b || num(b.usd) == null) throw new Error('CoinGecko simple/price: no bitcoin price');
  const byDate = new Map(); // UTC day → last price of that day
  (chart?.prices || []).forEach(([ms, price]) => { if (price != null) byDate.set(new Date(ms).toISOString().slice(0, 10), round(price)); });
  const series = [...byDate].map(([date, close]) => ({ date, close })).sort((a, b2) => a.date.localeCompare(b2.date)).slice(-60);
  const upbitKrw = num(Array.isArray(upbit) ? upbit[0]?.trade_price : null);
  const krw = num(b.krw);
  return {
    asOf: b.last_updated_at ? new Date(b.last_updated_at * 1000).toISOString() : new Date().toISOString(),
    source: 'CoinGecko', url: 'https://www.coingecko.com/en/coins/bitcoin',
    btc: {
      usd: round(num(b.usd)), krw: krw == null ? null : Math.round(krw), change24hPct: round(num(b.usd_24h_change)),
      series,
      upbitKrw: upbitKrw == null ? null : Math.round(upbitKrw),
      kimchiPct: upbitKrw != null && krw ? round((upbitKrw / krw - 1) * 100) : null,
    },
  };
}

async function fetchVix() {
  try {
    const rows = parseCsv(await fetchText('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'));
    const series = lastN(rows.filter((r) => r.DATE && num(r.CLOSE) != null)
      .map((r) => ({ date: usDate(r.DATE), close: round(num(r.CLOSE)) })));
    if (!series.length) throw new Error('Cboe CSV had no rows');
    return { asOf: series[series.length - 1].date, source: 'Cboe (direct)', url: 'https://www.cboe.com/tradable_products/vix/', series };
  } catch (err) {
    const series = await yahooCloses('^VIX');
    return { asOf: series[series.length - 1].date, source: 'Cboe via Yahoo Finance (direct)', url: 'https://finance.yahoo.com/quote/%5EVIX/', series, note: `Cboe failed: ${err.message}` };
  }
}

async function fetchOil() {
  const [wti, brent] = await Promise.all([yahooCloses('CL=F'), yahooCloses('BZ=F')]);
  const asOf = [wti, brent].map((s) => s[s.length - 1].date).sort().pop();
  return { asOf, source: 'NYMEX/ICE futures via Yahoo Finance (direct)', url: 'https://finance.yahoo.com/quote/CL%3DF/', wti, brent };
}

async function fetchFearGreed() {
  const json = await fetchJson('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://edition.cnn.com/',
    Origin: 'https://edition.cnn.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
  });
  const fg = json?.fear_and_greed;
  if (!fg || typeof fg.score !== 'number') throw new Error('unexpected CNN payload');
  const byDate = new Map();
  for (const p of json.fear_and_greed_historical?.data || []) {
    if (typeof p.y === 'number') byDate.set(new Date(p.x).toISOString().slice(0, 10), round(p.y, 1));
  }
  return {
    asOf: new Date(fg.timestamp).toISOString(),
    source: 'CNN Business',
    url: 'https://edition.cnn.com/markets/fear-and-greed',
    score: round(fg.score, 1),
    rating: fg.rating,
    previous: {
      close: round(fg.previous_close, 1),
      week: round(fg.previous_1_week, 1),
      month: round(fg.previous_1_month, 1),
      year: round(fg.previous_1_year, 1),
    },
    history: lastN([...byDate].map(([date, score]) => ({ date, score })).sort((a, b) => a.date.localeCompare(b.date))),
  };
}

// AAII's table lists "Oct 14" without a year; infer it as the latest such date not in the future.
function aaiiDate(label, today = new Date()) {
  const d = new Date(`${label} ${today.getFullYear()} 12:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (d > today) d.setFullYear(d.getFullYear() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// AAII runs its survey Thursday→Wednesday and publishes it on Thursday (US Eastern); the table is
// labelled with the Wednesday. Date (YYYY-MM-DD) of the newest survey that should be out by `now`.
function aaiiExpectedDate(now = Date.now()) {
  const today = nyDate(now);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const back = dow >= 4 ? dow - 3 : dow + 4; // Thu–Sat → this Wednesday, Sun–Wed → last week's
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

// Weekly data: between Thursday releases the previous result is still current, so it is reused
// instead of scraping aaii.com on every 15-minute run. From Thursday on it is fetched until the
// new week shows up.
async function fetchAaiiWeekly() {
  const old = previousSnapshot.aaii;
  const expected = aaiiExpectedDate();
  if (old && old.bullish != null && old.asOf >= expected) {
    const { stale, note, ...rest } = old;
    return { ...rest, expected, reused: true };
  }
  const fresh = await fetchAaii();
  return { ...fresh, expected, checkedAt: new Date().toISOString() };
}

async function fetchAaii() {
  const html = await fetchText('https://www.aaii.com/sentimentsurvey/sent_results', { Accept: 'text/html' });
  const tokens = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, '\n')
    .split('\n').map((t) => t.replace(/&nbsp;/g, ' ').trim()).filter(Boolean);
  const start = tokens.findIndex((t) => /^Reported Date$/i.test(t));
  if (start < 0) throw new Error('AAII results table not found (page layout changed or blocked)');
  const rows = [];
  for (let i = start + 4; i + 3 < tokens.length && rows.length < 8; i += 4) {
    const [label, bull, neu, bear] = tokens.slice(i, i + 4);
    if (!/^[A-Z][a-z]{2} \d{1,2}$/.test(label) || ![bull, neu, bear].every((v) => /%$/.test(v))) break;
    rows.push({ date: aaiiDate(label), bullish: num(bull), neutral: num(neu), bearish: num(bear) });
  }
  if (!rows.length) throw new Error('AAII table had no parseable rows');
  const latest = rows[0];
  return {
    asOf: latest.date,
    source: 'AAII',
    url: 'https://www.aaii.com/sentimentsurvey',
    bullish: latest.bullish,
    neutral: latest.neutral,
    bearish: latest.bearish,
    history: rows.slice().reverse(),
    averages: { bullish: 37.5, neutral: 31.5, bearish: 31.0 }, // AAII long-term historical averages
  };
}

// ---------- major-company earnings (Nasdaq calendar) ----------
const NASDAQ_HEADERS = { Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const MIN_MARKET_CAP = 50e9;
const WATCHLIST = new Set((process.env.WATCHLIST || 'AAPL,NVDA,MSFT,TSLA').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
// Share classes reported together: keep the preferred listing.
const PREFERRED_CLASS = { GOOG: 'GOOGL', 'BRK.A': 'BRK.B', 'BRK/A': 'BRK/B', FOX: 'FOXA', NWS: 'NWSA' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// '$2.02' → 2.02, '($0.12)' → -0.12, '$322,972,451,000' → 322972451000, '' / 'N/A' → null
const money = (s) => {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const v = num(t.replace(/[$()]/g, ''));
  return v == null ? null : (/^\(.*\)$/.test(t) || t.startsWith('-') ? -Math.abs(v) : v);
};
const addDaysKey = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function mapLimit(items, limit, fn, delayMs = 0) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { ok: true, value: await fn(items[i]) }; } catch (err) { out[i] = { ok: false, error: err }; }
      if (delayMs) await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function earningsDay(date) {
  const j = await fetchJson(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, NASDAQ_HEADERS);
  return (j?.data?.rows || []).map((r) => ({
    symbol: String(r.symbol || '').trim().toUpperCase(),
    name: String(r.name || '').trim(),
    date,
    session: r.time === 'time-pre-market' ? 'bmo' : r.time === 'time-after-hours' ? 'amc' : null,
    marketCap: money(r.marketCap),
    fiscalQuarter: r.fiscalQuarterEnding || null,
    epsForecast: money(r.epsForecast),
    noOfEsts: num(r.noOfEsts),
    lastYearEPS: money(r.lastYearEPS),
    epsActual: null,
    surprisePct: null,
  })).filter((r) => r.symbol);
}

function dedupeShareClasses(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.name.toLowerCase()}|${r.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const preferred = g.find((r) => Object.values(PREFERRED_CLASS).includes(r.symbol) && g.some((o) => PREFERRED_CLASS[o.symbol] === r.symbol));
    return preferred || g[0];
  });
}

// Actual EPS + surprise from Nasdaq's earnings-surprise table (matched to the report date ±3 days).
async function earningsSurprise(item) {
  const j = await fetchJson(`https://api.nasdaq.com/api/company/${encodeURIComponent(item.symbol)}/earnings-surprise`, NASDAQ_HEADERS);
  const rows = j?.data?.earningsSurpriseTable?.rows || [];
  const target = Date.parse(`${item.date}T00:00:00Z`);
  const hit = rows.find((r) => {
    if (!r.dateReported) return false;
    const d = Date.parse(`${usDate(r.dateReported)}T00:00:00Z`);
    return Math.abs(d - target) <= 3 * 86400e3;
  });
  return hit ? { epsActual: money(hit.eps), surprisePct: num(hit.percentageSurprise) } : null;
}

async function fetchEarnings() {
  const today = nyDate(Date.now());
  const from = addDaysKey(today, -14);
  const to = addDaysKey(today, 21);
  const dates = [];
  for (let k = from; k <= to; k = addDaysKey(k, 1)) {
    const dow = new Date(`${k}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(k);
  }
  const days = await mapLimit(dates, 4, earningsDay, 150);
  const failedDates = dates.filter((_, i) => !days[i].ok);
  if (failedDates.length === dates.length) throw new Error(`all ${dates.length} calendar requests failed: ${days[0].error?.message}`);

  const rows = days.flatMap((d) => (d.ok ? d.value : []))
    .filter((r) => (r.marketCap ?? 0) >= MIN_MARKET_CAP || WATCHLIST.has(r.symbol));
  const items = dedupeShareClasses(rows)
    .sort((a, b) => a.date.localeCompare(b.date) || (b.marketCap ?? 0) - (a.marketCap ?? 0));

  // Already reported: past dates, or today's pre-market reports.
  const reported = items.filter((it) => it.date < today || (it.date === today && it.session === 'bmo'));
  const surprises = await mapLimit(reported, 3, earningsSurprise, 100);
  let matched = 0;
  surprises.forEach((s, i) => {
    if (s.ok && s.value) { Object.assign(reported[i], s.value); matched++; }
  });

  const notes = [];
  if (failedDates.length) notes.push(`${failedDates.length}/${dates.length} calendar dates failed (${failedDates.join(', ')})`);
  if (reported.length && matched === 0) notes.push(`actual EPS unavailable: Nasdaq earnings-surprise returned no records for ${reported.length} reported items`);
  else if (reported.length) notes.push(`actual EPS matched for ${matched}/${reported.length} reported items`);

  return {
    asOf: today,
    source: 'Nasdaq',
    url: 'https://www.nasdaq.com/market-activity/earnings',
    from,
    to,
    minMarketCap: MIN_MARKET_CAP,
    items,
    ...(notes.length ? { note: notes.join('; ') } : {}),
  };
}

// ---------- main ----------
// ---- Global equity indices (Yahoo Finance; KOSPI/KOSDAQ official closes via the skill's ECOS snapshot) ----
const GLOBAL_INDICES = [
  { key: 'kospi', symbol: '^KS11', name: '코스피', nameEn: 'KOSPI', region: 'asia', country: 'KR' },
  { key: 'kosdaq', symbol: '^KQ11', name: '코스닥', nameEn: 'KOSDAQ', region: 'asia', country: 'KR' },
  { key: 'nikkei', symbol: '^N225', name: '닛케이 225', nameEn: 'Nikkei 225', region: 'asia', country: 'JP' },
  { key: 'hangseng', symbol: '^HSI', name: '항셍', nameEn: 'Hang Seng', region: 'asia', country: 'HK' },
  { key: 'shanghai', symbol: '000001.SS', name: '상하이 종합', nameEn: 'SSE Composite', region: 'asia', country: 'CN' },
  { key: 'taiex', symbol: '^TWII', name: '대만 가권', nameEn: 'TAIEX', region: 'asia', country: 'TW' },
  { key: 'stoxx600', symbol: '^STOXX', name: 'STOXX 600', nameEn: 'STOXX Europe 600', region: 'europe', country: 'EU' },
  { key: 'eurostoxx50', symbol: '^STOXX50E', name: '유로 STOXX 50', nameEn: 'EURO STOXX 50', region: 'europe', country: 'EU' },
  { key: 'ftse', symbol: '^FTSE', name: '영국 FTSE 100', nameEn: 'FTSE 100', region: 'europe', country: 'GB' },
  { key: 'dax', symbol: '^GDAXI', name: '독일 DAX', nameEn: 'DAX', region: 'europe', country: 'DE' },
  { key: 'cac', symbol: '^FCHI', name: '프랑스 CAC 40', nameEn: 'CAC 40', region: 'europe', country: 'FR' },
  { key: 'sp500', symbol: '^GSPC', name: 'S&P 500', nameEn: 'S&P 500', region: 'americas', country: 'US' },
  { key: 'nasdaq', symbol: '^IXIC', name: '나스닥 종합', nameEn: 'NASDAQ Composite', region: 'americas', country: 'US' },
  { key: 'dow', symbol: '^DJI', name: '다우존스', nameEn: 'Dow Jones Industrial Average', region: 'americas', country: 'US' },
  { key: 'ndx', symbol: '^NDX', name: '나스닥 100', nameEn: 'NASDAQ-100', region: 'americas', country: 'US' },
  { key: 'rut', symbol: '^RUT', name: '러셀 2000', nameEn: 'Russell 2000', region: 'americas', country: 'US' },
  { key: 'sox', symbol: '^SOX', name: '필라델피아 반도체', nameEn: 'PHLX Semiconductor (SOX)', region: 'americas', country: 'US' },
  // CME E-mini futures (front month) trade ~23h a day, so they show overnight moves before the US cash open.
  { key: 'es', symbol: 'ES=F', name: 'S&P 500 선물', nameEn: 'E-mini S&P 500 Futures', region: 'americas', country: 'US', futures: true },
  { key: 'nq', symbol: 'NQ=F', name: '나스닥 100 선물', nameEn: 'E-mini Nasdaq-100 Futures', region: 'americas', country: 'US', futures: true },
];
const localDate = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

async function yahooIndex(def) {
  const json = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=1y&interval=1d`);
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${def.symbol}: ${json?.chart?.error?.description || 'no result'}`);
  const m = r.meta || {};
  const tz = m.exchangeTimezoneName || 'UTC';
  const closes = r.indicators?.quote?.[0]?.close || [];
  const byDate = new Map(); // one point per exchange-local trading date (the live bar can repeat the last date)
  (r.timestamp || []).forEach((t, i) => { if (closes[i] != null) byDate.set(localDate(t * 1000, tz), round(closes[i])); });
  const price = m.regularMarketPrice;
  if (price == null || !m.regularMarketTime) throw new Error(`Yahoo ${def.symbol}: no regularMarketPrice`);
  const sessionDate = localDate(m.regularMarketTime * 1000, tz);
  byDate.set(sessionDate, round(price)); // the latest quote is this session's value
  const series = [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
  // Previous SESSION close (meta.chartPreviousClose is the close before the 1y range, not yesterday).
  const prev = [...series].reverse().find((p) => p.date < sessionDate);
  const prevClose = prev ? prev.close : null;
  return {
    ...def, currency: m.currency || null, tz,
    price: round(price), prevClose,
    change: prevClose == null ? null : round(price - prevClose),
    changePct: prevClose == null ? null : round(((price - prevClose) / prevClose) * 100),
    marketTime: new Date(m.regularMarketTime * 1000).toISOString(), sessionDate,
    series,
  };
}

// Official KOSPI/KOSDAQ closes from Bank of Korea ECOS, read through the skill's `snapshot` command.
async function ecosOfficialCloses() {
  const briefingDate = localDate(Date.now(), 'Asia/Seoul');
  const json = await execSkill('snapshot', ['--briefing-date', briefingDate]);
  const out = {};
  for (const it of json.items || []) {
    if ((it.symbol === 'KOSPI' || it.symbol === 'KOSDAQ') && it.value != null) {
      out[it.symbol.toLowerCase()] = { date: it.observed || it.session, close: it.value, source: `한국은행 ECOS (${SKILL_TAG})` };
    }
  }
  if (!Object.keys(out).length) throw new Error('snapshot: no KOSPI/KOSDAQ observation');
  return out;
}

async function fetchGlobalIndices() {
  const [results, official] = await Promise.all([
    mapLimit(GLOBAL_INDICES, 4, yahooIndex),
    ecosOfficialCloses().catch((err) => ({ __error: err.message })),
  ]);
  const items = [];
  results.forEach((r, i) => {
    const def = GLOBAL_INDICES[i];
    if (!r.ok) { extraErrors[`globalIndices.${def.key}`] = r.error?.message || String(r.error); return; }
    // Without ECOS (e.g. on GitHub Actions, where the skill is not installed) keep the last official close.
    const off = official[def.key] || previousSnapshot.globalIndices?.items?.find((it) => it.key === def.key)?.official;
    items.push(off ? { ...r.value, official: off } : r.value);
  });
  if (!items.length) throw new Error('all global index fetches failed');
  return {
    asOf: new Date().toISOString(),
    source: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/markets/world-indices/',
    ...(official.__error ? { note: `ECOS official close unavailable: ${official.__error}` } : {}),
    items,
  };
}

async function readPrevious() {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(await readFile(OUT, 'utf8'), sandbox);
    return sandbox.window.MARKET_DATA || {};
  } catch {
    return {};
  }
}

const SECTIONS = {
  rates: () => withFallback(ratesFromSkill, fetchRates),
  vix: () => withFallback(vixFromSkill, fetchVix),
  oil: fetchOilSection,
  fearGreed: fetchFearGreed,
  aaii: fetchAaiiWeekly,
  earnings: fetchEarnings,
  crypto: fetchCrypto,
  globalIndices: fetchGlobalIndices,
};

function latestLabel(key, s) {
  if (!s) return '-';
  switch (key) {
    case 'rates': return `2Y ${s.series.y2.at(-1)?.value}% · 10Y ${s.series.y10.at(-1)?.value}% · 30Y ${s.series.y30.at(-1)?.value}%`;
    case 'vix': return `${s.series.at(-1).close}`;
    case 'oil': {
      const spot = `spot WTI $${s.wti.at(-1).close} · Brent $${s.brent.at(-1).close}`;
      const f = s.futures;
      const pct = (v) => (v == null ? '' : ` (${v > 0 ? '+' : ''}${v}%)`);
      return f ? `${spot} | fut WTI $${f.wti.price}${pct(f.wti.changePct)} · Brent $${f.brent.price}${pct(f.brent.changePct)}` : `${spot} | futures n/a`;
    }
    case 'crypto': {
      const b = s.btc;
      return `BTC $${b.usd} · ₩${b.krw}${b.change24hPct == null ? '' : ` (24h ${b.change24hPct > 0 ? '+' : ''}${b.change24hPct}%)`}`
        + `${b.kimchiPct == null ? '' : ` · kimchi ${b.kimchiPct > 0 ? '+' : ''}${b.kimchiPct}%`}`;
    }
    case 'fearGreed': return `${s.score} (${s.rating})`;
    case 'aaii': return `강세 ${s.bullish}% · 중립 ${s.neutral}% · 약세 ${s.bearish}%`;
    case 'earnings': {
      const upcoming = s.items.filter((it) => it.date >= s.asOf && !(it.date === s.asOf && it.session === 'bmo'))
        .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, 3).map((it) => `${it.symbol} ${it.date.slice(5)}`);
      const reported = s.items.filter((it) => it.epsActual != null).length;
      return `${s.items.length} items · ${reported} w/ actual · next: ${upcoming.join(', ')}`;
    }
    case 'globalIndices': {
      const pick = ['kospi', 'nikkei', 'stoxx600', 'sp500'].map((k) => s.items.find((it) => it.key === k)).filter(Boolean);
      const off = s.items.filter((it) => it.official).length;
      return `${s.items.length} indices · ` + pick.map((it) => `${it.nameEn} ${it.price}${it.changePct == null ? '' : ` (${it.changePct > 0 ? '+' : ''}${it.changePct}%)`}`).join(' · ')
        + ` · ECOS ${off ? `${off} official` : 'n/a'}`;
    }
    default: return '';
  }
}

// Previous snapshot, for sections that reuse or carry over earlier values (AAII, ECOS closes).
let previousSnapshot = {};

async function main() {
  const previous = previousSnapshot = await readPrevious();
  const results = await Promise.allSettled(Object.values(SECTIONS).map((fn) => fn()));
  const data = { generatedAt: new Date().toISOString() };
  const errors = {};
  const summary = [];
  let ok = 0;

  Object.keys(SECTIONS).forEach((key, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      data[key] = r.value;
      ok++;
      summary.push({ section: key, status: r.value.reused ? 'ok (weekly, reused)' : r.value.note && key !== 'earnings' && key !== 'globalIndices' ? 'ok (fallback)' : 'ok', source: r.value.source, asOf: r.value.asOf, latest: latestLabel(key, r.value) });
      return;
    }
    const message = r.reason?.message || String(r.reason);
    errors[key] = message;
    const old = previous[key];
    data[key] = old ? { ...old, stale: true } : null;
    summary.push({ section: key, status: old ? 'stale (kept previous)' : 'failed', asOf: old?.asOf || '-', latest: message });
  });
  // Sub-section failures (e.g. oil.futures) that did not fail their parent section.
  for (const [key, message] of Object.entries(extraErrors)) {
    errors[key] = message;
    summary.push({ section: key, status: 'failed (section kept)', asOf: '-', latest: message });
  }
  data.errors = errors;

  const body = `/* generated by scripts/fetch-market-data.mjs — do not edit. Regenerate: node scripts/fetch-market-data.mjs */\n`
    + `window.MARKET_DATA = ${JSON.stringify(data)};\n`;
  await writeFile(OUT, body, 'utf8');

  console.table(summary);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${ok}/${Object.keys(SECTIONS).length} sections fresh)`);
  process.exit(ok > 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
