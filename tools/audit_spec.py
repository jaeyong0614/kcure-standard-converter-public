"""항목정의서 매핑 점검: 변환기가 자동보정·별도처리하는 '자료형↔FHIR 경로 불일치' 항목을 목록화한다.
결과(docs/02_매핑검토대상.csv)는 항목정의서 다음 개정(v2.5)의 검토 입력으로 쓴다.

spec/corrections.json 에 건별 수정안(현재 경로 → 제안 경로)을 '후보' 상태로 기록한다.
이미 있는 파일의 상태·승인자·메모는 보존한다. 담당자가 status 를 '승인'으로 바꾸면
build_spec.py 가 그 건만 명세에 반영한다(반려는 '반려', 보류는 '보류').

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
# 리소스별 일자 요소 (src/js/fhir.js DATE_TARGET 과 같게 유지)
DATE_TARGET = {
    "Observation": "Observation.effectiveDateTime", "DiagnosticReport": "DiagnosticReport.effectiveDateTime",
    "Procedure": "Procedure.performedDateTime", "Condition": "Condition.recordedDate", "MedicationRequest": "MedicationRequest.authoredOn",
    "AdverseEvent": "AdverseEvent.date", "Encounter": "Encounter.period.start", "FamilyMemberHistory": "FamilyMemberHistory.date",
    "Specimen": "Specimen.collection.collectedDateTime", "Immunization": "Immunization.occurrenceDateTime",
}
KEEP = ("status", "approver", "decided", "memo")


def propose(code, it, path):
    """점검코드별 수정 경로 제안 (사람이 검토할 출발점)."""
    rt, name = path.split(".")[0], it["name"]
    if code == "A1":
        if rt == "Patient":
            return "Patient.deceasedDateTime" if re.search(r"사망|death", name, re.I) else "Observation.effectiveDateTime"
        return DATE_TARGET.get(rt, "Observation.effectiveDateTime")
    if code == "A2":
        return "Observation.valueTime" if re.search(r"시각|time$", name, re.I) else "Observation.valueQuantity"
    if code == "B1":
        return "Observation.valueBoolean"
    if code == "B2":
        return "Encounter.hospitalization.dischargeDisposition" if "퇴원" in name else "Observation.valueCodeableConcept"
    if code == "C1":
        return "Patient.deceasedBoolean" if re.search(r"사망\s*여부|survival_status", name, re.I) else "Observation.valueCodeableConcept"
    if code == "D1":
        return "Observation.valueQuantity"
    if code == "E1":
        return "AdverseEvent.event.text"
    return ""


def write_corrections(rows, spec_items):
    path = os.path.join(ROOT, "spec", "corrections.json")
    old = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = {(c["id"], c["code"]): c for c in json.load(f).get("corrections", [])}
    items = {it["id"]: it for it in spec_items}
    out = []
    for code, issue, iid, name, _t, cur, *_ in rows:
        c = {"id": iid, "name": name, "code": code, "issue": issue, "std": "KR Core", "field": "core.path",
             "current": cur, "proposed": propose(code, items[iid], cur), "reason": "audit_spec 자동 제안",
             "status": "후보", "approver": "", "decided": "", "memo": ""}
        prev = old.pop((iid, code), None)
        if prev:
            c.update({k: prev.get(k, c[k]) for k in KEEP})
            if prev.get("proposed") and prev.get("reason") != "audit_spec 자동 제안":
                c["proposed"], c["reason"] = prev["proposed"], prev["reason"]
        out.append(c)
    # 더 이상 검출되지 않지만 사람이 결정한 건은 남긴다
    out += [c for c in old.values() if c.get("status") != "후보"]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"note": "status: 후보 → 승인/반려/보류. 승인된 건만 build_spec.py 가 명세에 반영", "corrections": out},
                  f, ensure_ascii=False, indent=1)
    return path, len(out)


def is_flag(it):
    codes = it.get("codes") or []
    if codes and len(codes) <= 4 and sorted(str(c[0]).upper() for c in codes) in (["N", "U", "Y"], ["N", "Y"]):
        return True
    return it["role"] == "여부" or re.search(r"(여부|유무)$", it["name"]) or re.search(r"_yn$", it["name"], re.I)


def main():
    spec = json.load(open(os.path.join(ROOT, "spec", "kcure_spec.json"), encoding="utf-8"))
    rows = []
    for it in spec["items"]:
        # 수정안이 이미 반영된 항목도 원래 경로 기준으로 점검해야 수정안이 유지된다
        p, t = it["core"].get("pathOrig") or it["core"]["path"], it["type"]
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
    cpath, n = write_corrections(rows, spec["items"])
    from collections import Counter
    print(Counter(r[0] for r in rows), "items:", len({r[2] for r in rows}), "->", out)
    print("corrections:", n, "->", cpath)


if __name__ == "__main__":
    from common import setup_console
    setup_console()
    main()
