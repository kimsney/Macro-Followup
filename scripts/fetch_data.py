"""
매크로 팔로업 - 일일 데이터 수집 스크립트

실행: python scripts/fetch_data.py
- 수치형 데이터(지수, 금리, 환율, 유가, 섹터, VIX, Fear&Greed, GDPNow 등)를 각 소스에서 수집해
  data/YYYY-MM-DD.json 스켈레톤을 생성/갱신한다.
- "analysis"로 표시된 정성적 필드는 이 스크립트가 채우지 않는다. Claude가 WebSearch로 조사한 뒤
  별도로 채워 넣는다 (README 참고).
"""

import csv
import io
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

KST = ZoneInfo("Asia/Seoul")


def today_kst():
    """실행 서버의 시간대와 무관하게 항상 한국 시각 기준 오늘 날짜를 반환한다
    (GitHub Actions 러너는 UTC라 이 처리가 없으면 날짜가 어긋난다)."""
    return datetime.now(KST).strftime("%Y-%m-%d")

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

YAHOO_TICKERS = {
    "dow": "^DJI",
    "sp500": "^GSPC",
    "nasdaq": "^IXIC",
    "russell2000": "^RUT",
    "vix": "^VIX",
    "dxy": "DX-Y.NYB",
    "wti": "CL=F",
    "kospi": "^KS11",
    "kosdaq": "^KQ11",
    "usdkrw": "KRW=X",
}

SECTOR_ETFS = {
    "XLK": "기술",
    "XLF": "금융",
    "XLE": "에너지",
    "XLV": "헬스케어",
    "XLY": "임의소비재",
    "XLP": "필수소비재",
    "XLI": "산업재",
    "XLB": "소재",
    "XLU": "유틸리티",
    "XLRE": "부동산",
    "XLC": "커뮤니케이션",
}

# 각 지표를 클릭했을 때 이동할 원본 출처 페이지
SOURCE_URLS = {
    "dow": "https://www.cnbc.com/quotes/.DJI",
    "sp500": "https://www.cnbc.com/quotes/.SPX",
    "nasdaq": "https://www.cnbc.com/quotes/.IXIC",
    "russell2000": "https://www.cnbc.com/quotes/.RUT",
    "vix": "https://www.cnbc.com/quotes/.VIX",
    "dxy": "https://www.cnbc.com/quotes/.DXY",
    "wti": "https://www.cnbc.com/quotes/@CL.1",
    "kospi": "https://finance.naver.com/sise/sise_index.naver?code=KOSPI",
    "kosdaq": "https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ",
    "usdkrw": "https://finance.naver.com/marketindex/",
    "us10y": "https://www.cnbc.com/quotes/US10Y",
    "us2y": "https://www.cnbc.com/quotes/US2Y",
}
SECTOR_ETF_SOURCE = "https://finance.yahoo.com/quote/{ticker}"


def _get(url, **kwargs):
    headers = kwargs.pop("headers", {})
    headers.setdefault("User-Agent", UA)
    kwargs.setdefault("timeout", 10)
    return requests.get(url, headers=headers, **kwargs)


def fetch_yahoo_quote(ticker):
    """단일 티커의 현재가/전일종가/등락률을 Yahoo Finance v8 chart 엔드포인트에서 가져온다.

    meta.previousClose/chartPreviousClose는 유동성이 낮은 지수(예: ^KQ11)에서 종종 stale한
    값을 반환하므로, 최근 5일 일봉 종가 배열에서 직접 "가장 최근 완결된 거래일 종가"를 계산한다.
    """
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    try:
        r = _get(url, params={"range": "5d", "interval": "1d"})
        r.raise_for_status()
        result = r.json()["chart"]["result"][0]
        meta = result["meta"]
        price = meta.get("regularMarketPrice")

        closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
        valid = [c for c in closes if c is not None]
        if closes and closes[-1] is None:
            # 오늘 봉이 아직 미완결 -> 마지막 유효 종가가 곧 직전 거래일 종가
            prev_close = valid[-1] if valid else None
        else:
            # 오늘 봉까지 완결됨 -> 그 이전 종가가 직전 거래일 종가
            prev_close = valid[-2] if len(valid) >= 2 else None
        if prev_close is None:
            prev_close = meta.get("previousClose") or meta.get("chartPreviousClose")

        change = None
        pct = None
        if price is not None and prev_close:
            change = round(price - prev_close, 4)
            pct = round(change / prev_close * 100, 4)
        return {
            "price": price,
            "prev_close": prev_close,
            "change": change,
            "pct_change": pct,
            "status": "ok",
        }
    except Exception as e:
        return {"price": None, "prev_close": None, "change": None, "pct_change": None,
                "status": "error", "error": str(e)}


def fetch_yahoo_all():
    out = {}
    for name, ticker in YAHOO_TICKERS.items():
        q = fetch_yahoo_quote(ticker)
        q["source"] = SOURCE_URLS.get(name)
        out[name] = q
    return out


def fetch_sector_etfs():
    out = {}
    for ticker, kr_name in SECTOR_ETFS.items():
        q = fetch_yahoo_quote(ticker)
        q["name_kr"] = kr_name
        q["source"] = SECTOR_ETF_SOURCE.format(ticker=ticker)
        out[ticker] = q
    return out


def fetch_cnbc_rates():
    """미국 10년물/2년물 국채금리 (CNBC 공개 시세 API, % 단위)."""
    url = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol"
    params = {
        "symbols": "US2Y|US10Y", "requestMethod": "itv", "noform": "1",
        "partnerId": "2", "fund": "1", "exthrs": "1", "output": "json",
    }
    try:
        r = _get(url, params=params)
        r.raise_for_status()
        quotes = {q["symbol"]: q for q in r.json()["FormattedQuoteResult"]["FormattedQuote"]}

        def parse_pct(s):
            return float(s.replace("%", "")) if s else None

        us2y = parse_pct(quotes["US2Y"]["last"])
        us10y = parse_pct(quotes["US10Y"]["last"])
        return {
            "us10y": {"value": us10y, "prev_close": parse_pct(quotes["US10Y"]["previous_day_closing"]),
                      "status": "ok", "source": SOURCE_URLS["us10y"]},
            "us2y": {"value": us2y, "prev_close": parse_pct(quotes["US2Y"]["previous_day_closing"]),
                     "status": "ok", "source": SOURCE_URLS["us2y"]},
            "spread": round(us10y - us2y, 4) if (us10y is not None and us2y is not None) else None,
            "status": "ok",
        }
    except Exception as e:
        return {
            "us10y": {"value": None, "status": "manual_needed", "source": SOURCE_URLS["us10y"]},
            "us2y": {"value": None, "status": "manual_needed", "source": SOURCE_URLS["us2y"]},
            "spread": None,
            "status": "manual_needed",
            "error": str(e),
        }


def fetch_naver_investor_flow():
    """KOSPI 외국인/기관/개인 순매매(억원, 가장 최근 거래일). 실패 시 manual_needed."""
    bizdate = today_kst().replace("-", "")
    url = f"https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate={bizdate}&sosok="
    try:
        r = _get(url)
        r.raise_for_status()
        r.encoding = "euc-kr"
        soup = BeautifulSoup(r.text, "html.parser")
        date_cell = soup.select_one("td.date2")
        if not date_cell:
            raise ValueError("data row not found")
        row = date_cell.find_parent("tr")
        cells = [c.get_text(strip=True).replace(",", "") for c in row.select("td")]
        # 컬럼 순서: 날짜, 개인, 외국인, 기관계, ...
        return {
            "as_of": cells[0],
            "individual": cells[1],
            "foreign": cells[2],
            "institution": cells[3],
            "unit": "억원",
            "status": "ok",
            "source": url,
        }
    except Exception as e:
        return {"individual": None, "foreign": None, "institution": None,
                "status": "manual_needed", "error": str(e), "source": url}


def fetch_naver_sector_group():
    """국내 업종별 등락률 상위/하위 2개."""
    url = "https://finance.naver.com/sise/sise_group.naver?type=upjong"
    try:
        r = _get(url)
        r.raise_for_status()
        r.encoding = "euc-kr"
        soup = BeautifulSoup(r.text, "html.parser")
        rows = soup.select("table.type_1 tr")
        items = []
        for row in rows:
            link = row.select_one("td a")
            pct_cell = row.select_one("td.number")
            if not link or not pct_cell:
                continue
            name = link.get_text(strip=True)
            pct_text = pct_cell.get_text(strip=True).replace("%", "").replace("+", "")
            try:
                pct = float(pct_text)
            except ValueError:
                continue
            items.append({"name": name, "pct_change": pct})
        items.sort(key=lambda x: x["pct_change"], reverse=True)
        return {
            "top_up": items[:3],
            "top_down": items[-3:][::-1] if len(items) >= 3 else [],
            "status": "ok" if items else "manual_needed",
            "source": url,
        }
    except Exception as e:
        return {"top_up": [], "top_down": [], "status": "manual_needed", "error": str(e), "source": url}


def fetch_fear_greed():
    url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    try:
        r = _get(url)
        r.raise_for_status()
        data = r.json()
        current = data["fear_and_greed"]
        return {
            "score": round(current["score"], 1),
            "rating": current["rating"],
            "timestamp": current.get("timestamp"),
            "status": "ok",
            "source": "https://edition.cnn.com/markets/fear-and-greed",
        }
    except Exception as e:
        return {"score": None, "rating": None, "status": "manual_needed", "error": str(e),
                "source": "https://edition.cnn.com/markets/fear-and-greed"}


def fetch_gdpnow():
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDPNOW"
    try:
        r = _get(url, timeout=6)
        r.raise_for_status()
        reader = list(csv.reader(io.StringIO(r.text)))
        rows = [row for row in reader[1:] if len(row) == 2 and row[1] not in ("", ".")]
        if not rows:
            raise ValueError("no data rows")
        latest_date, latest_val = rows[-1]
        prev_val = rows[-2][1] if len(rows) > 1 else None
        return {
            "value_pct": float(latest_val),
            "as_of": latest_date,
            "prev_value_pct": float(prev_val) if prev_val else None,
            "status": "ok",
            "source": "https://www.atlantafed.org/cqer/research/gdpnow",
        }
    except Exception as e:
        return {"value_pct": None, "as_of": None, "status": "manual_needed", "error": str(e),
                "source": "https://www.atlantafed.org/cqer/research/gdpnow"}


def fetch_fedwatch():
    """CME FedWatch는 공식 무료 API가 없음 (유료 OAuth API만 제공).
    best-effort로 표시하고, 실패 시 Claude가 뉴스 검색으로 오늘/전날/전주 확률을 수동 채운다."""
    empty = {"ease_pct": None, "no_change_pct": None, "hike_pct": None}
    return {
        "meeting_date": None,
        "today": dict(empty),
        "prev_day": dict(empty),
        "prev_week": dict(empty),
        "status": "manual_needed",
        "note": "CME FedWatch 무료 API 없음 - Claude WebSearch로 오늘/전날/전주 확률을 수동 기입 필요",
        "source": "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
    }


def build_report_data(date_str=None):
    """수치 데이터를 수집해 report dict를 만들어 반환한다 (디스크에 쓰지 않는다).
    serve.py처럼 느린 수집 도중 파일을 직접 건드리면 안 되는 호출자를 위한 순수 버전."""
    if date_str is None:
        date_str = today_kst()

    print("Yahoo Finance 데이터 수집 중...")
    yahoo = fetch_yahoo_all()
    sectors = fetch_sector_etfs()

    print("CNBC 국채 금리 수집 중...")
    rates = fetch_cnbc_rates()

    print("네이버 금융 데이터 수집 중...")
    investor_flow = fetch_naver_investor_flow()
    sector_group_kr = fetch_naver_sector_group()

    print("Fear & Greed 지수 수집 중...")
    fear_greed = fetch_fear_greed()

    print("GDPNow 수집 중...")
    gdpnow = fetch_gdpnow()

    print("FedWatch 확인 중 (best-effort)...")
    fedwatch = fetch_fedwatch()

    indices = {k: yahoo[k] for k in ["dow", "sp500", "nasdaq", "russell2000"]}
    order_vals = [(k, v["pct_change"]) for k, v in indices.items() if v["pct_change"] is not None]
    order_desc = [k for k, _ in sorted(order_vals, key=lambda x: x[1], reverse=True)]
    normal_order = order_desc == ["dow", "sp500", "nasdaq", "russell2000"] or \
                   order_desc[::-1] == ["dow", "sp500", "nasdaq", "russell2000"]

    vix_val = yahoo["vix"]["price"]

    report = {
        "date": date_str,
        "generated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "sections": {
            "market_structure": {
                "global_indices": indices,
                "index_order": {
                    "order_desc_by_pct": order_desc,
                    "normal_order": normal_order,
                },
                "rates": rates,
                "dxy": yahoo["dxy"],
                "wti": yahoo["wti"],
                "domestic_indices": {
                    "kospi": yahoo["kospi"],
                    "kosdaq": yahoo["kosdaq"],
                },
                "investor_flow_kospi": investor_flow,
                "usdkrw": yahoo["usdkrw"],
                "analysis": {
                    "top_issues": [],
                    "index_order_meaning": None,
                    "index_cause": {"dow": None, "sp500": None, "nasdaq": None, "russell2000": None},
                    "rate_spread_cause": None,
                    "dxy_cause": None,
                    "wti_cause": None,
                    "kr_market_style": None,
                    "investor_flow_note": None,
                    "fx_cause": None,
                },
            },
            "vix": {
                "value": vix_val,
                "elevated": (vix_val is not None and vix_val >= 20),
                "source": SOURCE_URLS["vix"],
                "analysis": {"cause": None},
            },
            "sector_flow": {
                "global_sector_etfs": sectors,
                "domestic_sector_groups": sector_group_kr,
                "analysis": {
                    "us_market_news": None,
                    "kr_market_news": None,
                    "etf_causes": {ticker: None for ticker in SECTOR_ETFS},
                    "kr_sector_causes": {},
                },
            },
            "fedwatch": {
                **fedwatch,
                "comparison": {"vs_prev_day": None, "vs_prev_week": None},
                "macro_articles": [],  # {type: 금리/환율/유가/통화정책/거시경제, title, link, insight}
                "analysis": {"related_news": None},
            },
            "fear_greed": {
                **fear_greed,
                "analysis": {"extreme_cause": None},
            },
            "gdpnow": {
                **gdpnow,
                "analysis": {"change_cause": None},
            },
            "synthesis": {"analysis": None},
            "ib_deal": {"articles": [], "analysis": None},
        },
    }
    return report


# 섹션별로 "자동 재수집 시 건드리지 않고 보존할 필드" - 전부 분석/WebSearch 기반이거나
# (fedwatch처럼) 자동 소스가 없어 Claude가 수동으로 채워둔 값들이다. GitHub Actions의 정기
# 수치 갱신이 이 필드들을 지우지 않도록 build_report()와 serve.py가 공통으로 사용한다.
PRESERVE_KEYS = {
    "market_structure": ["analysis"],
    "vix": ["analysis"],
    "sector_flow": ["analysis"],
    "fedwatch": ["analysis", "meeting_date", "today", "prev_day", "prev_week",
                 "comparison", "macro_articles", "note", "status"],
    "fear_greed": ["analysis"],
    "gdpnow": ["analysis"],
    "synthesis": ["analysis", "source"],
    "ib_deal": ["articles", "analysis", "source"],
}


def merge_preserving_analysis(fresh, old):
    """기존 파일(old)에 이미 채워진 분석/수동 입력 필드를 새로 수집한 데이터(fresh)에
    그대로 옮겨 보존한다."""
    if not old:
        return fresh
    for section, keys in PRESERVE_KEYS.items():
        old_sec = old.get("sections", {}).get(section)
        fresh_sec = fresh.get("sections", {}).get(section)
        if not old_sec or fresh_sec is None:
            continue
        for k in keys:
            if k in old_sec:
                fresh_sec[k] = old_sec[k]
    return fresh


def build_report(date_str=None):
    """build_report_data로 수집한 뒤 파일에 쓰고 index.json을 갱신한다 (CLI/1회성 실행용,
    GitHub Actions도 이 경로를 사용). 같은 날짜 파일이 이미 있으면 분석/수동 입력 필드를
    보존한 채로 수치만 갱신한다 - 그래야 정기 자동 수집이 채워둔 분석을 지우지 않는다."""
    report = build_report_data(date_str)
    date_str = report["date"]

    DATA_DIR.mkdir(exist_ok=True)
    out_path = DATA_DIR / f"{date_str}.json"

    old = None
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            old = None
    report = merge_preserving_analysis(report, old)

    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장 완료: {out_path}")

    update_index(date_str)
    return report


def update_index(date_str):
    index_path = DATA_DIR / "index.json"
    dates = []
    if index_path.exists():
        try:
            dates = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            dates = []
    if date_str not in dates:
        dates.append(date_str)
    dates = sorted(set(dates), reverse=True)
    index_path.write_text(json.dumps(dates, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    build_report(date_arg)
