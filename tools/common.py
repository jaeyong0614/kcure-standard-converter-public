"""도구 스크립트 공통: Windows 콘솔 인코딩, 명세 원본(spec/sources) 경로 해석·해시 확인.

- 한국어 Windows 콘솔은 cp949라 print()에서 UnicodeEncodeError가 날 수 있다 → setup_console()
- 원본 xlsx는 상위 폴더·깊은 outputs 경로(260자 제한 위험)에 흩어져 있었다
  → tools/sync_sources.py 로 spec/sources/ 에 복사하고 manifest.json(SHA-256)으로 고정한다.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJ = ROOT.parent  # 중개포털 항목정의
SOURCES = ROOT / "spec" / "sources"
MANIFEST = SOURCES / "manifest.json"

# 명세 생성에 쓰는 원본: 키 → (spec/sources 안 파일명, 예전 위치)
SOURCE_FILES = {
    "final": ("중개포털_SW겸용_항목정의서_KRmCODE_v2.4.xlsx",
              PROJ / "중개포털_SW겸용_항목정의서_KRmCODE_v2.4.xlsx"),
    "aux": ("중개포털_SW겸용_항목정의서_KR_mCODE_260831_V1.2.xlsx",
            PROJ / "중개포털_SW겸용_항목정의서_KR_mCODE_260831_V1.2.xlsx"),
    "argo": ("ICGC_ARGO_Data_Dictionary_v1.34.xlsx",
             PROJ / "데이터 항목정의" / "argo_submission_templates_v1.34" / "ICGC_ARGO_Data_Dictionary_v1.34.xlsx"),
    "mcode": ("mCODEDataDictionary-STU4.xlsx",
              PROJ / "데이터 항목정의" / "데이터 항목정의_claude" / "outputs" / "KR_CDI_K_CURE_업무프로세스_260825"
              / "source_review" / "mCODEDataDictionary-STU4.xlsx"),
}


def setup_console():
    """stdout·stderr를 UTF-8로 (cp949 콘솔에서 한글·기호 출력 오류 방지)."""
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest():
    if MANIFEST.exists():
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    return {"files": {}}


def source_path(key):
    """spec/sources 의 고정 사본을 우선 쓰고, 없으면 예전 위치를 쓴다(경고 출력)."""
    name, legacy = SOURCE_FILES[key]
    p = SOURCES / name
    if p.exists():
        rec = load_manifest()["files"].get(name)
        if rec and rec.get("sha256") != sha256(p):
            print(f"[경고] {name} 해시가 manifest.json과 다릅니다. 원본이 바뀌었다면 tools/sync_sources.py --update 를 실행하세요.",
                  file=sys.stderr)
        return str(p)
    if legacy.exists():
        print(f"[안내] spec/sources/{name} 없음 → 예전 위치 사용: {legacy}  (tools/sync_sources.py 로 고정 권장)", file=sys.stderr)
        return str(legacy)
    raise FileNotFoundError(f"명세 원본을 찾을 수 없습니다: {name} (spec/sources 또는 {legacy})")
