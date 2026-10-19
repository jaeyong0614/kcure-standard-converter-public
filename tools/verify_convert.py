"""변환코드생성기가 만든 Python 변환 패키지 실행 검증.

패키지(zip)의 convert.py 를 합성 샘플에 실제로 실행하고 다음을 확인한다.
  1) 실행 성공(종료코드 0)  2) 원본 파일 SHA-256 불변  3) 산출물 5개 생성
  4) 직접식별자(drop) 원문이 어떤 산출물에도 없음  5) 환자키가 32자리 16진수(원문 환자번호 없음)
  6) 날짜가 YYYY-MM-DD, 연도만 컬럼이 4자리  7) 같은 솔트로 두 번 실행한 결과가 같음(재현성)
  8) CHUNK_ROWS 를 작게 해도 결과가 같음(조각 처리)

사용법:
    python tools/verify_convert.py                         # tests/_out/conv_pkg_crc.zip·conv_pkg_D.zip 과 합성 샘플
    python tools/verify_convert.py <패키지.zip> <샘플.csv>
"""
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from common import ROOT, setup_console

OUTS = ["01_표준화.csv", "02_KRCDI_long.csv", "03_OMOP_staging.csv", "04_FHIR_staging.csv", "변환로그.csv"]


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def run(work, sample, outdir, chunk=None):
    code = (work / "convert.py").read_text(encoding="utf-8")
    code = re.sub(r'^INPUT = Path\(.*\)$', lambda m: "INPUT = Path(" + json.dumps(str(sample)) + ")", code, count=1, flags=re.M)
    code = re.sub(r'^OUTDIR = Path\(.*\)$', lambda m: "OUTDIR = Path(" + json.dumps(str(outdir)) + ")", code, count=1, flags=re.M)
    if chunk:
        code = re.sub(r'^CHUNK_ROWS = \d+', f"CHUNK_ROWS = {chunk}", code, count=1, flags=re.M)
    script = work / f"convert_test_{chunk or 0}.py"
    script.write_text(code, encoding="utf-8")
    env = dict(os.environ, KCURE_SALT="verify-salt-0001", PYTHONIOENCODING="utf-8")
    return subprocess.run([sys.executable, str(script)], capture_output=True, text=True, encoding="utf-8", env=env)


def read_csv(p):
    for enc in ("utf-8-sig", "cp949"):
        try:
            with open(p, encoding=enc, newline="") as f:
                return list(csv.reader(f))
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"인코딩을 알 수 없습니다: {p}")


def check(pkg, sample, fails):
    with tempfile.TemporaryDirectory(prefix="kcure_conv_") as t:
        work = Path(t)
        with zipfile.ZipFile(pkg) as z:
            z.extractall(work)
        meta = json.loads((work / "매핑.json").read_text(encoding="utf-8"))
        cols = meta["columns"]
        before = sha(sample)
        outs = {}
        for tag, chunk in (("a", None), ("b", None), ("c", 4)):
            od = work / f"out_{tag}"
            r = run(work, sample, od, chunk)
            if r.returncode != 0:
                fails.append(f"{Path(pkg).name}: 실행 실패({tag})\n{r.stdout}\n{r.stderr}")
                return
            outs[tag] = {n: (od / n).read_bytes() for n in OUTS if (od / n).exists()}
        name = f"{Path(pkg).name} × {Path(sample).name}"
        if sha(sample) != before:
            fails.append(f"{name}: 원본 해시가 바뀜")
        if len(outs["a"]) != len(OUTS):
            fails.append(f"{name}: 산출물 누락 {set(OUTS) - set(outs['a'])}")
        if outs["a"] != outs["b"]:
            fails.append(f"{name}: 같은 솔트 재실행 결과가 다름")
        if outs["a"] != outs["c"]:
            fails.append(f"{name}: 조각 처리(CHUNK_ROWS=4) 결과가 다름")
        src = read_csv(sample)
        head = src[0]
        od = work / "out_a"
        blob = "\n".join((od / n).read_text(encoding="utf-8-sig") for n in OUTS)
        # 직접식별자·환자번호 원문 노출 점검
        for c in cols:
            if c["method"] in ("drop", "patient_key", "hash") and c["col"] in head:
                j = head.index(c["col"])
                leaked = sorted({r[j] for r in src[1:] if j < len(r) and len(r[j]) >= 3 and re.search(re.escape(r[j]), blob)})
                if leaked:
                    fails.append(f"{name}: {c['method']} 컬럼 {c['col']} 원문 노출 {leaked[:3]}")
        wide = read_csv(od / "01_표준화.csv")
        if not all(re.fullmatch(r"[0-9a-f]{32}|ROW-\d+", r[0]) for r in wide[1:]):
            fails.append(f"{name}: 환자키가 가명키 형식이 아님")
        hdr = wide[0]
        for c in cols:
            if c["method"] not in ("date", "year") or "name" not in c:
                continue
            label = f'{c["name"]} [{c["item_id"]}]'
            if label not in hdr:
                continue
            j = hdr.index(label)
            rx = r"\d{4}" if c["method"] == "year" else r"\d{4}-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2})?)?"
            bad = [r[j] for r in wide[1:] if r[j] and not re.fullmatch(rx, r[j])]
            if bad:
                fails.append(f"{name}: {c['col']}({c['method']}) 형식 이상 {bad[:3]}")
        log = read_csv(od / "변환로그.csv")
        print(f"  {name}: 행 {len(wide) - 1} · KR CDI {len(read_csv(od / '02_KRCDI_long.csv')) - 1} · OMOP {len(read_csv(od / '03_OMOP_staging.csv')) - 1}"
              f" · FHIR {len(read_csv(od / '04_FHIR_staging.csv')) - 1} · 로그 {len(log) - 1}컬럼 · 원본 해시 불변 · 재실행·조각 처리 동일")


def main():
    setup_console()
    args = sys.argv[1:]
    out = ROOT / "tests" / "_out"
    pairs = [(args[0], args[1])] if len(args) >= 2 else [
        (out / "conv_pkg_crc.zip", ROOT / "samples" / "합성샘플_대장암_원천영문컬럼.csv"),
        (out / "conv_pkg_crc.zip", ROOT / "samples" / "합성샘플_유방암_한글컬럼_CP949.csv"),
        (out / "conv_pkg_D.zip", ROOT / "samples" / "generic" / "D_정형.csv"),
    ]
    fails = []
    for pkg, sample in pairs:
        check(pkg, sample, fails)
    if fails:
        print("\n[실패]")
        for f in fails:
            print(" -", f)
        sys.exit(1)
    print("검증 통과")


if __name__ == "__main__":
    main()
