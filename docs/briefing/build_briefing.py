"""진행 브리핑 페이지 생성: template.html + 테스트 결과(tests/_out) → briefing.html

입력(먼저 만들어 둘 것):
  tests/_out/test_results.json  — tools/devserver.py 로 tests/test.html 실행 후 저장된 결과
  tests/_out/verify_log.txt     — tools/verify_generated.py · verify_dicom.py · sync_sources.py --check 출력
  tests/_out/selftest.txt       — 배포본 #selftest 결과 문자열
사용법: python docs/briefing/build_briefing.py
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "tests" / "_out"

# 테스트 순서(인덱스) 구간 → 영역. tests/tests.js 의 단락 순서와 같다.
GROUPS = [
    ("base", "기본 단위 (해시·날짜·CSV·명세·별칭)", "v0.1", 0, 14),
    ("fhir", "환자 데이터 변환 (FHIR·KR CDI·가명키)", "v0.1", 15, 40),
    ("dcat", "DCAT 카탈로그", "v0.1", 41, 49),
    ("input", "입력 형식 (XLSX·CP949·항목정의서)", "v0.1", 50, 65),
    ("meta", "메타데이터 패키지 (6개 표준)", "v0.1", 66, 119),
    ("s1", "매핑 품질 (KR CDI·mCODE·ARGO)", "S1", 120, 133),
    ("s2", "가명처리 코드 추천·생성", "S2", 134, 163),
    ("s3", "DICOM · 로컬 LLM (S5 보강 포함)", "S3·S5", 164, 181),
    ("s4", "승인 · 감사 이력 · 규칙팩", "S4", 182, 192),
    ("spec", "항목정의 변환 (ConceptMap·명세 DCAT)", "v0.1", 193, 197),
]


def group_of(i):
    for gid, _n, _s, a, b in GROUPS:
        if a <= i <= b:
            return gid
    return GROUPS[-1][0]


def selftest_rows(msg):
    rows = []
    for part in msg.split(" / "):
        m = re.match(r"(\S+) 메타 (\d+)컬럼·파일 (\d+)·mCODE (\d+)·OMOP (\d+)·ARGO (\d+)", part)
        if m:
            rows.append([m[1] + " 메타데이터", m[2] + " 컬럼", m[3] + " 파일", "mCODE " + m[4], m[5], m[6]])
            continue
        m = re.match(r"(\w+): 환자 (\d+) · FHIR (\d+)개\(구조오류 (\d+)\) · KR CDI 값 (\d+)", part)
        if m:
            name = {"crc": "합성 대장암 환자", "brc": "합성 유방암 환자"}.get(m[1], m[1])
            rows.append([name, m[2] + " 명", "FHIR " + m[3] + " (오류 " + m[4] + ")", "KR CDI " + m[5], "—", "—"])
    return rows


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    res = json.loads((OUT / "test_results.json").read_text(encoding="utf-8"))
    covered = sum(b - a + 1 for _g, _n, _s, a, b in GROUPS)
    if covered != len(res["results"]):
        raise SystemExit(f"영역 구간 합계 {covered} ≠ 테스트 수 {len(res['results'])} — GROUPS 구간을 tests.js 순서에 맞게 고치세요")
    results = [{"i": i, "name": r["name"], "pass": r["pass"], "detail": "" if r["pass"] else r.get("detail", ""), "g": group_of(i)}
               for i, r in enumerate(res["results"])]
    log = (OUT / "verify_log.txt").read_text(encoding="utf-8")
    # 로컬 사용자 경로는 페이지에 싣지 않는다
    log = re.sub(r"[A-Z]:\\Users\\.*?KCURE_표준변환기_프로토타입\\", "", log)
    log = re.sub(r"[A-Z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\", "%TEMP%\\\\", log)
    # 로컬 LLM 실모델 PoC (docs/poc)
    poc_dir = ROOT / "docs" / "poc"
    runs = []
    for key, label, how in (("v1prompt", "v1", "기법 직접 판정"), ("v2prompt", "v2", "규칙 추천 제시 후 검토"),
                            ("v3prompt", "v3", "의미 범주 판정 → 정책표"), ("final", "v3.1", "v3 + 힌트·누락 재요청·안전 병합"),
                            ("final_samples", "v3.1 + 샘플", "위와 같음, 샘플 고유값 3개 전송")):
        d = json.loads((poc_dir / f"llm_poc_qwen2.5-7b_{key}.json").read_text(encoding="utf-8"))
        s = d["summary"]
        runs.append({"label": label, "how": how, "s": {k: s.get(k) for k in ("columns", "sent", "llmAccSent", "ruleAccAll", "hybridAccAll", "safeAccAll", "totalSec")}})

    def poc_rows(key):
        d = json.loads((poc_dir / f"llm_poc_qwen2.5-7b_{key}.json").read_text(encoding="utf-8"))
        return [{k: r.get(k) for k in ("col", "accept", "rule", "sent", "llm", "category", "weakens", "ruleOk", "safeOk")} for r in d["rows"]]

    data = {
        "poc": {"runs": runs, "final": poc_rows("final"), "samples": poc_rows("final_samples")},
        "results": results,
        "groups": [{"id": g[0], "name": g[1], "since": g[2]} for g in GROUPS],
        "verifyLog": log.strip(),
        "selftest": selftest_rows((OUT / "selftest.txt").read_text(encoding="utf-8").strip()),
    }
    when = dt.datetime.fromisoformat(res["when"].replace("Z", "+00:00")).astimezone(dt.timezone(dt.timedelta(hours=9)))
    n, p = len(results), sum(r["pass"] for r in results)
    html = (HERE / "template.html").read_text(encoding="utf-8")
    html = (html.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
            .replace("__WHEN__", when.strftime("%Y-%m-%d %H:%M"))
            .replace("__PASS__", str(p)).replace("__TOTAL__", str(n)).replace("__FAIL__", str(n - p)).replace("__DELTA__", str(n - 125)))
    out = HERE / "briefing.html"
    out.write_text(html, encoding="utf-8", newline="\n")
    print(f"{out} · 테스트 {p}/{n} · 영역 {len(GROUPS)} · 자체점검 {len(data['selftest'])}행")


if __name__ == "__main__":
    main()
