"""mCODE STU4 데이터 사전(mCODEDataDictionary-STU4.xlsx) 적재 + 항목별 mCODE 프로파일 URL·데이터요소 연결.

항목정의서 v2.4 의 mCODE_Profile / mCODE_FHIR_Path / mCODE_참조수준을 기준으로,
공식 데이터 사전의 프로파일 canonical URL 과 데이터요소(이름·필수·자료형)를 붙인다.
"""
import os
import re
import warnings

from openpyxl import load_workbook

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.dirname(ROOT)
DEFAULT_DD = os.path.join(PROJ, "데이터 항목정의", "데이터 항목정의_claude", "outputs", "KR_CDI_K_CURE_업무프로세스_260825",
                          "source_review", "mCODEDataDictionary-STU4.xlsx")
# 항목정의서 표기 → 데이터 사전 프로파일 제목
ALIAS = {"tumormorphology": "Tumor Morphology Report"}


def key(title):
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\s*profile\.?$", "", str(title).strip(), flags=re.I).lower())


def load(path=DEFAULT_DD):
    wb = load_workbook(path, read_only=True, data_only=True)
    profiles = []
    for r in list(wb["Profiles"].iter_rows(values_only=True))[1:]:
        if r[1]:
            profiles.append({"title": str(r[1]).strip(), "url": str(r[2] or ""), "group": str(r[0] or ""),
                             "desc": str(r[3] or "")[:300], "key": key(r[1])})
    elements = []
    for r in list(wb["Data elements"].iter_rows(values_only=True))[1:]:
        if r[1] and r[2]:
            elements.append({"profile": str(r[1]).strip(), "name": str(r[2]).strip(), "required": str(r[4] or "").strip(),
                             "card": str(r[5] or ""), "type": str(r[6] or ""), "path": str(r[9] or "").strip(),
                             "valueSet": str(r[7] or "")})
    ig = {}
    for r in wb["IG information"].iter_rows(values_only=True):
        if r and len(r) > 2 and r[1] and r[2]:
            ig[str(r[1]).strip()] = str(r[2]).strip()
    return {"version": ig.get("IG version", "STU4"), "url": ig.get("IG URL", "http://hl7.org/fhir/us/mcode"),
            "profiles": profiles, "elements": elements}


def apply(items, path=DEFAULT_DD):
    d = load(path)
    by_key = {p["key"]: p for p in d["profiles"]}
    for k, title in ALIAS.items():
        by_key[k] = next(p for p in d["profiles"] if p["title"] == title)
    els_by_profile = {}
    for e in d["elements"]:
        els_by_profile.setdefault(e["profile"], []).append(e)
    n_prof = n_el = 0
    for it in items:
        m = it["mcode"]
        p = by_key.get(key(m["profile"]))
        if not p:
            m["url"] = ""
            continue
        n_prof += 1
        m["title"] = p["title"]
        m["url"] = p["url"]
        path = (m.get("path") or "").strip()
        cands = [e for e in els_by_profile.get(p["title"], []) if e["path"] and (e["path"] == path or path.startswith(e["path"] + ".")
                                                                                or e["path"].split(":")[0] == path)]
        if cands:
            e = sorted(cands, key=lambda x: -len(x["path"]))[0]
            m["element"] = e["name"]
            m["elRequired"] = e["required"]
            n_el += 1
    return d, n_prof, n_el


if __name__ == "__main__":
    import json
    spec = json.load(open(os.path.join(ROOT, "spec", "kcure_spec.json"), encoding="utf-8"))
    d, a, b = apply(spec["items"])
    print("profiles", len(d["profiles"]), "elements", len(d["elements"]), "items with profile", a, "with element", b)
