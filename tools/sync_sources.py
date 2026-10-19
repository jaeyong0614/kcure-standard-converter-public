"""명세 원본을 spec/sources/ 로 복사하고 manifest.json(SHA-256·원래 위치·복사 시각)을 기록한다.

사용법:
    python tools/sync_sources.py            # 없는 파일만 복사, 해시 점검
    python tools/sync_sources.py --update   # 예전 위치의 최신본으로 덮어쓰고 manifest 갱신
    python tools/sync_sources.py --check    # 복사 없이 해시만 점검 (불일치 시 종료코드 1)
"""
import argparse
import datetime as dt
import json
import os
import shutil
import sys

from common import MANIFEST, SOURCE_FILES, SOURCES, load_manifest, setup_console, sha256


def main():
    setup_console()
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    man = load_manifest()
    files = man.setdefault("files", {})
    bad = 0
    SOURCES.mkdir(parents=True, exist_ok=True)
    for key, (name, legacy) in SOURCE_FILES.items():
        dst = SOURCES / name
        if not a.check and legacy.exists() and (a.update or not dst.exists()):
            # OneDrive 동기화 중 잠금을 피하려고 임시 파일에 쓴 뒤 교체한다
            tmp = dst.with_suffix(dst.suffix + ".tmp")
            shutil.copyfile(legacy, tmp)
            os.replace(tmp, dst)
            files[name] = {"key": key, "sha256": sha256(dst), "bytes": dst.stat().st_size,
                           "origin": os.path.relpath(legacy, SOURCES.parent.parent.parent).replace("\\", "/"),
                           "copied": dt.datetime.now().strftime("%Y-%m-%d %H:%M")}
            print(f"복사  {name}")
        if not dst.exists():
            print(f"없음  {name}")
            bad += 1
            continue
        rec = files.get(name)
        ok = rec and rec["sha256"] == sha256(dst)
        print(f"{'일치' if ok else '불일치'}  {name}")
        bad += 0 if ok else 1
    if not a.check:
        with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
            json.dump(man, f, ensure_ascii=False, indent=2)
    sys.exit(1 if (a.check and bad) else 0)


if __name__ == "__main__":
    main()
