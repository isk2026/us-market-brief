/*
 * Sample data generator. Everything is relative to "today" so the demo always looks current.
 * Exposes UMB.sample.{news,events,quotes}() returning fresh arrays (see contract in core.js).
 */
(function () {
  'use strict';
  const { dateKey, addDays, parseKey, eventDate, earningsId } = window.UMB;
  
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

  // Date key `offset` calendar days from today, pushed forward to the next weekday if it lands on a weekend.
  function bizKey(offset) {
    let d = addDays(startOfToday(), offset);
    while (isWeekend(d)) d = addDays(d, 1);
    return dateKey(d);
  }

  // nth weekday (0=Sun) of a month, e.g. nthWeekday(2026, 10, 4, 4) = 4th Thursday of November.
  function nthWeekday(year, month, weekday, n) {
    const d = new Date(year, month, 1);
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
    d.setDate(d.getDate() + 7 * (n - 1));
    return d;
  }

  // Fixed-date holiday moved to Fri/Mon when it falls on a weekend (NYSE observance).
  function observed(d) {
    if (d.getDay() === 6) return addDays(d, -1);
    if (d.getDay() === 0) return addDays(d, 1);
    return d;
  }

  // News comes from js/mockData.js (MOCK_NEWS), mapped onto the NewsItem contract in core.js.
  function news() {
    return (window.MOCK_NEWS || []).map((n) => ({
      id: n.id,
      datetime: Date.parse(n.time),
      headline: n.title,
      summary: n.summary,
      importance: n.importance,
      source: n.source,
      url: n.url || '#',
      category: n.category || 'market',
      sentiment: n.sentiment || 'neutral',
      tickers: n.tickers || [],
    })).sort((x, y) => y.datetime - x.datetime);
  }

  function briefing() {
    return window.MOCK_BRIEFING ? { ...window.MOCK_BRIEFING, mock: true } : null;
  }

  function events() {
    const today = startOfToday();
    const tKey = dateKey(today);
    const start = addDays(today, -14);
    const end = addDays(today, 45);
    const inRange = (d) => d >= start && d <= end;
    const isPast = (key) => key < tKey;
    const list = [];
    // IDs are derived from content so they stay stable across reloads (favorites are keyed by id).
    const add = (ev) => list.push({ id: eventId(ev), time: null, session: null, ...ev });

    // Weekly jobless claims (Thursdays) and NFP (first Friday of the month).
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const key = dateKey(d);
      if (d.getDay() === 4) {
        add({ date: key, time: '08:30', type: 'economic', importance: 2, title: '신규 실업수당 청구건수',
          detail: '주간 신규 실업수당 청구건수. 노동시장 흐름을 가장 빠르게 보여주는 지표.',
          forecast: '22.0만', previous: '21.8만', actual: isPast(key) ? `${(21 + (d.getDate() % 4) * 0.4).toFixed(1)}만` : undefined });
      }
    }
    for (let m = new Date(start.getFullYear(), start.getMonth(), 1); m <= end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const nfp = nthWeekday(m.getFullYear(), m.getMonth(), 5, 1);
      if (!inRange(nfp)) continue;
      const key = dateKey(nfp);
      add({ date: key, time: '08:30', type: 'economic', importance: 3, title: '비농업 고용지수 (NFP) · 실업률',
        detail: '월간 고용 보고서. 비농업 일자리 증가 수와 실업률, 평균 시간당 임금을 함께 발표.',
        forecast: '+14.5만 / 4.2%', previous: '+13.0만 / 4.2%', actual: isPast(key) ? '+15.2만 / 4.1%' : undefined });
    }

    // Monthly indicators at fixed relative offsets (this week's releases come from MOCK_ECONOMIC).
    const econ = [
      [6, '10:00', 2, '컨퍼런스보드 소비자신뢰지수', '소비자의 현재 상황 및 향후 기대 평가.', '98.5', '97.8'],
      [8, '08:30', 3, 'GDP 성장률 (속보치, QoQ 연율)', '분기 국내총생산 성장률 첫 추정치.', '2.6%', '3.0%'],
      [9, '08:30', 3, '개인소비지출 물가지수 (PCE)', '연준이 선호하는 물가 지표. 근원 PCE 전년 대비.', '2.7%', '2.8%'],
      [11, '10:00', 2, 'ISM 제조업 PMI', '50 이상이면 제조업 확장 국면.', '49.5', '49.1'],
      [13, '10:00', 2, 'ISM 서비스업 PMI', '서비스업 경기 체감 지수.', '52.0', '51.8'],
      [21, '08:30', 3, '소비자물가지수 (CPI)', '헤드라인·근원 CPI 전년 대비 상승률.', '2.8%', '2.8%'],
      [22, '08:30', 2, '생산자물가지수 (PPI)', '생산자 단계의 물가 변화.', '2.3%', '2.3%'],
      [23, '08:30', 2, '소매판매 (MoM)', '소매 부문 매출의 전월 대비 변화율.', '0.4%', '0.5%'],
      [37, '08:30', 2, 'GDP 성장률 (잠정치)', '분기 GDP 두 번째 추정치.', '2.7%', '2.6%'],
      [39, '08:30', 3, '개인소비지출 물가지수 (PCE)', '근원 PCE 전년 대비.', '2.6%', '2.7%'],
    ];
    for (const [off, time, importance, title, detail, forecast, previous, actual] of econ) {
      const date = bizKey(off);
      add({ date, time, type: 'economic', importance, title, detail, forecast, previous, actual: isPast(date) ? actual : undefined });
    }

    // FOMC (2-day meeting) and Fed chair speeches.
    const fomc1 = bizKey(6);
    let fomc2 = addDays(parseKey(fomc1), 1);
    while (isWeekend(fomc2)) fomc2 = addDays(fomc2, 1);
    const fomc2Key = dateKey(fomc2);
    add({ date: fomc1, type: 'fed', importance: 2, title: 'FOMC 정례회의 1일차', detail: '연방공개시장위원회 이틀간의 회의 시작.' });
    add({ date: fomc2Key, time: '14:00', type: 'fed', importance: 3, title: 'FOMC 금리 결정 · 성명 발표',
      detail: '기준금리 결정과 통화정책 성명서 공개.', forecast: '3.75%~4.00%', previous: '4.00%~4.25%' });
    add({ date: fomc2Key, time: '14:30', type: 'fed', importance: 3, title: '연준 의장 기자회견', detail: '금리 결정 배경과 향후 정책 방향에 대한 질의응답.' });
    add({ date: bizKey(-5), time: '13:00', type: 'fed', importance: 2, title: '연준 의장 연설', detail: '경제 전망 관련 공개 연설.' });
    add({ date: bizKey(16), time: '10:00', type: 'fed', importance: 2, title: '연준 의장 의회 증언', detail: '상원 은행위원회 통화정책 보고.' });
    add({ date: bizKey(27), time: '14:00', type: 'fed', importance: 2, title: 'FOMC 의사록 공개', detail: '직전 회의 의사록 발표.' });

    // US market holidays computed by rule for each year touched by the range.
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
      const thanksgiving = nthWeekday(y, 10, 4, 4);
      const holidays = [
        [thanksgiving, null, '추수감사절 휴장', '뉴욕증시 전일 휴장.'],
        [addDays(thanksgiving, 1), '13:00', '블랙프라이데이 조기 폐장', '주식시장 13:00 ET 조기 마감.'],
        [observed(new Date(y, 11, 25)), null, '크리스마스 휴장', '뉴욕증시 전일 휴장.'],
        [observed(new Date(y, 0, 1)), null, '새해 첫날 휴장', '뉴욕증시 전일 휴장.'],
      ];
      for (const [d, time, title, detail] of holidays) {
        if (inRange(d)) add({ date: dateKey(d), time, type: 'holiday', importance: 2, title, detail });
      }
    }

    // Earnings outside this week (this week's come from MOCK_EARNINGS).
    const earnings = [
      [-6, 'bmo', 'JPMorgan Chase', 'JPM', 3, '4.10', '4.37'],
      [5, 'amc', 'Visa', 'V', 2, '2.95'],
      [6, 'amc', 'Alphabet', 'GOOGL', 3, '2.30'],
      [6, 'amc', 'Microsoft', 'MSFT', 3, '3.10'],
      [7, 'amc', 'Meta Platforms', 'META', 3, '6.70'],
      [8, 'amc', 'Amazon', 'AMZN', 3, '1.55'],
      [9, 'bmo', 'Exxon Mobil', 'XOM', 2, '1.80'],
      [13, 'amc', 'AMD', 'AMD', 2, '1.15'],
      [28, 'amc', 'NVIDIA', 'NVDA', 3, '1.05'],
    ];
    for (const [off, session, name, ticker, importance, est, act] of earnings) {
      const date = bizKey(off);
      add({ date, session, type: 'earnings', importance, ticker, company: name, title: `${name} (${ticker}) 실적`,
        detail: `${name} 분기 실적 발표 (${session === 'bmo' ? '장 시작 전' : '장 마감 후'}).`,
        forecast: `$${est}`, actual: isPast(date) && act ? `$${act}` : undefined });
    }

    // Generated economic/earnings events that fall in this week are replaced by the mock schedule.
    const [weekFrom, weekTo] = thisWeekRange();
    const replaced = (ev) => (ev.type === 'economic' || ev.type === 'earnings') && ev.date >= weekFrom && ev.date <= weekTo;
    let out = [...list.filter((ev) => !replaced(ev)), ...mockWeekEvents()];
    // Real earnings calendar from the market snapshot (major companies) supersedes all sample earnings.
    const snap = snapshotEarnings();
    if (snap) out = [...out.filter((ev) => ev.type !== 'earnings'), ...snap];
    return out.sort((a, b) => eventDate(a) - eventDate(b));
  }

  const eventId = (ev) => (ev.type === 'earnings' && ev.ticker
    ? earningsId(ev.ticker, ev.date)
    : `se-${ev.type}-${ev.date}-${ev.time || ev.session || 'day'}-${ev.title}`);

  // ---- Major-company earnings from js/marketData.js (Nasdaq calendar, market cap ≥ $50B + watchlist) ----
  const capImportance = (cap, ticker) => (window.UMB.isWatched(ticker) || cap >= 500e9 ? 3 : cap >= 100e9 ? 2 : 1);
  const formatCap = (cap) => (cap >= 1e12 ? `$${(cap / 1e12).toFixed(2)}T` : `$${Math.round(cap / 1e9)}B`);
  const shortName = (name) => String(name || '')
    .replace(/\s*\(The\)$/i, '')
    .replace(/,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|plc|N\.V\.|S\.A\.|Holdings?|Group)$/i, '')
    .replace(/,?\s+(Inc\.?|Corporation|Company)$/i, '')
    .trim();

  function snapshotEarnings() {
    const e = window.MARKET_DATA && window.MARKET_DATA.earnings;
    if (!e || !Array.isArray(e.items) || !e.items.length) return null;
    const usd = (v) => (v == null ? undefined : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`);
    return e.items.map((m) => ({
      id: earningsId(m.symbol, m.date), date: m.date, time: null, session: m.session || null, type: 'earnings',
      importance: capImportance(m.marketCap || 0, m.symbol), ticker: m.symbol, company: shortName(m.name),
      marketCap: m.marketCap || null, surprisePct: m.surprisePct ?? null,
      title: `${shortName(m.name)} (${m.symbol}) 실적`,
      detail: [m.fiscalQuarter && `${m.fiscalQuarter} 분기`, m.marketCap && `시가총액 ${formatCap(m.marketCap)}`, m.noOfEsts && `추정 ${m.noOfEsts}건`]
        .filter(Boolean).join(' · '),
      forecast: usd(m.epsForecast), previous: usd(m.lastYearEPS), actual: usd(m.epsActual),
    }));
  }

  // ---- This week's schedule from js/mockData.js (MOCK_ECONOMIC / MOCK_EARNINGS) ----
  const IMPORTANCE_LEVEL = { High: 3, Medium: 2, Low: 1 };

  function thisWeekRange() {
    const today = startOfToday();
    const mon = addDays(today, -((today.getDay() + 6) % 7));
    return [dateKey(mon), dateKey(addDays(mon, 6))];
  }

  // Actual figures are revealed only once the release time (ET) has passed.
  function mockWeekEvents() {
    const released = (ev) => eventDate(ev).getTime() <= Date.now();
    const usd = (v) => (v == null ? undefined : `$${Number(v).toFixed(2)}`);
    const economic = (window.MOCK_ECONOMIC || []).map((m) => {
      const ev = { id: `${m.id}@${m.date}`, date: m.date, time: m.time, session: null, type: 'economic',
        importance: IMPORTANCE_LEVEL[m.importance] || 2, title: m.event, detail: m.detail,
        forecast: m.forecast, previous: m.previous };
      return released(ev) ? { ...ev, actual: m.actual } : ev;
    });
    const earnings = (window.MOCK_EARNINGS || []).map((m) => {
      const ev = { id: earningsId(m.ticker, m.date), date: m.date, time: m.time, session: m.session, type: 'earnings',
        importance: IMPORTANCE_LEVEL[m.importance] || 2, ticker: m.ticker, company: m.company,
        title: `${m.company} (${m.ticker}) 실적`,
        detail: `${m.session === 'bmo' ? '장 시작 전' : '장 마감 후'} 발표 · 매출 전망 ${m.revenueEstimate}`,
        forecast: usd(m.epsEstimate), previous: usd(m.epsPrevious) };
      return released(ev) && m.epsActual != null ? { ...ev, actual: usd(m.epsActual) } : ev;
    });
    return [...economic, ...earnings];
  }

  function quotes() {
    return [
      { symbol: 'SPY', name: 'S&P 500', price: 668.42, change: 0.54 },
      { symbol: 'QQQ', name: '나스닥 100', price: 602.15, change: 0.87 },
      { symbol: 'DIA', name: '다우존스', price: 462.3, change: -0.12 },
      { symbol: 'IWM', name: '러셀 2000', price: 243.08, change: -0.95 },
    ];
  }

  window.UMB.sample = { news, events, quotes, briefing };
})();
