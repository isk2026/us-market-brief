#!/usr/bin/env node
/*
 * Macro snapshot for the 채권/금리/환율/원자재 tab → js/macroData.js (window.MACRO_DATA).
 *
 *   node scripts/fetch-macro-data.mjs
 *
 * Sources (skill first where it covers the data, per user preference):
 * - multi-asset-morning-briefing skill (market_data.py):
 *     `series` (FRED): policy rate DFEDTARU/DFEDTARL, real 10Y DFII10, breakeven T10YIE,
 *                      HY/IG OAS BAMLH0A0HYM2/BAMLC0A0CM, OECD 10Y KR/DE/JP/GB (monthly)
 *     `yields`: curve shape label; `ecb-fx`: ECB reference rates (falls back to the ECB API directly).
 * - U.S. Treasury daily par yield CSV (full curve, history, spreads) — the skill only exposes 2/10/30Y.
 * - Yahoo Finance chart (FX, commodities, bond ETFs) + quoteSummary (ETF yield/expense, cookie + crumb).
 * Failed sections keep the previous snapshot's values with stale:true. Zero dependencies (Node 18+).
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'js', 'macroData.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT = 20000;
const KEEP_POINTS = 126;   // instrument series
const KEEP_RATES = 252;    // rate history

const errors = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);
const localDate = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const shiftKey = (key, days) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };

// ---------- http ----------
async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}
async function getText(url, opts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await http(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 1) throw err;
      await sleep(800);
    }
  }
}
const getJson = async (url, opts) => JSON.parse(await getText(url, opts));
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

// ---------- multi-asset-morning-briefing skill ----------
const SKILL_PY = process.env.MARKET_DATA_PY
  || path.join(os.homedir(), '.claude', 'skills', 'multi-asset-morning-briefing', 'scripts', 'market_data.py');
const PYTHON = process.env.PYTHON || 'python';
const SKILL_TAG = 'via multi-asset-morning-briefing';
const skillUsed = new Set();

async function runSkill(subcommand, args = []) {
  await access(SKILL_PY).catch(() => { throw new Error(`skill helper not found: ${SKILL_PY}`); });
  const stdout = await new Promise((resolve, reject) => {
    execFile(PYTHON, ['-I', SKILL_PY, subcommand, ...args], {
      timeout: 90_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }, (err, out, errOut) => {
      if (err && !out) {
        // Some failures print the JSON error envelope on stderr.
        let msg = String(errOut || err.message).trim();
        try { msg = JSON.parse(msg).error?.message || msg; } catch { msg = msg.split('\n').pop(); }
        reject(new Error(`${subcommand}: ${msg}`));
      } else resolve(out);
    });
  });
  let json;
  try { json = JSON.parse(stdout); } catch { throw new Error(`${subcommand}: non-JSON output`); }
  if (!json.ok) throw new Error(`${subcommand}: ${json.error?.message || 'ok:false'}`);
  if (!Array.isArray(json.rows) || !json.rows.length) throw new Error(`${subcommand}: no rows`);
  skillUsed.add(subcommand);
  return json;
}

// FRED via the skill: { id: [{date, value}] } with nulls dropped.
async function fredSeries(ids, last) {
  const j = await runSkill('series', ['--ids', ids.join(','), '--last', String(last)]);
  const out = Object.fromEntries(ids.map((id) => [id, []]));
  for (const row of j.rows) {
    for (const id of ids) {
      const v = row.values ? row.values[id] : null;
      if (v != null && !Number.isNaN(v)) out[id].push({ date: row.date, value: round(v, 3) });
    }
  }
  return out;
}
const latest = (s) => (s && s.length ? s[s.length - 1] : null);
const fredPoint = (s, keep = KEEP_RATES) => {
  const l = latest(s);
  return l ? { value: l.value, asOf: l.date, series: s.slice(-keep).map((p) => ({ date: p.date, value: round(p.value, 2) })) } : null;
};

// ---------- U.S. Treasury curve ----------
const TENORS = [
  ['1M', '1개월', '1 Mo'], ['3M', '3개월', '3 Mo'], ['6M', '6개월', '6 Mo'], ['1Y', '1년', '1 Yr'], ['2Y', '2년', '2 Yr'], ['3Y', '3년', '3 Yr'],
  ['5Y', '5년', '5 Yr'], ['7Y', '7년', '7 Yr'], ['10Y', '10년', '10 Yr'], ['20Y', '20년', '20 Yr'], ['30Y', '30년', '30 Yr'],
];
const TREASURY_URL = (y) => 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/'
  + `${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;

function parseTreasury(text) {
  const lines = text.trim().split(/\r?\n/);
  const split = (l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const c = split(l);
    const [m, d, y] = (c[head.indexOf('Date')] || '').split('/');
    if (!y) return null;
    const row = { date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` };
    for (const [key, , col] of TENORS) {
      const i = head.indexOf(col);
      const v = i >= 0 ? parseFloat(c[i]) : NaN;
      row[key] = Number.isNaN(v) ? null : v;
    }
    return row;
  }).filter(Boolean);
}

async function fetchRates(prev) {
  const year = new Date().getUTCFullYear();
  const texts = await Promise.all([year - 1, year].map((y) => getText(TREASURY_URL(y))));
  const rows = texts.flatMap(parseTreasury).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error('Treasury CSV empty');
  const last = rows[rows.length - 1];
  const onOrBefore = (key) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].date <= key) return rows[i]; return null; };
  const pick = (r) => (r ? Object.fromEntries(TENORS.map(([k]) => [k, r[k]])) : null);
  const mAgo = onOrBefore(shiftKey(last.date, 30)), yAgo = onOrBefore(shiftKey(last.date, 365));
  const bp = (a, b) => (a != null && b != null ? Math.round((a - b) * 100) : null);
  const hist = rows.slice(-KEEP_RATES);
  const rates = {
    curve: {
      asOf: last.date, source: 'U.S. Treasury',
      url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve',
      tenors: TENORS.map(([key, label]) => ({ key, label })),
      today: pick(last), monthAgo: pick(mAgo), yearAgo: pick(yAgo),
      dates: { today: last.date, monthAgo: mAgo?.date || null, yearAgo: yAgo?.date || null },
    },
    history: {
      y3m: hist.filter((r) => r['3M'] != null).map((r) => ({ date: r.date, value: r['3M'] })),
      y2: hist.filter((r) => r['2Y'] != null).map((r) => ({ date: r.date, value: r['2Y'] })),
      y10: hist.filter((r) => r['10Y'] != null).map((r) => ({ date: r.date, value: r['10Y'] })),
    },
    spreads: {
      s2s10: { value: bp(last['10Y'], last['2Y']), change1m: mAgo ? bp(last['10Y'], last['2Y']) - bp(mAgo['10Y'], mAgo['2Y']) : null },
      s3m10y: { value: bp(last['10Y'], last['3M']), change1m: mAgo ? bp(last['10Y'], last['3M']) - bp(mAgo['3M'] != null ? mAgo['10Y'] : null, mAgo['3M']) : null },
      curveLabel: null,
    },
    policy: null, real10y: null, breakeven10y: null, credit: { hy: null, ig: null }, global10y: [],
  };

  // Curve shape label from the skill (bear_steepen, bull_flatten, mixed, …).
  try {
    const y = await runSkill('yields', ['--last', '5']);
    rates.spreads.curveLabel = y.rows[y.rows.length - 1].curve || null;
  } catch (err) { errors['rates.curveLabel'] = err.message; }

  // FRED via the skill.
  try {
    const f = await fredSeries(['DFEDTARU', 'DFEDTARL'], 10);
    const u = latest(f.DFEDTARU), l = latest(f.DFEDTARL);
    rates.policy = u && l ? { upper: u.value, lower: l.value, asOf: u.date, source: `FRED DFEDTARU/DFEDTARL (${SKILL_TAG})` } : null;
    if (!rates.policy) errors['rates.policy'] = 'no observations';
  } catch (err) { errors['rates.policy'] = err.message; rates.policy = prev?.rates?.policy ? { ...prev.rates.policy, stale: true } : null; }

  try {
    const f = await fredSeries(['DFII10', 'T10YIE', 'BAMLH0A0HYM2', 'BAMLC0A0CM'], 260);
    rates.real10y = fredPoint(f.DFII10);
    rates.breakeven10y = fredPoint(f.T10YIE);
    rates.credit = { hy: fredPoint(f.BAMLH0A0HYM2), ig: fredPoint(f.BAMLC0A0CM) };
    for (const [k, v] of [['real10y', rates.real10y], ['breakeven10y', rates.breakeven10y], ['credit.hy', rates.credit.hy], ['credit.ig', rates.credit.ig]]) {
      if (!v) errors[`rates.${k}`] = 'no observations';
    }
  } catch (err) {
    errors['rates.fred'] = err.message;
    const p = prev?.rates;
    const st = (x) => (x ? { ...x, stale: true } : null);
    rates.real10y = st(p?.real10y); rates.breakeven10y = st(p?.breakeven10y);
    rates.credit = { hy: st(p?.credit?.hy), ig: st(p?.credit?.ig) };
  }

  rates.global10y.push({ country: 'US', label: '미국', value: last['10Y'], asOf: last.date, frequency: 'daily', source: 'U.S. Treasury' });
  const OECD = [['KR', '한국', 'IRLTLT01KRM156N'], ['DE', '독일', 'IRLTLT01DEM156N'], ['JP', '일본', 'IRLTLT01JPM156N'], ['GB', '영국', 'IRLTLT01GBM156N']];
  try {
    const f = await fredSeries(OECD.map((o) => o[2]), 6);
    for (const [country, label, id] of OECD) {
      const l = latest(f[id]);
      if (l) rates.global10y.push({ country, label, value: round(l.value, 2), asOf: l.date, frequency: 'monthly', source: `OECD via FRED ${id} (${SKILL_TAG})` });
      else errors[`rates.global10y.${country}`] = 'no observations';
    }
  } catch (err) {
    errors['rates.global10y'] = err.message;
    for (const g of prev?.rates?.global10y || []) if (g.country !== 'US') rates.global10y.push({ ...g, stale: true });
  }
  return rates;
}

// ---------- Yahoo instruments ----------
async function chart(symbol, digits) {
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.meta) throw new Error('empty chart');
  const m = r.meta;
  const tz = m.exchangeTimezoneName || 'UTC';
  const closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  let series = (r.timestamp || []).map((ts, i) => ({ date: localDate(ts * 1000, tz), close: closes[i] }))
    .filter((p) => p.close != null && !Number.isNaN(p.close));
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
    price: round(price, digits),
    change: prevClose != null ? round(price - prevClose, digits) : null,
    changePct: round(pct(price, prevClose), 2),
    sessionDate,
    marketTime: marketMs ? new Date(marketMs).toISOString() : null,
    r: {
      w1: round(pct(price, onOrBefore(shiftKey(sessionDate, 7))), 2),
      m1: round(pct(price, onOrBefore(shiftKey(sessionDate, 30))), 2),
      m3: round(pct(price, onOrBefore(shiftKey(sessionDate, 91))), 2),
      ytd: round(pct(price, onOrBefore(`${Number(sessionDate.slice(0, 4)) - 1}-12-31`)), 2),
      y1: round(pct(price, onOrBefore(shiftKey(sessionDate, 365))), 2),
    },
    high52: yearCloses.length ? round(Math.max(...yearCloses, price), digits) : null,
    low52: yearCloses.length ? round(Math.min(...yearCloses, price), digits) : null,
    series: series.slice(-KEEP_POINTS).map((p) => ({ date: p.date, close: round(p.close, digits) })),
    fullSeries: series, // used for ratios; stripped before writing
  };
}

const FX = [
  ['dxy', 'DX-Y.NYB', '달러 인덱스', 'DXY'], ['usdkrw', 'KRW=X', '원/달러', 'USD/KRW'], ['usdjpy', 'JPY=X', '엔/달러', 'USD/JPY'],
  ['eurusd', 'EURUSD=X', '유로/달러', 'EUR/USD'], ['usdcny', 'CNY=X', '위안/달러', 'USD/CNY'], ['gbpusd', 'GBPUSD=X', '파운드/달러', 'GBP/USD'],
];
const COMMODITIES = [
  ['wti', 'CL=F', 'WTI', 'energy', '$/배럴'], ['brent', 'BZ=F', '브렌트', 'energy', '$/배럴'], ['natgas', 'NG=F', '천연가스', 'energy', '$/MMBtu'],
  ['gold', 'GC=F', '금', 'metals', '$/온스'], ['silver', 'SI=F', '은', 'metals', '$/온스'], ['copper', 'HG=F', '구리', 'metals', '$/파운드'],
  ['corn', 'ZC=F', '옥수수', 'agri', '¢/부셸'], ['wheat', 'ZW=F', '밀', 'agri', '¢/부셸'], ['soybean', 'ZS=F', '대두', 'agri', '¢/부셸'],
];
const BOND_ETFS = [
  ['tlt', 'TLT', '미국 장기국채 (20년+)'], ['ief', 'IEF', '미국 중기국채 (7–10년)'], ['shy', 'SHY', '미국 단기국채 (1–3년)'],
  ['agg', 'AGG', '미국 종합채권'], ['lqd', 'LQD', '투자등급 회사채'], ['hyg', 'HYG', '하이일드 회사채'], ['tip', 'TIP', '물가연동국채 (TIPS)'],
];

async function instruments(defs, build, digits, label, prevList) {
  const prevByKey = new Map((prevList || []).map((x) => [x.key, x]));
  const out = await pool(defs, 4, async (def) => {
    try {
      return { ...build(def), ...(await chart(def[1], digits)) };
    } catch (err) {
      errors[`${label}.${def[0]}`] = err.message;
      const p = prevByKey.get(def[0]);
      return p ? { ...p, stale: true } : null;
    }
  });
  return out.filter(Boolean);
}

// ---------- Yahoo session for quoteSummary (cookie + crumb; memory only, never written) ----------
let sessionPromise = null;
function yahooSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
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
  return sessionPromise;
}
const raw = (o) => (o && typeof o === 'object' ? o.raw ?? null : o ?? null);

async function etfInfo(symbol) {
  const { cookie, crumb } = await yahooSession();
  const j = await getJson(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,defaultKeyStatistics,fundProfile&crumb=${encodeURIComponent(crumb)}`,
    { headers: { Cookie: cookie } });
  const r = j?.quoteSummary?.result?.[0];
  if (!r) throw new Error('empty quoteSummary');
  const sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fp = r.fundProfile || {};
  const expense = raw(fp.feesExpensesInvestment?.annualReportExpenseRatio) ?? raw(ks.annualReportExpenseRatio);
  const y = raw(sd.yield) ?? raw(ks.yield);
  return {
    yield: y != null ? round(y * 100, 2) : null,
    expenseRatio: expense != null ? round(expense * 100, 3) : null,
    duration: null, // Yahoo does not publish effective duration for these funds
    aum: raw(sd.totalAssets) ?? raw(ks.totalAssets) ?? null,
  };
}

// ---------- ratios ----------
function ratioSeries(aSeries, bSeries, fn) {
  const b = new Map(bSeries.map((p) => [p.date, p.close]));
  const s = aSeries.filter((p) => b.has(p.date)).map((p) => ({ date: p.date, value: round(fn(p.close, b.get(p.date)), 2) }));
  return s.length ? { value: s[s.length - 1].value, asOf: s[s.length - 1].date, series: s.slice(-KEEP_POINTS) } : null;
}

// ---------- ECB reference rates (skill first, ECB API fallback) ----------
async function ecbFx(prev) {
  try {
    const j = await runSkill('ecb-fx', ['--last', '5']);
    const row = j.rows[j.rows.length - 1];
    const rates = row.rates || row.values || {};
    const pick = (c) => rates[c] ?? row[c] ?? row[c.toLowerCase()] ?? null;
    const out = { USD: pick('USD'), JPY: pick('JPY'), GBP: pick('GBP') };
    if (Object.values(out).every((v) => v == null)) throw new Error('ecb-fx: unexpected row shape');
    return { asOf: row.date, source: `ECB (${SKILL_TAG})`, rates: out };
  } catch (skillErr) {
    try {
      const end = new Date().toISOString().slice(0, 10), start = shiftKey(end, 14);
      const csv = await getText(`https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+GBP.EUR.SP00.A?format=csvdata&startPeriod=${start}&endPeriod=${end}`);
      const lines = csv.trim().split(/\r?\n/);
      const head = lines[0].split(',');
      const iCur = head.indexOf('CURRENCY'), iDate = head.indexOf('TIME_PERIOD'), iVal = head.indexOf('OBS_VALUE');
      const lastBy = {};
      for (const l of lines.slice(1)) {
        const c = l.split(',');
        const cur = c[iCur], date = c[iDate], v = parseFloat(c[iVal]);
        if (!cur || Number.isNaN(v)) continue;
        if (!lastBy[cur] || lastBy[cur].date < date) lastBy[cur] = { date, v };
      }
      if (!lastBy.USD) throw new Error('ECB CSV without USD');
      return { asOf: lastBy.USD.date, source: 'ECB (direct)', note: `skill ecb-fx failed, used ECB API directly: ${skillErr.message.slice(0, 160)}`,
        rates: { USD: lastBy.USD?.v ?? null, JPY: lastBy.JPY?.v ?? null, GBP: lastBy.GBP?.v ?? null } };
    } catch (err) {
      errors.ecbFx = `${skillErr.message.slice(0, 120)} / direct: ${err.message}`;
      return prev?.ecbFx ? { ...prev.ecbFx, stale: true } : null;
    }
  }
}

// ---------- main ----------
async function readPrevious() {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(await readFile(OUT, 'utf8'), sandbox);
    return sandbox.window.MACRO_DATA || null;
  } catch { return null; }
}

async function main() {
  const prev = await readPrevious();
  const ok = {};

  let rates;
  try { rates = await fetchRates(prev); ok.rates = true; } catch (err) {
    errors.rates = err.message;
    rates = prev?.rates ? { ...prev.rates, stale: true } : null;
  }

  const [fx, commodities, bondEtfs] = await Promise.all([
    instruments(FX, ([key, symbol, name, pair]) => ({ key, symbol, name, pair }), 4, 'fx', prev?.fx),
    instruments(COMMODITIES, ([key, symbol, name, group, unit]) => ({ key, symbol, name, group, unit }), 2, 'commodities', prev?.commodities),
    instruments(BOND_ETFS, ([key, symbol, name]) => ({ key, symbol, name, unit: '$' }), 2, 'bondEtfs', prev?.bondEtfs),
  ]);

  await pool(bondEtfs.filter((e) => !e.stale), 3, async (e) => {
    try { Object.assign(e, await etfInfo(e.symbol)); } catch (err) {
      errors[`bondEtfs.${e.key}.info`] = err.message;
      Object.assign(e, { yield: null, expenseRatio: null, duration: null });
    }
  });

  const com = Object.fromEntries(commodities.map((c) => [c.key, c]));
  let ratios = { goldSilver: null, copperGold: null };
  if (com.gold?.fullSeries && com.silver?.fullSeries) ratios.goldSilver = ratioSeries(com.gold.fullSeries, com.silver.fullSeries, (g, s) => g / s);
  if (com.copper?.fullSeries && com.gold?.fullSeries) ratios.copperGold = ratioSeries(com.copper.fullSeries, com.gold.fullSeries, (c, g) => (c / g) * 1000);
  if (!ratios.goldSilver && !ratios.copperGold && prev?.ratios) ratios = { ...prev.ratios, stale: true };

  const ecb = await ecbFx(prev);
  for (const list of [fx, commodities, bondEtfs]) for (const x of list) delete x.fullSeries;

  const data = { generatedAt: new Date().toISOString(), rates, fx, commodities, bondEtfs, ratios, ecbFx: ecb, errors };
  const body = '/* generated by scripts/fetch-macro-data.mjs — do not edit. Regenerate: node scripts/fetch-macro-data.mjs */\n'
    + `window.MACRO_DATA = ${JSON.stringify(data)};\n`;
  const anyFresh = ok.rates || fx.some((x) => !x.stale) || commodities.some((x) => !x.stale);
  if (!anyFresh) {
    console.error('All sections failed; keeping existing js/macroData.js');
    console.error(errors);
    process.exit(1);
  }
  await writeFile(OUT, body, 'utf8');

  const has = (v) => (v == null ? '—' : v);
  console.table([
    { section: 'rates.curve', status: ok.rates ? 'ok' : 'failed', latest: rates?.curve ? `${rates.curve.asOf} 2Y ${rates.curve.today['2Y']} · 10Y ${rates.curve.today['10Y']} · 30Y ${rates.curve.today['30Y']}` : '—' },
    { section: 'rates.spreads', status: rates?.spreads ? 'ok' : '—', latest: rates ? `2s10s ${has(rates.spreads.s2s10.value)}bp · 3m10y ${has(rates.spreads.s3m10y.value)}bp · ${has(rates.spreads.curveLabel)}` : '—' },
    { section: 'rates.policy (skill)', status: rates?.policy ? 'ok' : 'failed', latest: rates?.policy ? `${rates.policy.lower}–${rates.policy.upper}%` : '—' },
    { section: 'rates.real/BEI (skill)', status: rates?.real10y ? 'ok' : 'failed', latest: `real ${has(rates?.real10y?.value)} · BEI ${has(rates?.breakeven10y?.value)}` },
    { section: 'rates.credit (skill)', status: rates?.credit?.hy ? 'ok' : 'failed', latest: `HY ${has(rates?.credit?.hy?.value)} · IG ${has(rates?.credit?.ig?.value)}` },
    { section: 'rates.global10y', status: `${rates?.global10y?.length || 0}/5`, latest: (rates?.global10y || []).map((g) => `${g.country} ${g.value}`).join(' · ') },
    { section: 'fx', status: `${fx.filter((x) => !x.stale).length}/${FX.length}`, latest: fx.map((x) => `${x.pair} ${x.price}`).join(' · ') },
    { section: 'commodities', status: `${commodities.filter((x) => !x.stale).length}/${COMMODITIES.length}`, latest: commodities.map((x) => `${x.name} ${x.price}`).join(' · ') },
    { section: 'bondEtfs', status: `${bondEtfs.filter((x) => !x.stale).length}/${BOND_ETFS.length}`, latest: bondEtfs.map((x) => `${x.symbol} y${has(x.yield)}`).join(' · ') },
    { section: 'ratios', status: ratios.goldSilver ? 'ok' : 'failed', latest: `gold/silver ${has(ratios.goldSilver?.value)} · copper/gold ${has(ratios.copperGold?.value)}` },
    { section: 'ecbFx', status: ecb ? 'ok' : 'failed', latest: ecb ? `${ecb.source} ${ecb.asOf} USD ${ecb.rates.USD}` : '—' },
  ]);
  console.log(`skill commands used: ${[...skillUsed].join(', ') || 'none'}`);
  if (Object.keys(errors).length) console.log('errors:', errors);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
