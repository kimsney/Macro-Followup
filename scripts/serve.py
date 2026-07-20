"""
매크로 팔로업 - 새로고침 시 자동 갱신되는 로컬 서버

정적 파일을 서빙하면서, 페이지를 새로고침할 때마다 오늘 날짜의 수치 데이터
(지수/금리/환율/유가/섹터/VIX/Fear&Greed/GDPNow 등)를 그 시점 기준으로 다시
수집해 최신 상태로 유지한다.

분석 텍스트(WebSearch 조사·추론이 필요한 부분)는 자동으로 만들 수 없으므로
새로고침 때 건드리지 않고 기존에 채워둔 내용을 그대로 보존한다. FedWatch의
수동 입력값(인하/동결/인상 확률 등)도 마찬가지로 보존한다.

실행: python scripts/serve.py [포트, 기본 8123]
"""
import json
import sys
import threading
import time
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_data  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

CACHE_SECONDS = 30  # 짧은 시간 내 연속 새로고침 시 외부 API에 과도한 부담을 주지 않기 위한 최소 간격
_last_refresh = {"date": None, "at": 0.0}
_refresh_lock = threading.Lock()
_refreshing = False

# 보존 필드 병합 로직은 fetch_data.merge_preserving_analysis로 공통화했다 (GitHub Actions의
# build_report()도 동일 로직을 쓴다 - 두 곳이 따로 관리되면서 어긋나는 것을 방지).
_merge_preserving_analysis = fetch_data.merge_preserving_analysis


def refresh_today(force=False):
    today = fetch_data.today_kst()
    now = time.time()
    if not force and _last_refresh["date"] == today and now - _last_refresh["at"] < CACHE_SECONDS:
        return

    path = DATA_DIR / f"{today}.json"

    print(f"[{datetime.now(fetch_data.KST).strftime('%H:%M:%S')}] {today} 수치 데이터 재수집 중...")
    # build_report_data는 디스크에 쓰지 않는 순수 함수 - 수집(수~수십 초 소요)하는 동안
    # 파일을 건드리지 않아서, 그 사이 수동으로 편집한 내용이 사라지는 경쟁 상태를 막는다.
    fresh = fetch_data.build_report_data(today)

    # old는 느린 수집이 끝난 "지금" 다시 읽는다 - 수집 도중 파일이 수동으로 편집됐어도
    # 그 최신 내용을 기준으로 병합하기 위함.
    old = None
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            old = None

    merged = _merge_preserving_analysis(fresh, old)
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    fetch_data.update_index(today)

    _last_refresh["date"] = today
    _last_refresh["at"] = now


def _is_stale():
    today = fetch_data.today_kst()
    return not (_last_refresh["date"] == today and time.time() - _last_refresh["at"] < CACHE_SECONDS)


def request_async_refresh():
    """요청을 막지 않도록, 캐시가 오래됐을 때만 백그라운드 스레드에서 갱신한다.
    지금 이 요청에는 반영되지 않고(그래서 응답이 즉시 나감) 다음 새로고침부터 최신값이 보인다."""
    global _refreshing
    if not _is_stale():
        return
    with _refresh_lock:
        if _refreshing:
            return
        _refreshing = True

    def worker():
        global _refreshing
        try:
            refresh_today(force=True)
        except Exception as e:
            print("백그라운드 갱신 실패:", e)
        finally:
            _refreshing = False

    threading.Thread(target=worker, daemon=True).start()


# 코스피/코스닥 정규장 마감(15:30) 직후 - 그 시점까지 아무도 새로고침을 안 했더라도
# 서버가 켜져 있는 한 자동으로 한 번 더 갱신해서 "장마감 스냅샷"을 확정해 둔다.
# (시장이 닫히면 가격이 더 이상 안 움직이므로, 이 시점 이후 아무 때나 다시 봐도
# 자연히 종가 그대로지만, 아예 아무도 안 들어온 날을 대비한 안전장치)
MARKET_CLOSE_CHECKPOINTS = [(15, 35)]


def _seconds_until(hh, mm):
    now = datetime.now(fetch_data.KST)
    target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _market_close_scheduler():
    while True:
        wait = min(_seconds_until(hh, mm) for hh, mm in MARKET_CLOSE_CHECKPOINTS)
        time.sleep(wait)
        print(f"[{datetime.now(fetch_data.KST).strftime('%H:%M:%S')}] 장마감 스냅샷 확정 갱신 중...")
        try:
            refresh_today(force=True)
        except Exception as e:
            print("장마감 스냅샷 갱신 실패:", e)


TEXT_TYPES = ("text/", "application/javascript", "application/json")


class RefreshingHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        request_async_refresh()
        super().do_GET()

    def guess_type(self, path):
        # 한글 등 non-ASCII 콘텐츠가 잘못된 인코딩으로 표시되지 않도록 텍스트류 응답에는
        # 항상 charset=utf-8을 명시한다 (기본 guess_type은 charset을 붙이지 않는다).
        base = super().guess_type(path)
        mime = base[0] if isinstance(base, tuple) else base
        if mime and mime.startswith(TEXT_TYPES):
            return f"{mime}; charset=utf-8"
        return base

    def log_message(self, format, *args):
        pass  # 매 요청마다 콘솔에 접근 로그가 쌓이는 것 방지


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    refresh_today(force=True)
    threading.Thread(target=_market_close_scheduler, daemon=True).start()
    server = ThreadingHTTPServer(("localhost", port), RefreshingHandler)
    print(f"http://localhost:{port} 에서 서빙 중 - 페이지를 새로고침할 때마다 수치 데이터가 자동으로 최신화됩니다.")
    print("코스피/코스닥 장마감(15:30) 직후에는 서버가 켜져 있기만 하면 자동으로 한 번 더 확정 갱신합니다.")
    server.serve_forever()


if __name__ == "__main__":
    main()
