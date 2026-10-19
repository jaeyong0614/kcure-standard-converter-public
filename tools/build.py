"""무설치 배포본 생성: src/index.html 의 CSS·JS·내장 명세를 모두 인라인한 단일 HTML 파일을 만든다.

사용법:
    python tools/build.py            # spec/kcure_spec.js, spec/samples.js 가 최신이어야 함
    python tools/build.py --all      # 명세·샘플 재생성 후 빌드
    python tools/build.py --llm      # + 로컬 LLM 연동본(KCURE_표준변환기_LLM.html, 127.0.0.1 만 연결 허용)
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
OUT_NAME = "KCURE_표준변환기.html"
CG_NAME = "KCURE_변환코드생성기.html"


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def safe_inline(js):
    # 인라인 <script> 안에서 문자열 "</script" 가 태그를 닫지 않도록 이스케이프
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)


def spec_sources_ready():
    """내부 항목정의서 원본은 공개 저장소에 없다. 있으면(기관 내부 PC) 명세를 다시 만들고, 없으면 빌드된 명세를 쓴다."""
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from common import source_path
    try:
        for key in ("final", "aux"):
            source_path(key)
        return True
    except FileNotFoundError:
        return False


def inline_page(src_name):
    """src/<src_name> 의 CSS·JS 를 모두 인라인한 단일 HTML 문자열"""
    html = read(os.path.join(SRC, src_name))

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

    return html


def main():
    if "--all" in sys.argv:
        if spec_sources_ready():
            subprocess.check_call([sys.executable, os.path.join(ROOT, "tools", "build_spec.py")])
        else:
            print("[안내] 항목정의서 원본(spec/sources/중개포털_SW겸용_항목정의서_*.xlsx)이 없어 명세 재생성을 건너뜁니다. "
                  "저장소에 들어 있는 spec/kcure_spec.json(빌드된 명세)으로 빌드합니다.")
        subprocess.check_call([sys.executable, os.path.join(ROOT, "tools", "make_samples.py")])

    # 범용(비 K-CURE) 표준 사전 → spec/generic_spec.js
    subprocess.check_call([sys.executable, os.path.join(ROOT, "tools", "build_generic.py")])
    # 가명처리 규칙(JSON) → file:// 에서도 읽히는 JS 래퍼
    import json
    with open(os.path.join(ROOT, "spec", "deid_rules.json"), encoding="utf-8") as f:
        deid = json.load(f)
    with open(os.path.join(ROOT, "spec", "deid_rules.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write("window.KCURE_DEID=" + json.dumps(deid, ensure_ascii=False, separators=(",", ":")) + ";\n")

    html = inline_page("index.html")
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, OUT_NAME)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"built {out} ({os.path.getsize(out) / 1024 / 1024:.2f} MB)")

    # 변환코드생성기: 컬럼명 파일 → 매핑 → Python 변환 코드 (데이터는 변환하지 않음)
    out_cg = os.path.join(DIST, CG_NAME)
    with open(out_cg, "w", encoding="utf-8") as f:
        f.write(inline_page("convgen.html"))
    print(f"built {out_cg} ({os.path.getsize(out_cg) / 1024 / 1024:.2f} MB)")

    if "--llm" in sys.argv:
        # 로컬 LLM 연동본: 연결 허용 대상은 이 PC의 Ollama(11434)·LM Studio(1234)뿐. 기본 배포본은 'none' 유지
        loop = "http://127.0.0.1:11434 http://localhost:11434 http://127.0.0.1:1234 http://localhost:1234"
        assert "connect-src 'none'" in html
        h2 = html.replace("connect-src 'none'", "connect-src " + loop, 1)
        h2 = h2.replace("<title>K-CURE 표준변환기</title>", "<title>K-CURE 표준변환기 (LLM 연동)</title>\n<script>window.KC_LLM_BUILD = true;</script>", 1)
        h2 = h2.replace("● 오프라인 실행 · 외부 전송 차단", "● 이 PC의 LLM(127.0.0.1)만 연결 · 외부 전송 차단", 1)
        out2 = os.path.join(DIST, OUT_NAME.replace(".html", "_LLM.html"))
        with open(out2, "w", encoding="utf-8") as f:
            f.write(h2)
        print(f"built {out2} (LLM 연동, connect-src {loop})")


if __name__ == "__main__":
    from common import setup_console
    setup_console()
    main()
