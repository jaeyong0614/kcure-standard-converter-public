"""무설치 배포본 생성: src/index.html 의 CSS·JS·내장 명세를 모두 인라인한 단일 HTML 파일을 만든다.

사용법:
    python tools/build.py            # spec/kcure_spec.js, spec/samples.js 가 최신이어야 함
    python tools/build.py --all      # 명세·샘플 재생성 후 빌드
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
OUT_NAME = "KCURE_표준변환기.html"


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def safe_inline(js):
    # 인라인 <script> 안에서 문자열 "</script" 가 태그를 닫지 않도록 이스케이프
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)


def main():
    if "--all" in sys.argv:
        subprocess.check_call([sys.executable, os.path.join(ROOT, "tools", "build_spec.py")])
        subprocess.check_call([sys.executable, os.path.join(ROOT, "tools", "make_samples.py")])

    html = read(os.path.join(SRC, "index.html"))

    def css_block(m):
        hrefs = re.findall(r'href="([^"]+)"', m.group(0))
        return "<style>\n" + "\n".join(read(os.path.join(SRC, h)) for h in hrefs) + "\n</style>"

    def js_block(m):
        srcs = re.findall(r'src="([^"]+)"', m.group(0))
        parts = []
        for s in srcs:
            parts.append("<script>/* " + os.path.basename(s) + " */\n" + safe_inline(read(os.path.normpath(os.path.join(SRC, s)))) + "\n</script>")
        return "\n".join(parts)

    html = re.sub(r"<!--BUILD:CSS-->.*?<!--/BUILD:CSS-->", css_block, html, flags=re.S)
    html = re.sub(r"<!--BUILD:JS-->.*?<!--/BUILD:JS-->", js_block, html, flags=re.S)
    # 단일 파일에는 외부 파일 참조가 없으므로 CSP에서 'self'·file: 허용을 제거
    html = html.replace("script-src 'self' 'unsafe-inline' file:", "script-src 'unsafe-inline'")
    html = html.replace("style-src 'self' 'unsafe-inline' file:", "style-src 'unsafe-inline'")

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, OUT_NAME)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"built {out} ({os.path.getsize(out) / 1024 / 1024:.2f} MB)")


if __name__ == "__main__":
    main()
