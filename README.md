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
| `#/dashboard` | **시장 위험도 센서**(VIX·CNN 공포탐욕 지수 → 안정/유의/공포 3단계, Finnhub 키가 있으면 VIXY 실시간 급등도 반영), **프리마켓 특징주**(Finnhub 실시간 시세, 미국 장 세션 표시·30초 갱신·변동률 순·가격 변화 하이라이트, 키 필요), **오늘의 마켓 브리핑**(AI 브리핑 카드), 핵심 지표, 주요 뉴스, 다음 핵심 이벤트 카운트다운, 이번 주 일정, 다가오는 실적 발표 |
| `#/global` | **글로벌 증시** — 코스피·코스닥·닛케이 225·항셍·상하이·대만 / STOXX 600·유로 STOXX 50·영국 FTSE 100·독일 DAX·프랑스 CAC 40 / S&P 500·나스닥 종합·다우·나스닥 100·필라델피아 반도체(SOX)·S&P 500 선물·나스닥 100 선물(CME 24시간 거래 시간 기준 상태 표시). 오늘의 등락률 차트, 지역별(아시아·유럽·미국) 카드(현재가·등락·3개월 추이·1주/1개월/3개월/연초 대비·52주 범위·거래소 개장 상태), 표 보기. 코스피·코스닥은 한국은행 ECOS 공식 종가(스킬)도 표시 |
| `#/macro` | **채권·금리·환율·원자재** — 핵심 신호(미 10년·2s10s·실질금리·하이일드 스프레드·달러 인덱스·원/달러), 미 국채 수익률 곡선(오늘·1개월 전·1년 전, 2s10s·3M–10Y·연준 기준금리), 금리·신용·물가 추이(3개월·2년·10년, TIPS 실질금리, 기대인플레, HY·IG 스프레드), 주요국 10년 국채금리, 채권 ETF(TLT·IEF·SHY·AGG·LQD·HYG·TIP), 환율(DXY·원/달러·엔·유로·위안·파운드, ECB 기준환율), 원자재(WTI·브렌트·천연가스·금·은·구리·옥수수·밀·대두)와 금/은·구리/금 비율 |
| `#/sector` | **섹터 ETF** — SPDR Select Sector 11종(XLK·XLC·XLY·XLF·XLI·XLB·XLE·XLRE·XLU·XLP·XLV)과 SPY 비교. 기간(1일~1년)별 섹터 성과와 SPY 대비 초과 수익률, 경기민감/경기민감·성장/방어 그룹 평균과 '방어 − 경기민감' 스프레드, 정렬 가능한 기간별 수익률 히트맵, ETF 카드(6개월 추이·보수율·운용자산·배당수익률·PER·베타·52주 위치·상위 보유종목) |
| `#/semi` | **반도체** — 필라델피아 반도체 지수(SOX)와 Nasdaq 공식 구성종목(현재 30개, TSMC ADR·ASML 포함) + 비구성 주요 종목(삼성전자·SK하이닉스·한미반도체·TSMC 대만 본주·도쿄일렉트론·어드반테스트·디스코·르네사스·인피니언·ST마이크로·ASM 인터내셔널·BESI·SMIC·시놉시스·케이던스·앰코). SOX·SMH·SOXX, 구성종목 상승/하락, 상대 성과(SOX·TSMC·삼성전자·SK하이닉스·NVIDIA, 시작=100), 시가총액 순 히트맵, 세그먼트별 성과, 정렬 가능한 종목 비교표(시총·1일~연초 대비·52주 위치·다음 실적), **밸류에이션·수익성·효율 비교**(PER·Forward PER·PEG·PBR·EV/EBITDA·배당수익률 / 매출총이익률·영업이익률·순이익률·ROE·매출 성장률 / Capex/매출·재고자산 회전율·재고일수·FCF 마진·매출, 중앙값 행, 지표 설명 툴팁, Forward PER × 영업이익률 산점도), 다가오는 반도체 실적. 필터: 전체/SOX 구성/비구성/한국/관심종목·세그먼트 |
| `#/news` | **뉴스 및 지표 요약** — 최근 발표·예정 경제지표(실제/예상/이전, 예상 상회·하회), 중요도(High/Medium/Low) · 카테고리 · 심리 · 키워드 · 관심종목 필터, 중요도순 정렬, High 뉴스 강조 카드. 카드를 클릭(또는 Enter)하면 **상세 모달** — 요약·관련 종목·관련 일정(KST), ‹ 이전 / 다음 › 및 ←/→ 키 이동, Esc로 닫기 |
| `#/calendar` | **경제지표 · 실적 캘린더** — [전체 보기] [경제지표만] [실적발표만] 필터 칩, 주간(기본) / 월간 / 목록 보기, 중요도 필터. 모든 일정은 **한국시간(KST)** 기준으로 날짜·시각을 배치하고 미국 현지 시각(ET)을 보조 표기, 발표된 지표·실적은 예상 대비 상회/하회 표시. 일정 카드 오른쪽 **☆ 즐겨찾기** 버튼으로 저장하고 [★ 즐겨찾기] 칩으로 저장한 일정만 모아보기 |

## 데이터

- **기본값: 샘플 데이터.** 오늘 날짜 기준으로 만들어지므로 언제 열어도 일정이 채워져 있습니다.
- **실시간:** ⚙ 설정에 [Finnhub](https://finnhub.io/register) 무료 API 키를 넣으면 뉴스, 실적 발표 일정, 지수 ETF(SPY/QQQ/DIA/IWM) 시세를 불러오고 5분마다 갱신합니다.
  경제지표 캘린더는 Finnhub 유료 기능이라 샘플 일정을 계속 사용합니다.
- 실시간 모드의 뉴스 중요도는 키워드·대형주 기준 규칙으로, 마켓 브리핑은 수집 데이터로 자동 생성합니다. AI API를 붙일 때는 `js/api.js`의 `buildBriefing()`만 교체하면 됩니다.
- `MOCK_ECONOMIC` / `MOCK_EARNINGS`의 날짜는 "이번 주 n요일"로 계산되고 시간은 미국 동부시간(ET) 원본 그대로 저장합니다. 화면 표시 때 서머타임을 반영해 KST로 변환하며, 실제치는 발표 시각이 지난 뒤에만 노출됩니다.
- API 키, 관심 종목, 즐겨찾기한 일정(`umb.favoriteEvents`)은 브라우저의 localStorage에만 저장됩니다. 실적 일정 ID는 샘플·실시간 모드 모두 `earn-티커-날짜` 형식이라 데이터 소스를 바꿔도 즐겨찾기가 유지됩니다.

## Finnhub 실시간 연동

⚙ 설정에 [Finnhub](https://finnhub.io/register) 무료 키를 넣고 **연결 테스트**로 확인한 뒤 저장하면 실시간 모드로 전환됩니다.

| 엔드포인트 | 용도 |
| --- | --- |
| `calendar/earnings` | 오늘 −7일 ~ +30일 실적 일정. 이 범위에서는 Finnhub 값(날짜·장 전/후·EPS 예상·실제)이 우선이고, Nasdaq 스냅샷은 기업명·시가총액만 보충. Finnhub가 비어 있으면 스냅샷 유지 |
| `stock/earnings` (Earnings Surprises) | 최근 14일 내 발표 기업 중 관심종목·시가총액 순 상위 20곳의 실제/예상 EPS·서프라이즈 % → **▲ Surprise / ▼ Miss / ■ In line** 배지 (대시보드 '최근 발표' 탭, 캘린더 카드) |
| `news`, `quote` | 시장 뉴스, 지수 ETF 시세 |

**보안·호출 구조 (`js/finnhub.js`)**
- 키는 이 브라우저 localStorage에만 저장하고 Finnhub로만 전송합니다. 먼저 `X-Finnhub-Token` 헤더 전송을 시도하지만 Finnhub의 CORS 설정이 이 헤더를 허용하지 않아, 실제로는 세션당 한 번 확인 후 URL 파라미터(`?token=`)로 전환됩니다. `referrerPolicy: no-referrer`·`cache: no-store`·`credentials: omit`으로 다른 사이트나 HTTP 캐시에 주소가 남지 않게 합니다(개발자 도구 네트워크 탭에는 보일 수 있음).
- 키는 화면(설정 창에는 끝 4자리만), 콘솔 로그, 오류 메시지, 캐시 키 어디에도 남기지 않습니다.
- 무료 플랜 한도(분당 60회)에 맞춰 동시 4개 · 분당 50회 큐, 429 응답 시 백오프 재시도, 10초 타임아웃, 응답 캐시(뉴스 5분 · 일정 30분 · 시세 1분 · 서프라이즈 12시간), 동일 요청 중복 제거.
- 한계: 백엔드 없는 프론트엔드 앱이라 키를 완전히 숨길 수는 없습니다. 기기에 접근 가능한 사람은 키를 볼 수 있으므로 공용 PC에서는 저장하지 말고 무료 키만 쓰세요.

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
| 글로벌 지수 18종 (선물 2종 포함) | Yahoo Finance 차트(1년 일봉). 코스피·코스닥 공식 종가는 스킬의 한국은행 ECOS |
| 채권·금리·환율·원자재 탭 (`js/macroData.js`) | `node scripts/fetch-macro-data.mjs` — 미 재무부 수익률 곡선 CSV, FRED(연준 금리·TIPS·BEI·신용 스프레드·주요국 10년)와 ECB 기준환율은 multi-asset-morning-briefing 스킬, 환율·원자재·채권 ETF는 Yahoo Finance. 탭을 열 때만 불러오며 매일 07:00 예약 작업에 포함 |
| 섹터 ETF 탭 (`js/sectorData.js`) | `node scripts/fetch-sector-data.mjs` — Yahoo Finance 차트·펀드 정보. 탭을 열 때만 불러오며 매일 07:00 예약 작업에 포함 |
| 반도체 탭 (`js/semiData.js`) | `node scripts/fetch-semi-data.mjs` — SOX 구성종목은 Nasdaq Global Indexes에서 매번 조회, 가격·수익률은 Yahoo Finance, 시가총액은 Yahoo 시세(USD 환산). 반도체 탭을 열 때만 불러오며 매일 07:00 예약 작업에 포함 |
| 주요 기업 실적 | Nasdaq 실적 캘린더 (오늘 −14일 ~ +21일, 시가총액 $50B 이상 + 관심종목 `WATCHLIST` 환경변수) |

- **주요 기업 실적:** 대시보드 카드에서 [발표 예정] / [최근 발표] 탭과 [전체 / 대형주 $200B+ / 관심종목] 필터로 볼 수 있고, 캘린더 탭에도 같은 일정이 들어갑니다. 무료 Nasdaq 캘린더에는 실제 EPS가 없어 발표된 실적은 '발표 완료 · 결과 보기' 링크로 표시합니다(Finnhub 키를 넣은 실시간 모드에서는 실제 EPS 표시). 발표 시각은 장 전/장 후만 제공됩니다.

- **준실시간 갱신 (GitHub Actions):** `.github/workflows/refresh-data.yml`이 평일 15분마다(토 새벽 미국 시간외·일 저녁 선물 재개 포함, 주말은 6시간마다) 4개 수집 스크립트를 실행하고 GitHub Pages에 바로 배포합니다. 데이터는 커밋하지 않고 Pages 아티팩트로만 올리며, 매 실행 전에 `scripts/restore-published-snapshots.mjs`가 배포 중인 최신 스냅샷을 "이전 값"으로 복원합니다. 열어 둔 화면은 Finnhub 키가 없어도 5분마다 새 스냅샷을 읽습니다. Actions에는 스킬이 없으므로 FRED는 공개 CSV로 직접 받고, 한국은행 ECOS 공식 종가는 직전 값을 유지합니다(로컬 07:00 작업이 갱신). 스냅샷이 8시간 넘게 갱신되지 않으면 경고가 표시됩니다.
  - **AAII 개인투자자 심리는 주간 데이터**입니다(목~수 설문, 수요일 날짜로 목요일 발표·미 동부 기준). 직전 결과가 이번 주 것이면 다시 조회하지 않고, 목요일부터 새 결과가 나올 때까지만 조회합니다. 카드에 설문 마감일·발표일·다음 발표일이 표시됩니다.
  - 공개 저장소의 예약 워크플로는 60일간 저장소 활동이 없으면 GitHub가 자동으로 꺼집니다(로컬 07:00 커밋이 있으면 유지).
- **자동 갱신 (로컬):** Windows 작업 스케줄러 작업 `USMarketBrief - Market Data`가 매일 07:00(KST)에 `scripts/update-market-data.cmd`를 실행합니다. PC가 꺼져 있었다면 다음에 켜질 때 실행되며, 로그는 `logs/market-data.log`에 쌓입니다.
  - 수집이 성공하면 `js/marketData.js`만 `data: market snapshot YYYY-MM-DD`로 커밋해 `origin/master`에 push하고, GitHub Pages(https://isk2026.github.io/us-market-brief/)가 새 데이터로 재배포됩니다. 수집 실패, `master`가 아닌 브랜치, 변경 없음일 때는 건너뜁니다. 다른 작업 중인 파일은 커밋되지 않습니다.
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
