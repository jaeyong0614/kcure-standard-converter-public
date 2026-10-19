"""LLM 연동본 로컬 실행기: dist/KCURE_표준변환기_LLM.html 을 http://127.0.0.1:8770 으로 띄우고 브라우저를 연다.

파일을 더블클릭해 열면 브라우저가 출처(Origin)를 'null' 로 보내고, Ollama 는 기본 설정에서 이를 거부(403)한다.
127.0.0.1 주소로 띄우면 Ollama 기본 허용 목록에 들어가므로 OLLAMA_ORIGINS 를 바꾸지 않아도 된다.
이 서버는 dist 폴더만 읽기 전용으로 제공하며 127.0.0.1 에만 바인딩한다.

사용법: python tools/serve_llm.py [포트, 기본 8770]   (또는 dist/LLM연동_실행.bat)
"""
import functools
import http.server
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "dist"
PAGE = "KCURE_표준변환기_LLM.html"


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):  # 쓰기 요청은 받지 않는다
        self.send_error(405)

    def log_message(self, fmt, *args):
        pass


def ollama_status():
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=3) as r:
            import json
            models = [m["name"] for m in json.load(r).get("models", [])]
            return "Ollama 실행 중 · 모델: " + (", ".join(models) or "없음 (ollama pull qwen2.5:7b-instruct)")
    except OSError:
        return "Ollama 가 실행 중이 아닙니다. 시작 메뉴에서 Ollama 를 실행하세요."


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
    if not (DIST / PAGE).exists():
        raise SystemExit(f"{PAGE} 가 없습니다. 먼저 python tools/build.py --llm 을 실행하세요.")
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(DIST)))
    url = f"http://127.0.0.1:{port}/" + urllib.parse.quote(PAGE)
    print(ollama_status())
    print("열기:", url, " (종료: Ctrl+C)")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
