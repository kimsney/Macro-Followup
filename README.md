# 현정이의 매크로팔로업

매일의 거시경제 체크리스트(시장 구조 / VIX / 섹터 수급 / FedWatch / Fear&Greed / GDPNow / 종합 해석 / IB Deal)를
탭으로 확인하는 개인용 대시보드.

## 실행 방법 (숫자는 새로고침마다 자동 갱신)

```
python scripts/serve.py
```

브라우저에서 `http://localhost:8123` 접속. `python -m http.server` 대신 이 스크립트로 띄우면,
**페이지를 새로고침할 때마다 그 시점 기준 최신 수치**(지수/금리/환율/유가/섹터/VIX/Fear&Greed/GDPNow)를
백그라운드에서 다시 수집해 반영한다 (같은 데이터를 30초 안에 반복 수집하지 않도록 캐시함 - 외부
API에 과도한 부담을 주지 않기 위함). 처음 켤 때는 전체 수집 때문에 최대 30초 정도 걸릴 수 있다.

`"status": "manual_needed"`로 표시된 항목은 자동 수집에 실패한 것으로, UI에도 "수동 확인 필요"
배지로 노출된다 (예: 이 네트워크에서는 FRED 접속이 막혀 있어 GDPNow가 매번 수동확인 필요로 뜬다.
CME FedWatch는 무료 API가 없어 항상 수동/WebSearch 필요).

**분석 텍스트(WebSearch·추론이 필요한 부분)는 새로고침으로 자동 생성되지 않는다.** 숫자만 최신화되고
기존에 채워둔 분석은 그대로 보존된다. 분석을 새로 채우거나 오늘자로 갱신하려면 Claude에게
"오늘자 팔로업 분석 업데이트해줘"라고 요청한다 - 그러면 Claude가 아래 절차를 대신 실행한다.

## 분석 텍스트 채우는 법 (Claude가 수행)

생성된 JSON에서 `"analysis"` 값이 `null`인 항목들을 WebSearch/WebFetch로 조사해
거시경제 지식을 바탕으로 채워 넣는다. (지수 배열 의미, 지수별/섹터별 개별 원인, 금리차/달러/유가
변동 원인, 국내 시장 스타일, 섹터 뉴스, FedWatch 확률, Fear&Greed 극단치 원인, GDPNow 변동 원인,
종합 해석, IB 딜 뉴스) `python scripts/fetch_data.py`를 직접 실행해도 수치 스켈레톤만 갱신할 수 있다
(serve.py 없이 1회성으로 쓸 때).

**"오늘 가장 주목해야 할 이슈 TOP 3"(`market_structure.analysis.top_issues`) 소싱 기준:**
국내 개장(09:00) 전 06~09시 사이에 나온, 그날 투자 판단에 실제로 영향을 줄 만한 기사 위주로 고른다
(전날 이슈여도 오늘 트레이딩에 영향을 준다면 포함). "개장체크"/"뉴욕증시 프리뷰" 류의 프리마켓
브리핑 기사, 여러 매체가 동시에 다루는(=조회수가 높을 가능성이 큰) 헤드라인을 우선한다. 코드로
자동 수집할 수 없는 영역이라 매번 Claude가 WebSearch로 골라야 한다.

**참고**: 2026-07-17은 제헌절로 국내 증시 휴장일이다. 그래서 이 날짜의 KOSPI/KOSDAQ/국내 수급
데이터는 실제로는 직전 거래일(7/16) 마감 값이 계속 유지된다 - 버그가 아니라 휴장일에는 새 체결이
없기 때문. `python scripts/fetch_data.py`가 휴장 여부까지 자동으로 판단하지는 않으므로, 휴장일
다음 팔로업을 만들 때는 이 점을 감안해서 분석을 작성해야 한다.

## 데이터 소스 및 한계

| 항목 | 소스 | 비고 |
|---|---|---|
| 다우/S&P500/나스닥/러셀2000/VIX/DXY/WTI/KOSPI/KOSDAQ/원달러/섹터ETF | Yahoo Finance 비공식 v8 chart API | 키 불필요 |
| 미국 10년물/2년물 국채금리 | CNBC 공개 시세 API | 키 불필요 |
| KOSPI 외국인/기관/개인 순매매 | 네이버 금융 (investorDealTrendDay) | HTML 파싱 |
| 국내 업종 등락 | 네이버 금융 (sise_group) | HTML 파싱 |
| Fear & Greed Index | CNN 비공식 JSON 엔드포인트 | |
| GDPNow | FRED CSV (키 불필요) | 일부 네트워크에서 fred.stlouisfed.org 접속이 막혀 있을 수 있음 → 이 경우 Claude가 WebSearch로 대체 확인 |
| CME FedWatch 확률 | 무료 API 없음 | 항상 Claude WebSearch로 수동 채움 |
| 섹터 수급(글로벌) | SPDR 섹터 ETF 11종 등락률 | Finviz는 ToS 문제로 사용하지 않음 |
| IB Deal 뉴스 | Claude WebSearch | 더벨은 무단 크롤링 금지 정책이 있어 본문을 수집·저장하지 않고, 헤드라인·링크·짧은 요약만 인용 |

## 배포 (Netlify + GitHub Actions)

`https://github.com/kimsney/Macro-Followup`에 push되면 Netlify(`netlify.toml`, publish=".")가
자동으로 재배포한다. 숫자 데이터는 `.github/workflows/update-data.yml`이 **30분마다** 자동으로
`fetch_data.py`를 실행해 `data/`를 커밋·push하므로, VS Code를 안 열어도 숫자는 계속 갱신된다.
날짜 계산은 실행 서버 시간대와 무관하게 항상 KST 기준으로 고정했다(`fetch_data.today_kst()`,
`zoneinfo` 사용) - GitHub Actions 러너가 UTC라서 이 처리가 없으면 날짜가 어긋난다.

**분석 텍스트는 이 자동화에 포함되지 않는다** - GitHub Actions는 스크립트만 실행할 뿐 WebSearch·
추론을 못 하므로, 여전히 Claude에게 "오늘자 팔로업 분석 업데이트해줘"라고 요청해야 채워진다.
`fetch_data.py`의 `build_report()`는 저장 직전에 기존 파일을 다시 읽어 분석/수동 입력 필드
(`merge_preserving_analysis`, `PRESERVE_KEYS`)를 보존한 뒤 수치만 갱신하므로, 30분마다 도는
자동 갱신이 이미 채워둔 분석을 지우지 않는다 (이 로직이 없던 시절엔 자동 갱신이 그날 분석을
계속 덮어써 날려버리는 버그가 있었다 - `serve.py`와 동일한 병합 로직을 공유하도록 고쳤다).
완전 자동화(분석 자체를 정기적으로 채우는 것)는 로컬 Claude Desktop 앱의 폴더 기반 루틴으로
평일 08:30 KST에 실행되도록 설정해뒀다 (컴퓨터와 앱이 켜져 있어야 동작).
