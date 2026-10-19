"""항목정의서 매핑 점검: 변환기가 자동보정·별도처리하는 '자료형↔FHIR 경로 불일치' 항목을 목록화한다.
결과(docs/02_매핑검토대상.csv)는 항목정의서 다음 개정(v2.5)의 검토 입력으로 쓴다.

사용법: python tools/audit_spec.py
"""
import csv
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATE_PATH = re.compile(r"(DateTime|Date|\.date|authoredOn|issued|period\.(start|end)|performedPeriod|birthDate)$")
ID_LIKE = re.compile(r"번호|등록|식별|ID$|^id|^no_|_no$|identifier", re.I)
R4_UNSUPPORTED = {"AdverseEvent.description"}


def is_flag(it):
    codes = it.get("codes") or []
    if codes and len(codes) <= 4 and sorted(str(c[0]).upper() for c in codes) in (["N", "U", "Y"], ["N", "Y"]):
        return True
    return it["role"] == "여부" or re.search(r"(여부|유무)$", it["name"]) or re.search(r"_yn$", it["name"], re.I)


def main():
    spec = json.load(open(os.path.join(ROOT, "spec", "kcure_spec.json"), encoding="utf-8"))
    rows = []
    for it in spec["items"]:
        p, t = it["core"]["path"], it["type"]
        checks = []
        if t == "DATE" and not DATE_PATH.search(p):
            checks.append(("A1", "날짜 항목이 비날짜 경로에 배정", "변환기: 해당 리소스 일자 요소로 자동보정"))
        if DATE_PATH.search(p) and t != "DATE" and not re.search(r"year|년도|연도", it["name"], re.I):
            checks.append(("A2", "비날짜 항목(나이·기간·시각 등)이 날짜 경로에 배정", "변환기: 날짜로 해석 불가 시 확장으로 보존"))
        if re.search(r"\.status$|verificationStatus$", p) and is_flag(it):
            checks.append(("B1", "여부 항목이 status 경로에 배정", "변환기: 별도 리소스로 분리(주 리소스 상태 보호)"))
        if re.search(r"\.status$", p) and not is_flag(it):
            checks.append(("B2", "자유문/상태값 항목이 status(code) 경로에 배정", "변환기: status=unknown + note 보존"))
        if p == "Patient.identifier" and not ID_LIKE.search(it["name"]):
            checks.append(("C1", "식별자가 아닌 항목이 Patient.identifier에 배정", "변환기: 확장으로 보존(사망일자는 deceasedDateTime 보정)"))
        if t in ("NUMERIC", "INTEGER") and p == "Observation.valueCodeableConcept":
            checks.append(("D1", "수치 항목이 valueCodeableConcept에 배정", "변환기: valueQuantity로 표현"))
        if p in R4_UNSUPPORTED:
            checks.append(("E1", "FHIR R4에 없는 경로", "변환기: 확장으로 보존"))
        for code, issue, handling in checks:
            rows.append([code, issue, it["id"], it["name"], t, p, it["core"]["judge"], it["grade"], ",".join(it["cancers"]), handling])
    out = os.path.join(ROOT, "docs", "02_매핑검토대상.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["점검코드", "문제", "항목ID", "항목명", "데이터타입", "KR_Core_FHIR_Path", "KR_Core_판정", "심사등급", "출현암종", "변환기 처리"])
        w.writerows(rows)
    from collections import Counter
    print(Counter(r[0] for r in rows), "items:", len({r[2] for r in rows}), "->", out)


if __name__ == "__main__":
    main()
