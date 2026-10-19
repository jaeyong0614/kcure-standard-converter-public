"""개발용 로컬 서버: 정적 파일 + 테스트 산출물 저장(POST /__save/<파일명> → tests/_out/).

브라우저 테스트(tests/test.html)가 생성한 가명처리 코드 패키지를 디스크에 남겨
tools/verify_generated.py 로 실제 실행 검증을 할 수 있게 한다. 127.0.0.1 에만 바인딩한다.

사용법: python tools/devserver.py [포트, 기본 8765]
"""
import http.server
import os
import re
import sys
from pathlib import Path

from common import ROOT, setup_console

OUT = ROOT / "tests" / "_out"
SAFE = re.compile(r"^[\w\-.가-힣]+$")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_POST(self):
        name = self.path.split("/__save/", 1)[-1] if self.path.startswith("/__save/") else ""
        from urllib.parse import unquote
        name = unquote(name)
        if not SAFE.match(name or "") or ".." in name:
            self.send_error(400, "bad name")
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n > 20 * 1024 * 1024:
            self.send_error(413)
            return
        OUT.mkdir(parents=True, exist_ok=True)
        data = self.rfile.read(n)
        tmp = OUT / (name + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, OUT / name)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if self.command == "POST":
            super().log_message(fmt, *args)


def main():
    setup_console()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as s:
        print(f"http://127.0.0.1:{port}/tests/test.html  (저장 위치 {OUT})")
        s.serve_forever()


if __name__ == "__main__":
    main()
