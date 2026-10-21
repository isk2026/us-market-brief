# US Market Brief

미국 주식 주요 뉴스 요약과 시장 일정(경제지표 · FOMC · 실적발표 · 휴장일)을 한눈에 보는 싱글 페이지 웹 앱입니다.
HTML + Tailwind CSS(CDN) + Vanilla JavaScript로 만들었고, 빌드 과정이 없습니다.

## 실행

`index.html`을 브라우저로 바로 열거나, 로컬 서버로 띄우면 됩니다.

```bash
npx serve .        # 또는: python -m http.server 8000
```

## 화면

| 경로 | 내용 |
| --- | --- |
| `#/dashboard` | **오늘의 마켓 브리핑**(AI 브리핑 카드), 핵심 지표, 주요 뉴스, 다음 핵심 이벤트 카운트다운, 이번 주 일정, 다가오는 실적 발표 |
| `#/news` | **뉴스 및 지표 요약** — 최근 발표·예정 경제지표(실제/예상/이전, 예상 상회·하회), 중요도(High/Medium/Low) · 카테고리 · 심리 · 키워드 · 관심종목 필터, 중요도순 정렬, High 뉴스 강조 카드. 카드를 클릭(또는 Enter)하면 **상세 모달** — 요약·관련 종목·관련 일정(KST), ‹ 이전 / 다음 › 및 ←/→ 키 이동, Esc로 닫기 |
| `#/calendar` | **경제지표 · 실적 캘린더** — [전체 보기] [경제지표만] [실적발표만] 필터 칩, 주간(기본) / 월간 / 목록 보기, 중요도 필터. 모든 일정은 **한국시간(KST)** 기준으로 날짜·시각을 배치하고 미국 현지 시각(ET)을 보조 표기, 발표된 지표·실적은 예상 대비 상회/하회 표시. 일정 카드 오른쪽 **☆ 즐겨찾기** 버튼으로 저장하고 [★ 즐겨찾기] 칩으로 저장한 일정만 모아보기 |

## 데이터

- **기본값: 샘플 데이터.** 오늘 날짜 기준으로 만들어지므로 언제 열어도 일정이 채워져 있습니다.
- **실시간:** ⚙ 설정에 [Finnhub](https://finnhub.io/register) 무료 API 키를 넣으면 뉴스, 실적 발표 일정, 지수 ETF(SPY/QQQ/DIA/IWM) 시세를 불러오고 5분마다 갱신합니다.
  경제지표 캘린더는 Finnhub 유료 기능이라 샘플 일정을 계속 사용합니다.
- 실시간 모드의 뉴스 중요도는 키워드·대형주 기준 규칙으로, 마켓 브리핑은 수집 데이터로 자동 생성합니다. AI API를 붙일 때는 `js/api.js`의 `buildBriefing()`만 교체하면 됩니다.
- `MOCK_ECONOMIC` / `MOCK_EARNINGS`의 날짜는 "이번 주 n요일"로 계산되고 시간은 미국 동부시간(ET) 원본 그대로 저장합니다. 화면 표시 때 서머타임을 반영해 KST로 변환하며, 실제치는 발표 시각이 지난 뒤에만 노출됩니다.
- API 키, 관심 종목, 즐겨찾기한 일정(`umb.favoriteEvents`)은 브라우저의 localStorage에만 저장됩니다. 실적 일정 ID는 샘플·실시간 모드 모두 `earn-티커-날짜` 형식이라 데이터 소스를 바꿔도 즐겨찾기가 유지됩니다.

## 시장 지표 (대시보드)

미국 국채 금리(2년·10년·30년, 2s10s 스프레드), VIX, 국제 유가(WTI·브렌트), CNN 공포·탐욕 지수, AAII 개인투자자 심리를 카드로 보여줍니다.
대부분의 원천이 브라우저 직접 호출(CORS)을 막기 때문에, Node 스크립트가 스냅샷 파일을 만들고 앱은 그 파일을 읽습니다.

```bash
node scripts/fetch-market-data.mjs   # js/marketData.js 갱신
```

| 지표 | 원천 |
| --- | --- |
| 금리 · VIX · 유가 | 설치된 `multi-asset-morning-briefing` 스킬의 `market_data.py` (미 재무부 · Cboe · FRED). 스킬이 없거나 실패하면 같은 원천을 직접 호출 |
| CNN Fear & Greed | CNN dataviz 공개 엔드포인트 (봇 차단이 바뀌면 실패할 수 있음) |
| AAII Sentiment | AAII 설문 결과 페이지 |
| 유가 최신 선물 (WTI `CL=F` · 브렌트 `BZ=F`) | Yahoo Finance 차트 (스킬의 FRED 현물은 약 1주 지연이라 최신가 보조용) |
| 비트코인 | **브라우저에서 실시간** — CoinGecko(USD·KRW·24h·60일 추이) + 업비트 KRW-BTC(김치 프리미엄), 1분마다 갱신. 스냅샷은 실패 시 대체용 |
| 주요 기업 실적 | Nasdaq 실적 캘린더 (오늘 −14일 ~ +21일, 시가총액 $50B 이상 + 관심종목 `WATCHLIST` 환경변수) |

- **주요 기업 실적:** 대시보드 카드에서 [발표 예정] / [최근 발표] 탭과 [전체 / 대형주 $200B+ / 관심종목] 필터로 볼 수 있고, 캘린더 탭에도 같은 일정이 들어갑니다. 무료 Nasdaq 캘린더에는 실제 EPS가 없어 발표된 실적은 '발표 완료 · 결과 보기' 링크로 표시합니다(Finnhub 키를 넣은 실시간 모드에서는 실제 EPS 표시). 발표 시각은 장 전/장 후만 제공됩니다.

- **자동 갱신:** Windows 작업 스케줄러 작업 `USMarketBrief - Market Data`가 매일 07:00(KST)에 `scripts/update-market-data.cmd`를 실행합니다. PC가 꺼져 있었다면 다음에 켜질 때 실행되며, 로그는 `logs/market-data.log`에 쌓입니다.
  - 지금 실행: `Start-ScheduledTask -TaskName "USMarketBrief - Market Data"`
  - 해제: `Unregister-ScheduledTask -TaskName "USMarketBrief - Market Data" -Confirm:$false`
- 열어 둔 화면은 ⟳ 버튼, 5분 자동 갱신, 또는 10분 이상 지나 탭으로 돌아올 때 최신 스냅샷을 다시 읽습니다. 스크립트는 매번 버전 쿼리를 붙여 불러오므로 브라우저 캐시 때문에 예전 파일이 섞이지 않습니다. 스냅샷이 30시간보다 오래되면 `⚠ 스냅샷 N일 전 데이터` 경고가 표시됩니다.
- 실패한 지표는 직전 스냅샷 값을 유지하고 `갱신 실패 · 이전 값` 배지를 표시합니다. 스냅샷 파일이 없으면 `MOCK_MARKET` 샘플을 보여줍니다.
- FRED 유가 현물 가격은 며칠~1주 늦게 올라오므로 카드의 기준일을 함께 확인하세요.
- 필요 환경: Node 18+, Python 3 (스킬 스크립트 실행). 경로는 `MARKET_DATA_PY`, 인터프리터는 `PYTHON` 환경변수로 바꿀 수 있습니다.

## 구조

```
index.html            레이아웃, Tailwind 설정
js/core.js            공용 헬퍼, 상태, 데이터 규격(contract)
js/mockData.js        가상 데이터: 뉴스(MOCK_NEWS), AI 브리핑(MOCK_BRIEFING),
                      이번 주 경제지표(MOCK_ECONOMIC: 날짜·시간·이벤트명·예상치·이전치),
                      이번 주 실적발표(MOCK_EARNINGS: 날짜·시간·기업명·티커·EPS 전망)
js/data.js            샘플 일정·시세 생성, MOCK_NEWS를 앱 데이터 형식으로 변환
js/api.js             Finnhub 연동 · 뉴스 분류/심리 분석 · 샘플 대체
js/marketData.js      시장 지표 스냅샷 (scripts/fetch-market-data.mjs가 생성 — 직접 수정 금지)
js/views/*.js         dashboard / news / calendar 화면, marketPanel (시장 지표 카드·차트)
scripts/              fetch-market-data.mjs — 시장 지표 수집기
js/app.js             해시 라우터, 헤더 시세, 모달, 설정, 테마
```

> 정보 제공 목적이며 투자 권유가 아닙니다.
