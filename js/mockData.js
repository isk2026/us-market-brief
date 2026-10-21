/*
 * Mock data used until a real news / AI API is connected.
 *
 * MOCK_NEWS fields (required by the spec):
 *   title       뉴스 제목
 *   summary     요약 (1~3개 문장 배열)
 *   importance  중요도 'High' | 'Medium' | 'Low'
 *   source      출처
 *   time        발행 시각 (ISO 8601). Built relative to "now" so the demo never looks stale.
 * Extra fields used by the existing filters: category, sentiment, tickers.
 *
 * MOCK_ECONOMIC / MOCK_EARNINGS hold this week's indicator and earnings schedule (see below).
 * MOCK_BRIEFING mirrors the shape an AI summarization endpoint is expected to return later.
 */
(function () {
  'use strict';
  const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

  window.MOCK_NEWS = [
    {
      id: 'mock-1',
      title: '연준 위원들, 추가 금리 인하 속도 조절 필요성 시사',
      summary: ['복수의 연준 위원이 인플레이션 둔화 확인 전까지 신중한 접근을 강조', '시장은 다음 FOMC에서 동결 가능성을 높게 반영', '국채 2년물 금리는 보합권 등락'],
      importance: 'High', source: 'Reuters (Mock)', time: minutesAgo(55),
      category: 'fed', sentiment: 'neutral', tickers: [],
    },
    {
      id: 'mock-2',
      title: '엔비디아, 차세대 AI 가속기 출하 일정 앞당겨',
      summary: ['데이터센터 고객 수요 증가로 신규 GPU 양산 시점을 한 분기 앞당김', '주요 파운드리 파트너의 첨단 패키징 증설도 병행', '관련 반도체주 동반 강세'],
      importance: 'High', source: 'Bloomberg (Mock)', time: minutesAgo(120),
      category: 'tech', sentiment: 'positive', tickers: ['NVDA', 'TSM'],
    },
    {
      id: 'mock-3',
      title: '테슬라 분기 실적, 매출 시장 예상치 소폭 하회',
      summary: ['차량 인도 대수는 개선됐으나 평균 판매가격 하락으로 매출 부진', '에너지 저장 사업 매출은 사상 최대', '시간외 거래에서 주가 약세'],
      importance: 'High', source: 'CNBC (Mock)', time: minutesAgo(190),
      category: 'earnings', sentiment: 'negative', tickers: ['TSLA'],
    },
    {
      id: 'mock-4',
      title: '소매판매 예상 상회…미국 소비 견조함 재확인',
      summary: ['전월 대비 증가율이 컨센서스를 웃돌며 경기 연착륙 기대 강화', '온라인 및 외식 부문이 증가세 주도'],
      importance: 'Medium', source: 'MarketWatch (Mock)', time: minutesAgo(250),
      category: 'macro', sentiment: 'positive', tickers: ['XRT'],
    },
    {
      id: 'mock-5',
      title: '국제유가, 공급 우려 완화에 3% 하락',
      summary: ['주요 산유국 증산 가능성이 부각되며 WTI 급락', '에너지 섹터가 S&P 500 업종 중 최대 낙폭', '정유주는 마진 개선 기대에 상대적 선방'],
      importance: 'Medium', source: 'Reuters (Mock)', time: minutesAgo(310),
      category: 'energy', sentiment: 'negative', tickers: ['XOM', 'CVX'],
    },
    {
      id: 'mock-6',
      title: '애플, 신규 기기 수요 견조…공급망 증산 요청',
      summary: ['연말 성수기를 앞두고 협력사에 생산량 확대를 요청한 것으로 알려짐', '서비스 부문 성장세도 지속'],
      importance: 'Medium', source: 'WSJ (Mock)', time: minutesAgo(430),
      category: 'tech', sentiment: 'positive', tickers: ['AAPL'],
    },
    {
      id: 'mock-7',
      title: '넷플릭스, 가입자 증가세 지속…광고 요금제 효과',
      summary: ['광고 요금제 가입자가 빠르게 늘며 매출 성장 견인', '연간 영업이익률 가이던스 상향', '주가 시간외 급등'],
      importance: 'Medium', source: 'CNBC (Mock)', time: minutesAgo(545),
      category: 'earnings', sentiment: 'positive', tickers: ['NFLX'],
    },
    {
      id: 'mock-8',
      title: '미 10년물 국채금리 4%대 초반에서 등락',
      summary: ['경제지표 발표를 앞두고 관망세 짙어져', '장단기 금리차는 소폭 확대'],
      importance: 'Low', source: 'MarketWatch (Mock)', time: minutesAgo(670),
      category: 'fed', sentiment: 'neutral', tickers: ['TLT'],
    },
    {
      id: 'mock-9',
      title: 'S&P 500, 기술주 주도로 사상 최고치 근접',
      summary: ['대형 기술주 강세에 지수가 최고치에 바짝 다가서', '시장 폭(breadth)은 여전히 제한적이라는 지적', '거래량은 평균 수준'],
      importance: 'High', source: 'Bloomberg (Mock)', time: minutesAgo(790),
      category: 'market', sentiment: 'positive', tickers: ['SPY', 'QQQ'],
    },
    {
      id: 'mock-10',
      title: '마이크로소프트, 클라우드·AI 인프라 투자 확대 발표',
      summary: ['신규 데이터센터 구축에 대규모 설비투자 계획 공개', 'AI 서비스 매출 기여도 확대 기대'],
      importance: 'Medium', source: 'The Verge (Mock)', time: minutesAgo(965),
      category: 'tech', sentiment: 'positive', tickers: ['MSFT'],
    },
    {
      id: 'mock-11',
      title: '변동성지수(VIX) 하락…위험선호 심리 회복',
      summary: ['VIX가 장기 평균 아래로 내려오며 투자심리 안정', '옵션 시장의 콜 매수 비중 증가'],
      importance: 'Low', source: 'Barron\'s (Mock)', time: minutesAgo(1150),
      category: 'market', sentiment: 'positive', tickers: ['VIX'],
    },
    {
      id: 'mock-12',
      title: 'JP모건, 순이자이익 전망 상향 조정',
      summary: ['투자은행 수수료 수익이 큰 폭으로 회복', '대손충당금 적립은 예상 수준 유지', '대형 은행주 전반 강세'],
      importance: 'Medium', source: 'Reuters (Mock)', time: minutesAgo(1390),
      category: 'earnings', sentiment: 'positive', tickers: ['JPM'],
    },
    {
      id: 'mock-13',
      title: '관세 관련 불확실성 확대에 중소형주 약세',
      summary: ['무역 정책 관련 발언이 이어지며 내수 중소형주 변동성 확대', '러셀 2000 지수 1%대 하락'],
      importance: 'Low', source: 'Yahoo Finance (Mock)', time: minutesAgo(1690),
      category: 'macro', sentiment: 'negative', tickers: ['IWM'],
    },
  ];

  // US calendar date (YYYY-MM-DD) of this week's weekday: 1 = Mon … 5 = Fri.
  // Times below are US Eastern (ET) as published; the app converts them to KST for display.
  const thisWeek = (weekday) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + (weekday - 1));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /*
   * MOCK_ECONOMIC — 이번 주 경제지표 일정
   *   date, time (ET 'HH:MM'), event 이벤트명, forecast 예상치, previous 이전치,
   *   actual 실제치 (shown only once the release time has passed), importance, detail
   */
  window.MOCK_ECONOMIC = [
    { id: 'eco-1', date: thisWeek(1), time: '10:00', event: '경기선행지수 (LEI, MoM)', forecast: '-0.2%', previous: '-0.5%', actual: '-0.3%',
      importance: 'Low', detail: '컨퍼런스보드 경기선행지수. 향후 6~9개월 경기 방향을 가늠.' },
    { id: 'eco-2', date: thisWeek(2), time: '08:30', event: '소비자물가지수 CPI (YoY)', forecast: '2.9%', previous: '3.0%', actual: '2.8%',
      importance: 'High', detail: '헤드라인 CPI 전년 대비 상승률. 연준 금리 경로의 핵심 변수.' },
    { id: 'eco-3', date: thisWeek(2), time: '08:30', event: '근원 CPI (YoY)', forecast: '3.1%', previous: '3.1%', actual: '3.0%',
      importance: 'High', detail: '식품·에너지 제외 CPI 전년 대비 상승률.' },
    { id: 'eco-4', date: thisWeek(2), time: '10:00', event: 'JOLTS 구인건수', forecast: '720만', previous: '718만', actual: '731만',
      importance: 'Medium', detail: '노동 수요를 보여주는 구인 건수.' },
    { id: 'eco-5', date: thisWeek(3), time: '08:15', event: 'ADP 민간고용 변화', forecast: '+11.0만', previous: '+9.8만', actual: '+12.4만',
      importance: 'Medium', detail: '공식 고용보고서에 앞서 발표되는 민간 부문 고용 지표.' },
    { id: 'eco-6', date: thisWeek(3), time: '10:30', event: 'EIA 원유 재고', forecast: '-150만 배럴', previous: '+210만 배럴', actual: '-180만 배럴',
      importance: 'Low', detail: '주간 미국 원유 재고 변화. 유가 및 에너지주에 영향.' },
    { id: 'eco-7', date: thisWeek(4), time: '08:30', event: '신규 실업수당 청구건수', forecast: '22.0만', previous: '21.8만', actual: '21.5만',
      importance: 'Medium', detail: '노동시장 흐름을 가장 빠르게 보여주는 주간 고용 지표.' },
    { id: 'eco-8', date: thisWeek(4), time: '08:30', event: '생산자물가지수 PPI (YoY)', forecast: '2.4%', previous: '2.6%', actual: '2.5%',
      importance: 'Medium', detail: '생산자 단계 물가. CPI의 선행 지표로 활용.' },
    { id: 'eco-9', date: thisWeek(4), time: '10:00', event: '기존주택 판매 (연율)', forecast: '400만', previous: '395만', actual: '403만',
      importance: 'Low', detail: '기존 주택 거래량으로 본 주택시장 경기.' },
    { id: 'eco-10', date: thisWeek(5), time: '08:30', event: '소매판매 (MoM)', forecast: '0.3%', previous: '0.6%', actual: '0.4%',
      importance: 'High', detail: '미국 소비 경기의 핵심 지표. 소매 매출의 전월 대비 변화율.' },
    { id: 'eco-11', date: thisWeek(5), time: '10:00', event: '미시간대 소비자심리지수 (확정)', forecast: '55.0', previous: '54.2', actual: '55.6',
      importance: 'Medium', detail: '소비자 체감 경기와 1년 기대 인플레이션.' },
  ];

  /*
   * MOCK_EARNINGS — 이번 주 주요 기업 실적발표 일정
   *   date, time (ET 'HH:MM'), session 'bmo' 장 전 | 'amc' 장 후, company 기업명, ticker 티커,
   *   epsEstimate EPS 전망, epsPrevious 전년 동기 EPS, revenueEstimate 매출 전망, epsActual (shown once released)
   */
  window.MOCK_EARNINGS = [
    { id: 'ern-1', date: thisWeek(1), time: '07:00', session: 'bmo', company: 'Verizon', ticker: 'VZ',
      epsEstimate: 1.19, epsPrevious: 1.19, revenueEstimate: '$339억', epsActual: 1.21, importance: 'Medium' },
    { id: 'ern-2', date: thisWeek(2), time: '06:45', session: 'bmo', company: 'Coca-Cola', ticker: 'KO',
      epsEstimate: 0.78, epsPrevious: 0.77, revenueEstimate: '$122억', epsActual: 0.82, importance: 'Medium' },
    { id: 'ern-3', date: thisWeek(2), time: '16:05', session: 'amc', company: 'Netflix', ticker: 'NFLX',
      epsEstimate: 6.95, epsPrevious: 5.40, revenueEstimate: '$115억', epsActual: 7.18, importance: 'High' },
    { id: 'ern-4', date: thisWeek(3), time: '16:05', session: 'amc', company: 'Tesla', ticker: 'TSLA',
      epsEstimate: 0.55, epsPrevious: 0.72, revenueEstimate: '$262억', epsActual: 0.50, importance: 'High' },
    { id: 'ern-5', date: thisWeek(3), time: '16:05', session: 'amc', company: 'IBM', ticker: 'IBM',
      epsEstimate: 2.45, epsPrevious: 2.30, revenueEstimate: '$163억', epsActual: 2.51, importance: 'Medium' },
    { id: 'ern-6', date: thisWeek(4), time: '07:30', session: 'bmo', company: 'Union Pacific', ticker: 'UNP',
      epsEstimate: 2.78, epsPrevious: 2.75, revenueEstimate: '$62억', importance: 'Low' },
    { id: 'ern-7', date: thisWeek(4), time: '16:30', session: 'amc', company: 'Apple', ticker: 'AAPL',
      epsEstimate: 1.75, epsPrevious: 1.64, revenueEstimate: '$1,021억', importance: 'High' },
    { id: 'ern-8', date: thisWeek(4), time: '16:05', session: 'amc', company: 'Intel', ticker: 'INTC',
      epsEstimate: 0.12, epsPrevious: 0.17, revenueEstimate: '$134억', importance: 'Medium' },
    { id: 'ern-9', date: thisWeek(5), time: '06:55', session: 'bmo', company: 'Procter & Gamble', ticker: 'PG',
      epsEstimate: 1.90, epsPrevious: 1.93, revenueEstimate: '$223억', importance: 'Medium' },
  ];

  /*
   * MOCK_MARKET — fallback for the 시장 지표 panel when js/marketData.js has not been generated.
   * Same shape as window.MARKET_DATA (see scripts/fetch-market-data.mjs); values are illustrative only.
   */
  window.MOCK_MARKET = (function () {
    const days = [];
    for (let d = new Date(), n = 0; days.length < 30 && n < 60; n++, d.setDate(d.getDate() - 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) days.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    // Deterministic wave so the sample looks the same on every load.
    const wave = (base, amp, phase) => days.map((date, i) => ({ date, v: +(base + amp * Math.sin(i / 4 + phase) + amp * 0.3 * Math.cos(i / 1.7)).toFixed(2) }));
    const series = (base, amp, phase, key = 'value') => wave(base, amp, phase).map((p) => ({ date: p.date, [key]: p.v }));
    const asOf = days[days.length - 1];
    const fg = series(42, 12, 0.5, 'score');
    return {
      mock: true,
      generatedAt: new Date().toISOString(),
      rates: { asOf, source: 'Sample', url: '', series: { y3m: [], y2: series(4.2, 0.08, 0), y10: series(4.5, 0.1, 1), y30: series(4.8, 0.08, 2) } },
      vix: { asOf, source: 'Sample', url: '', series: series(18, 3, 0.3, 'close') },
      oil: { asOf, source: 'Sample', url: '', wti: series(72, 3, 0.8, 'close'), brent: series(76, 3, 0.9, 'close') },
      fearGreed: { asOf: new Date().toISOString(), source: 'Sample', url: '', score: lastScore(fg), rating: '', previous: { close: 44, week: 38, month: 55, year: 61 }, history: fg },
      aaii: {
        asOf, source: 'Sample', url: '', bullish: 38.0, neutral: 30.5, bearish: 31.5,
        history: [[34, 33, 33], [36, 32, 32], [31, 30, 39], [29, 31, 40], [33, 30, 37], [37, 29, 34], [36, 31, 33], [38, 30.5, 31.5]]
          .map(([bullish, neutral, bearish], i) => ({ date: days[Math.max(0, days.length - 1 - (7 - i) * 5)], bullish, neutral, bearish })),
        averages: { bullish: 37.5, neutral: 31.5, bearish: 31.0 },
      },
      errors: {},
    };
    function lastScore(h) { return h[h.length - 1].score; }
  })();

  window.MOCK_BRIEFING = {
    generatedAt: minutesAgo(20),
    tone: 'positive', // positive | negative | neutral → 전반적 시장 분위기
    headline: '기술주가 지수를 끌어올리는 가운데, 연준의 신중론과 실적 시즌이 변수',
    overview: '대형 기술주 강세로 S&P 500과 나스닥이 상승 마감했습니다. AI 반도체 수요 기대가 이어진 반면, '
      + '연준 위원들의 신중한 발언으로 금리 인하 기대는 다소 후퇴했습니다. 유가 하락으로 에너지 업종은 약세였고, '
      + '중소형주는 관세 불확실성에 상대적으로 부진했습니다.',
    keyPoints: [
      'AI 인프라 투자 확대 뉴스로 반도체·클라우드 종목 강세',
      '연준 위원들, 인플레이션 확인 전 추가 인하에 신중한 입장',
      '빅테크 실적 발표 주간 진입 — 가이던스가 지수 방향 결정',
    ],
    watch: [
      '이번 주 FOMC 회의 결과와 기자회견 발언',
      '알파벳·마이크로소프트·메타 실적 및 AI 설비투자 가이던스',
      'GDP 속보치와 PCE 물가지수',
    ],
  };
})();
