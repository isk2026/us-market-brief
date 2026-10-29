# US Market Brief

미국 주식 시장을 한국 투자자 관점(한국시간 KST 기준)에서 한눈에 보는 싱글 페이지 웹 앱입니다.
시장 위험도·지표, 글로벌 증시, 채권·금리·환율·원자재, 섹터 ETF, 반도체, 뉴스, 경제지표·실적 캘린더를 제공합니다.

- 사이트: https://isk2026.github.io/us-market-brief/ (GitHub Pages)
- 저장소: https://github.com/isk2026/us-market-brief
- 개발 규칙·주의사항(사람·AI 에이전트 공통): [AGENTS.md](AGENTS.md)

> 정보 제공 목적이며 투자 권유가 아닙니다.

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 화면 | HTML 1개(`index.html`) + **Vanilla JavaScript**(ES2020+, 모듈 번들러 없음, IIFE + `window.UMB` 네임스페이스) |
| 스타일 | **Tailwind CSS Play CDN**(`cdn.tailwindcss.com`, `darkMode: 'class'`), Noto Sans KR(Google Fonts), 차트 색상은 `index.html`의 CSS 변수 |
| 차트 | 직접 그린 SVG/HTML(스파크라인·막대·히트맵·게이지) — 차트 라이브러리 없음 |
| 데이터 수집 | **Node.js 18+**(권장 22) ES 모듈 스크립트(`scripts/*.mjs`), 외부 npm 패키지 없음 |
| 보조 수집 | (로컬 PC만) Python 3 + `multi-asset-morning-briefing` 스킬의 `market_data.py` — 없으면 직접 호출로 대체 |
| 배포 | GitHub Actions(`.github/workflows/refresh-data.yml`) → GitHub Pages(아티팩트 배포) |
| 저장 | 브라우저 localStorage(API 키·관심종목·즐겨찾기·테마·Finnhub 캐시). 서버·DB 없음 |

**빌드 단계가 없습니다.** `package.json`, `node_modules`, 트랜스파일, 번들링 모두 없음 — 파일을 고치면 그대로 반영됩니다.

## 실행

```bash
# 정적 서버로 실행 (index.html을 file://로 직접 열어도 대부분 동작)
python -m http.server 8000        # 또는: npx serve .
# → http://localhost:8000/#/dashboard
```

데이터 스냅샷을 직접 다시 만들려면(네트워크 필요, 각 수십 초):

```bash
node scripts/fetch-market-data.mjs   # js/marketData.js  (대시보드·글로벌 증시·캘린더 실적)
node scripts/fetch-macro-data.mjs    # js/macroData.js   (채권·금리·환율·원자재 탭)
node scripts/fetch-sector-data.mjs   # js/sectorData.js  (섹터 ETF 탭)
node scripts/fetch-semi-data.mjs     # js/semiData.js    (반도체 탭)
```

환경변수: `WATCHLIST`(기본 `AAPL,NVDA,MSFT,TSLA`), `MARKET_DATA_PY`(스킬 스크립트 경로), `PYTHON`(인터프리터).
스킬 없이 GitHub Actions와 같은 조건으로 시험하려면 `MARKET_DATA_PY=/nonexistent node scripts/...`.

### 검증

자동 테스트는 없습니다. 변경 후 다음을 확인합니다.

```bash
for f in js/*.js js/views/*.js scripts/*.mjs; do node --check "$f"; done   # 문법
```

- 브라우저(또는 헤드리스 Edge/Chrome)로 각 탭(`#/dashboard`, `#/global`, `#/macro`, `#/sector`, `#/semi`, `#/news`, `#/calendar`)을 열어 콘솔 오류·레이아웃 확인. 모바일 폭(약 500px)과 다크 모드도 확인.
- 헤드리스 예: `msedge --headless=new --window-size=500,2200 --virtual-time-budget=20000 --screenshot=out.png "http://localhost:8000/#/dashboard"`
- 수집 스크립트를 실행했다면 끝에 출력되는 표(섹션별 ok / stale / failed)를 확인.

## 화면

| 경로 | 파일 | 내용 |
| --- | --- | --- |
| `#/dashboard` | `views/dashboard.js` (+ `riskSensor.js`, `premarket.js`, `marketPanel.js`) | 시장 위험도 센서(VIX·CNN 공포탐욕 → 안정/유의/공포), 프리마켓 특징주(Finnhub 키 필요), 오늘의 마켓 브리핑, 시장 지표 카드(미 국채·VIX·유가·비트코인·공포탐욕·AAII), 주요 뉴스, 다음 핵심 이벤트, 이번 주 일정, 주요 기업 실적 |
| `#/global` | `views/global.js` | 아시아·유럽·미국 지수 19종(지수 선물 2종 포함): 오늘 등락률 차트, 지역별 카드(3개월 추이·기간 수익률·52주 범위·개장 상태), 표 보기, 코스피·코스닥 한국은행 공식 종가 |
| `#/macro` | `views/macro.js` | 핵심 신호, 미 국채 수익률 곡선(오늘·1개월·1년 전), 금리·신용·물가 추이, 주요국 10년물, 채권 ETF, 환율(ECB 기준환율 포함), 원자재와 금/은·구리/금 비율 |
| `#/sector` | `views/sector.js` | SPDR 섹터 ETF 11종 vs SPY: 기간별 성과·초과수익, 경기민감/방어 그룹, 수익률 히트맵, ETF 카드 |
| `#/semi` | `views/semi.js` | SOX 지수와 공식 구성종목 + 비구성 주요 종목(한국·대만·일본·유럽): 상대 성과, 히트맵, 세그먼트, 종목 비교표, 밸류에이션·수익성·효율 비교, 반도체 실적 일정 |
| `#/news` | `views/news.js` | 경제지표 요약, 뉴스 필터(중요도·카테고리·심리·키워드·관심종목), 상세 모달(←/→, Esc) |
| `#/calendar` | `views/calendar.js` | 경제지표·FOMC·실적·휴장 캘린더(주간/월간/목록, KST 배치 + ET 병기), 즐겨찾기 |

## 구조

```
index.html                     레이아웃·헤더·모달, Tailwind 설정, 차트 CSS 변수, 스크립트 로드 순서
js/
  core.js                      window.UMB: 공용 헬퍼($, esc, 날짜), localStorage(store/KEYS), 상수, ui 컴포넌트, 상태(state), 데이터 규격
  finnhub.js                   Finnhub REST 클라이언트 (키 보호, 속도 제한, 캐시, 오류 매핑)
  marketData.js                ⚙ 생성 파일 — 시장 지표 스냅샷 (fetch-market-data.mjs)
  mockData.js                  샘플 뉴스·브리핑·경제지표·실적·시장 지표(MOCK_*)
  data.js                      샘플 데이터 → 앱 데이터 형식 변환 (UMB.sample)
  api.js                       데이터 로딩 (뉴스 RSS 실시간, Finnhub, 스냅샷 재로드, 비트코인 실시간) (UMB.api)
  live.js                      CNBC 실시간 시세 오버레이 (UMB.live)
  macroData.js / sectorData.js / semiData.js   ⚙ 생성 파일 — 각 탭 스냅샷 (탭을 열 때 지연 로드)
  views/*.js                   화면별 모듈: UMB.views.<route> = { render(container), unmount() }
  app.js                       해시 라우터, 헤더 시세 띠, 모달·토스트, 설정, 테마, 자동 갱신 타이머 (마지막에 로드)
scripts/
  fetch-market-data.mjs        금리·VIX·유가·공포탐욕·AAII·실적·경제지표 일정·뉴스(RSS)·비트코인·글로벌 지수 → js/marketData.js
  fetch-macro-data.mjs         재무부 곡선·FRED·ECB·환율·원자재·채권 ETF → js/macroData.js
  fetch-sector-data.mjs        섹터 ETF → js/sectorData.js
  fetch-semi-data.mjs          SOX 구성종목·반도체 종목·재무 → js/semiData.js
  restore-published-snapshots.mjs  (Actions) 배포 중인 최신 스냅샷을 "이전 값"으로 복원
  update-market-data.cmd       (로컬 Windows 예약 작업) 4개 수집 + 스냅샷만 커밋·push
.github/workflows/refresh-data.yml   15분 주기 수집 + Pages 배포 (실행이 다음 실행을 예약하는 체인)
logs/                          로컬 예약 작업 로그 (git 제외)
```

### 런타임 흐름

1. `index.html`이 스크립트를 순서대로 로드(매번 `?v=타임스탬프` 부착 → 캐시된 옛 파일과 섞이지 않음): `core → finnhub → marketData → mockData → data → api → live → views/* → app`.
2. `app.js`가 `UMB.api.load()` 호출 → `state.market`(스냅샷 얕은 복사), 뉴스(CNBC·MarketWatch RSS 실시간 + 스냅샷, 키가 있으면 Finnhub 뉴스 병합)·일정(Nasdaq 스냅샷)·시세 채움 → `UMB.live.refresh()`로 실시간 시세 덮어쓰기 → 현재 라우트의 `view.render()`.
3. 갱신 주기: 스냅샷·뉴스 재로드 5분(뉴스 피드는 2분 캐시), 실시간 시세 1분, 비트코인 1분, 탭 복귀 시 즉시(10분 이상 지났으면 전체 재로드), ⟳ 버튼은 강제 갱신.
4. 매크로·섹터·반도체 탭은 처음 열 때 `js/<name>Data.js`를 `<script>`로 지연 로드하고 4분 지나면 다시 읽습니다.

## 데이터

브라우저에서 직접 호출할 수 없는(CORS 차단) 원천이 대부분이라 **3단계**로 나뉩니다.

| 단계 | 방식 | 주기 | 대상 |
| --- | --- | --- | --- |
| ① 브라우저 실시간 | `js/live.js` (CNBC 시세), `js/api.js` (CNBC·MarketWatch RSS, CoinGecko·업비트, Finnhub) | 1분(뉴스 5분) / 화면 복귀 / ⟳ | 글로벌 지수·지수 선물·VIX·미 국채 장중 금리·환율·원자재 선물·ETF·미국/일본/대만/홍콩/유럽 상장 종목, 뉴스, 비트코인, (키 입력 시) Finnhub 뉴스·실적·ETF 시세 |
| ② 서버 스냅샷 | GitHub Actions가 `scripts/fetch-*.mjs` 실행 → Pages 배포(커밋 안 함) | 평일 15분, 주말 6시간 (+토 새벽·일 저녁) | 위 항목의 이력·기간 수익률·52주 범위·재무, 한국 상장 종목, CNN 공포탐욕, AAII, 재무부·FRED 금리, ECB, 실적·경제지표 캘린더(실제 EPS·실제치 포함), 뉴스(Nasdaq RSS 포함) |
| ③ 로컬 예약 작업 | Windows 작업 `USMarketBrief - Market Data`, 매일 07:00 KST | 1일 | ②와 같은 수집 + 스킬 전용 데이터(한국은행 ECOS 코스피·코스닥 공식 종가) → 4개 스냅샷 파일만 커밋·push |

| 데이터 | 원천 |
| --- | --- |
| 미 국채 금리(종가) | 미 재무부 par yield CSV (로컬은 스킬 경유) |
| VIX | Cboe CSV (+ 실시간 CNBC) |
| 유가 | FRED 현물(약 1주 지연) + NYMEX/ICE 선물(Yahoo, + 실시간 CNBC) |
| CNN Fear & Greed | CNN dataviz 공개 엔드포인트 |
| AAII 개인투자자 심리 | AAII 결과 페이지 — **주간**: 목~수 설문, 수요일 날짜로 **목요일(미 동부) 발표**. 이번 주 결과가 이미 있으면 재조회하지 않고, 목요일부터 새 결과가 나올 때까지만 조회. 카드에 설문 마감·발표·다음 발표일 표시 |
| 글로벌 지수·환율·원자재·ETF·종목 | Yahoo Finance 차트/시세 (+ 실시간 CNBC) |
| 연준 금리·TIPS·BEI·신용 스프레드·주요국 10년 | FRED (스킬 → 실패 시 공개 CSV 직접) |
| SOX 구성종목 | Nasdaq Global Indexes |
| 실적 일정·실제 EPS | Nasdaq 실적 캘린더(오늘 −14일 ~ +21일, 시총 $50B+ + `WATCHLIST`) — 행에 실제 EPS·서프라이즈가 들어오면 그대로 사용, 없으면 Nasdaq earnings-surprise로 보완. Finnhub 키가 있으면 Finnhub 일정 우선이되 Finnhub에 실제 EPS가 아직 없으면 스냅샷 값 사용 |
| 경제지표·FOMC | Nasdaq 경제 캘린더(미국, 오늘 −14일 ~ +28일, 주요 지표만 한국어 제목·중요도 부여 — `ECON_EVENTS`) — 실제·예상·이전 값. 실제치는 발표 시각(ET)이 지난 뒤에만 표시 |
| 뉴스 | CNBC(Top News·Markets·Economy·Earnings·Tech)·MarketWatch Bulletins RSS(브라우저 실시간) + Nasdaq Markets RSS(스냅샷), 최근 3일·중복 제거. 카테고리·심리·중요도·관련 종목은 헤드라인 키워드 규칙(`api.js`). Finnhub 키가 있으면 Finnhub 뉴스와 병합. 마켓 브리핑은 이 뉴스와 S&P 500·나스닥 등락으로 자동 생성. 피드가 모두 실패할 때만 샘플 뉴스 |
| 휴장 | 규칙 기반 계산(`data.js`). 스냅샷이 없을 때만 경제지표·FOMC도 샘플 생성기 사용 |
| 비트코인 | CoinGecko + 업비트(김치 프리미엄), 브라우저 실시간 |

**실패·지연 처리**
- 수집 실패 섹션은 직전 값을 유지하고 `stale: true` → 화면에 `갱신 실패 · 이전 값` 배지. 값을 지어내지 않습니다.
- 스냅샷이 8시간 넘게 안 바뀌면 `⚠ 스냅샷 N시간 전 데이터` 경고(자동 갱신이 멈췄다는 신호).
- 실시간 시세가 반영 중이면 각 화면 상단에 `● 실시간 시세 HH:MM`. CNBC 실패 시 조용히 스냅샷 표시.
- 스냅샷 파일이 없으면 `MOCK_MARKET` 샘플을 보여줍니다.

### Finnhub (선택)

⚙ 설정에 [Finnhub](https://finnhub.io/register) 무료 키를 넣으면 뉴스, 실적 일정(`calendar/earnings`), 실적 서프라이즈(`stock/earnings`), ETF 시세(`quote`)를 불러옵니다.
`js/finnhub.js`: 키는 localStorage에만 저장·Finnhub로만 전송, 로그·오류·캐시 키에 남기지 않음, 동시 4개·분당 50회 큐, 429 백오프, 10초 타임아웃, TTL 캐시(뉴스 5분·일정 30분·시세 1분·서프라이즈 12시간). 프론트엔드 앱이라 키를 완전히 숨길 수는 없으니 무료 키만 사용하세요.

## 배포·운영

- **GitHub Pages 소스는 "GitHub Actions"** 입니다. `master`에 push하면 워크플로가 수집 후 배포합니다(약 5분). 수동 실행: Actions → *Refresh market data* → *Run workflow*, 또는 `gh workflow run refresh-data.yml`.
- 워크플로 파일을 push하려면 GitHub 토큰에 `workflow` 권한이 필요합니다(`gh auth refresh -h github.com -s workflow`).
- GitHub 예약(cron) 실행은 부하 시 몇 시간씩 밀리거나 빠지므로, 워크플로의 `chain` 잡이 활성 시간대(평일·토 새벽·일 저녁 UTC)에 실행 시작 약 15분 뒤 `workflow_dispatch`로 다음 실행을 직접 예약합니다. 동시성 그룹 때문에 실행 1개 + 대기 1개만 존재해 체인이 늘어나지 않고, 체인이 끊기면 cron이 다시 시작합니다. 멈추려면 Actions에서 워크플로를 Disable 하세요.
- 예약 워크플로는 저장소 활동이 60일 없으면 GitHub가 끕니다(로컬 07:00 커밋이 있으면 유지).
- 로컬 예약 작업: 지금 실행 `Start-ScheduledTask -TaskName "USMarketBrief - Market Data"`, 해제 `Unregister-ScheduledTask -TaskName "USMarketBrief - Market Data" -Confirm:$false`, 로그 `logs/market-data.log`. `master`가 아니거나 수집 실패·변경 없음이면 커밋하지 않고, 스냅샷 4개 외 파일은 건드리지 않습니다.
- 사용자 데이터(API 키 `umb.apiKey`, 관심종목 `umb.watchlist`, 즐겨찾기 `umb.favoriteEvents`, 테마 `umb.theme`)는 브라우저 localStorage에만 있습니다.
