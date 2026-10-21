/*
 * Finnhub REST client for the browser (window.UMB.finnhub). Loaded right after core.js.
 *
 *   hasKey() / getKey() / setKey(k) / clearKey()   key lives in localStorage (UMB.KEYS.apiKey) only
 *   get(path, params, { ttl, signal, priority })   → parsed JSON, or throws FinnhubError
 *   verifyKey(key)                                 → { ok, message } without storing the key
 *   stats() / clearCache()
 *
 * Security: the key is sent in the X-Finnhub-Token header (falls back to the ?token= query only if the
 * browser rejects the header), never logged, never part of cache keys, and scrubbed from every error.
 * A key used from front-end code is still visible to anyone with devtools on this device — keep it a
 * personal free-tier key.
 * Reliability: client-side rate limit (4 concurrent, 50 calls per rolling 60s, priority order),
 * 10s timeout, 429 backoff retries, TTL cache (memory + localStorage), in-flight de-duplication.
 */
(function () {
  'use strict';
  const U = window.UMB;

  const BASE = 'https://finnhub.io/api/v1';
  const KEY_RE = /^[A-Za-z0-9]{10,64}$/;
  const CACHE_PREFIX = 'umb.fh.cache:';
  const AUTH_MODE_KEY = 'umb.fh.authMode'; // sessionStorage: 'header' | 'query'

  // Mutable so tests can shrink delays; the app never changes these.
  const config = {
    timeoutMs: 10000,
    maxConcurrent: 4,
    maxPerWindow: 50,
    windowMs: 60000,
    retryDelays: [2000, 4000], // 429 backoff, i.e. up to 2 retries
    cacheMax: 200,
  };

  const MESSAGES = {
    NO_KEY: 'Finnhub API 키가 설정되지 않았습니다. ⚙ 설정에서 키를 입력하세요.',
    INVALID_FORMAT: 'API 키 형식이 올바르지 않습니다 (영문·숫자 10~64자).',
    UNAUTHORIZED: 'API 키가 유효하지 않습니다.',
    FORBIDDEN: '무료 플랜에서 지원하지 않는 데이터입니다.',
    RATE_LIMIT: 'Finnhub 호출 한도를 초과했습니다. 잠시 후 다시 시도하세요.',
    TIMEOUT: 'Finnhub 응답 시간이 초과되었습니다.',
    NETWORK: '네트워크 오류로 Finnhub에 연결하지 못했습니다.',
    PARSE: 'Finnhub 응답을 해석하지 못했습니다.',
  };

  // ---------- key handling ----------
  function getKey() {
    const k = U.store.get(U.KEYS.apiKey, null);
    return typeof k === 'string' && k.trim() ? k.trim() : null;
  }
  const hasKey = () => !!getKey();
  function setKey(k) {
    const key = String(k ?? '').trim();
    if (!KEY_RE.test(key)) throw new FinnhubError('INVALID_FORMAT');
    U.store.set(U.KEYS.apiKey, key);
  }
  function clearKey() { U.store.remove(U.KEYS.apiKey); }

  // Remove anything that could carry the key from text that may end up in errors or logs.
  function scrub(text) {
    let s = String(text ?? '')
      .replace(/([?&]token=)[^&\s"'#]*/gi, '$1***')
      .replace(/(x-finnhub-token["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1***');
    const key = getKey();
    if (key) s = s.split(key).join('***');
    return s;
  }

  class FinnhubError extends Error {
    constructor(code, message, status) {
      super(scrub(message || MESSAGES[code] || `Finnhub 오류${status ? ` (${status})` : ''}`));
      this.name = 'FinnhubError';
      this.code = code;
      if (status != null) this.status = status;
    }
  }

  const abortError = () => {
    try { return new DOMException('요청이 취소되었습니다.', 'AbortError'); } catch {
      const e = new Error('요청이 취소되었습니다.'); e.name = 'AbortError'; return e;
    }
  };
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError()); return; }
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
  });

  // ---------- auth mode (header preferred, query fallback remembered per session) ----------
  let authMode = (() => {
    try { return sessionStorage.getItem(AUTH_MODE_KEY) === 'query' ? 'query' : 'header'; } catch { return 'header'; }
  })();
  function rememberAuthMode(mode) {
    authMode = mode;
    try { sessionStorage.setItem(AUTH_MODE_KEY, mode); } catch { /* ignore */ }
  }

  // ---------- rate limiter: priority queue + concurrency + rolling window ----------
  const queue = [];
  const sentAt = [];
  let active = 0;
  let seq = 0;
  let wakeTimer = null;
  let calls = 0;
  let cacheHits = 0;

  function schedule(task, priority, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortError()); return; }
      const job = { task, priority, seq: ++seq, resolve, reject };
      queue.push(job);
      queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      if (signal) {
        signal.addEventListener('abort', () => {
          const i = queue.indexOf(job);
          if (i >= 0) { queue.splice(i, 1); reject(abortError()); }
        }, { once: true });
      }
      pump();
    });
  }

  function pump() {
    while (active < config.maxConcurrent && queue.length) {
      const now = Date.now();
      while (sentAt.length && now - sentAt[0] >= config.windowMs) sentAt.shift();
      if (sentAt.length >= config.maxPerWindow) {
        if (!wakeTimer) {
          wakeTimer = setTimeout(() => { wakeTimer = null; pump(); }, config.windowMs - (now - sentAt[0]) + 5);
        }
        return;
      }
      const job = queue.shift();
      active++;
      sentAt.push(now);
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => { active--; pump(); });
    }
  }

  // ---------- one HTTP attempt ----------
  function buildUrl(path, params, key, mode) {
    const url = new URL(`${BASE}/${String(path).replace(/^\/+/, '')}`);
    Object.keys(params).sort().forEach((k) => {
      if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, String(params[k]));
    });
    if (mode === 'query') url.searchParams.set('token', key);
    return url.toString();
  }

  async function attempt(path, params, key, mode, callerSignal) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, config.timeoutMs);
    const onAbort = () => ctrl.abort();
    if (callerSignal) {
      if (callerSignal.aborted) { clearTimeout(timer); throw abortError(); }
      callerSignal.addEventListener('abort', onAbort, { once: true });
    }
    const headers = { Accept: 'application/json' };
    if (mode === 'header') headers['X-Finnhub-Token'] = key;

    let res;
    calls++;
    try {
      res = await window.fetch(buildUrl(path, params, key, mode), {
        method: 'GET', headers, signal: ctrl.signal,
        mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
    } catch (err) {
      if (callerSignal && callerSignal.aborted) throw abortError();
      if (timedOut) throw new FinnhubError('TIMEOUT');
      const e = new FinnhubError('NETWORK');
      // A CORS rejection of the auth header surfaces as a TypeError → caller may retry in query mode.
      e.transport = err && err.name === 'TypeError';
      throw e;
    } finally {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', onAbort);
    }

    const { status } = res;
    if (status === 401) throw new FinnhubError('UNAUTHORIZED', null, status);
    if (status === 403) throw new FinnhubError('FORBIDDEN', null, status);
    if (status === 429) throw new FinnhubError('RATE_LIMIT', null, status);

    let text;
    try { text = await res.text(); } catch { throw new FinnhubError('NETWORK', null, status); }
    if (!res.ok) throw new FinnhubError('HTTP', `Finnhub 오류 (${status})`, status);

    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new FinnhubError('PARSE', null, status); }
    // Finnhub sometimes answers 200 with { error: '...' }.
    if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string') {
      if (/api key|invalid token|missing token/i.test(data.error)) throw new FinnhubError('UNAUTHORIZED', null, status);
      if (/access|premium|subscri|plan/i.test(data.error)) throw new FinnhubError('FORBIDDEN', null, status);
      throw new FinnhubError('HTTP', `Finnhub 오류: ${data.error}`, status);
    }
    return data;
  }

  // Rate-limited request with header→query fallback and 429 backoff.
  async function request(path, params, key, { signal, priority = 0 } = {}) {
    for (let retry = 0; ; retry++) {
      try {
        const mode = authMode;
        try {
          return await schedule(() => attempt(path, params, key, mode, signal), priority, signal);
        } catch (err) {
          if (!(err instanceof FinnhubError) || !err.transport || mode !== 'header') throw err;
          // Header blocked (or network blip): retry once with ?token=. Any HTTP answer proves query mode works.
          try {
            const data = await schedule(() => attempt(path, params, key, 'query', signal), priority, signal);
            rememberAuthMode('query');
            return data;
          } catch (err2) {
            if (err2 instanceof FinnhubError && !err2.transport && err2.code !== 'TIMEOUT') rememberAuthMode('query');
            throw err2;
          }
        }
      } catch (err) {
        if (err instanceof FinnhubError && err.code === 'RATE_LIMIT' && retry < config.retryDelays.length) {
          await sleep(config.retryDelays[retry], signal);
          continue;
        }
        if (err instanceof FinnhubError) delete err.transport;
        throw err;
      }
    }
  }

  // ---------- cache (memory + localStorage, token-free keys) ----------
  const mem = new Map();
  const inflight = new Map();

  const cacheKey = (path, params) => `${String(path).replace(/^\/+/, '')}?${Object.keys(params).sort()
    .filter((k) => params[k] !== undefined && params[k] !== null && k !== 'token')
    .map((k) => `${k}=${params[k]}`).join('&')}`;

  function readCache(key) {
    const now = Date.now();
    const m = mem.get(key);
    if (m && m.exp > now) return m;
    if (m) mem.delete(key);
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (entry && entry.exp > now) { mem.set(key, entry); return entry; }
      localStorage.removeItem(CACHE_PREFIX + key);
    } catch { /* ignore */ }
    return null;
  }

  function cacheEntries() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(CACHE_PREFIX)) continue;
        let t = 0;
        try { t = JSON.parse(localStorage.getItem(k)).t || 0; } catch { /* corrupt → evict first */ }
        out.push({ k, t });
      }
    } catch { /* ignore */ }
    return out.sort((a, b) => a.t - b.t);
  }

  function evict(keep) {
    const entries = cacheEntries();
    for (let i = 0; i < entries.length - keep; i++) {
      try { localStorage.removeItem(entries[i].k); } catch { /* ignore */ }
    }
  }

  function writeCache(key, data, ttl) {
    const entry = { exp: Date.now() + ttl, t: Date.now(), data };
    mem.set(key, entry);
    const raw = JSON.stringify(entry);
    try {
      localStorage.setItem(CACHE_PREFIX + key, raw);
    } catch {
      evict(Math.floor(config.cacheMax / 2)); // quota: drop the older half, then try once more
      try { localStorage.setItem(CACHE_PREFIX + key, raw); } catch { /* memory cache only */ }
    }
    if (cacheEntries().length > config.cacheMax) evict(config.cacheMax);
  }

  function clearCache() {
    mem.clear();
    cacheEntries().forEach(({ k }) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  }

  // ---------- public API ----------
  async function get(path, params = {}, { ttl = 0, signal, priority = 0 } = {}) {
    const key = getKey();
    if (!key) throw new FinnhubError('NO_KEY');
    const ck = cacheKey(path, params);
    if (ttl > 0) {
      const hit = readCache(ck);
      if (hit) { cacheHits++; return hit.data; }
    }
    // Share identical concurrent requests (not when a caller brings its own abort signal).
    if (!signal && inflight.has(ck)) return inflight.get(ck);
    const p = request(path, params, key, { signal, priority }).then((data) => {
      if (ttl > 0) writeCache(ck, data, ttl);
      return data;
    });
    if (!signal) {
      inflight.set(ck, p);
      p.then(() => inflight.delete(ck), () => inflight.delete(ck));
    }
    return p;
  }

  async function verifyKey(k) {
    const key = String(k ?? '').trim();
    if (!KEY_RE.test(key)) return { ok: false, message: MESSAGES.INVALID_FORMAT };
    try {
      const q = await request('quote', { symbol: 'AAPL' }, key, { priority: 10 });
      if (q && typeof q === 'object' && 'c' in q) return { ok: true, message: 'API 키가 확인되었습니다.' };
      return { ok: false, message: MESSAGES.PARSE };
    } catch (err) {
      if (err instanceof FinnhubError) {
        // A rate-limited answer still means Finnhub accepted the key.
        if (err.code === 'RATE_LIMIT') return { ok: true, message: '키는 유효하지만 지금은 호출 한도에 걸려 있습니다.' };
        return { ok: false, message: err.message };
      }
      return { ok: false, message: MESSAGES.NETWORK };
    }
  }

  const stats = () => ({ calls, cacheHits, queued: queue.length, authMode });

  U.finnhub = { hasKey, getKey, setKey, clearKey, get, verifyKey, stats, clearCache, FinnhubError, _config: config };
})();
