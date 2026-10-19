"""K-CURE 표준항목 → OMOP CDM v5.4 (+ Oncology 확장: episode, Cancer Modifier) 후보 매핑 (규칙 기반).

항목정의서에는 OMOP 대응이 없으므로 2단계 규칙으로 '후보'를 만든다.
  1단계: 항목명(→ 원천 별칭) 정규식 규칙 — 개념이 분명한 항목(식별자·성별·병기·약제 등)
  2단계: KR Core FHIR 리소스 + 자료형·의미역할에 따른 대체 규칙 — 나머지 항목
값 필드 토큰: VAL = 자료형에 따라 value_as_number / value_as_concept_id / value_as_string(value_source_value),
             DATE = 테이블의 일자 필드, CONCEPT = 테이블의 개념 필드
OMOP 명세: spec/sources/OMOP_CDMv5.4_Field_Level.csv (OHDSI/CommonDataModel 공식)
"""
import csv
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELD_CSV = os.path.join(ROOT, "spec", "sources", "OMOP_CDMv5.4_Field_Level.csv")
TABLE_CSV = os.path.join(ROOT, "spec", "sources", "OMOP_CDMv5.4_Table_Level.csv")

CLINICAL = ["person", "observation_period", "visit_occurrence", "visit_detail", "condition_occurrence", "drug_exposure",
            "procedure_occurrence", "device_exposure", "measurement", "observation", "death", "note", "note_nlp", "specimen",
            "fact_relationship", "location", "care_site", "provider", "episode", "episode_event"]

T = {
    "person": {"concept": "", "date": "", "source": "person_source_value"},   # person 은 필드별로 의미가 달라 공통 개념·일자 필드 없음
    "measurement": {"concept": "measurement_concept_id", "date": "measurement_date", "source": "measurement_source_value"},
    "observation": {"concept": "observation_concept_id", "date": "observation_date", "source": "observation_source_value"},
    "condition_occurrence": {"concept": "condition_concept_id", "date": "condition_start_date", "source": "condition_source_value"},
    "procedure_occurrence": {"concept": "procedure_concept_id", "date": "procedure_date", "source": "procedure_source_value"},
    "drug_exposure": {"concept": "drug_concept_id", "date": "drug_exposure_start_date", "source": "drug_source_value"},
    "visit_occurrence": {"concept": "visit_concept_id", "date": "visit_start_date", "source": "visit_source_value"},
    "note": {"concept": "note_class_concept_id", "date": "note_date", "source": "note_source_value"},
    "specimen": {"concept": "specimen_concept_id", "date": "specimen_date", "source": "specimen_source_value"},
    "death": {"concept": "cause_concept_id", "date": "death_date", "source": "cause_source_value"},
    "episode": {"concept": "episode_concept_id", "date": "episode_start_date", "source": "episode_source_value"},
    "care_site": {"concept": "place_of_service_concept_id", "date": "", "source": "care_site_source_value"},
}

MOD = "종양 수식자: measurement_event_id = condition_occurrence_id, meas_event_field_concept_id = 1147127"
IV_HIST = "병력 Y → 'History of …' 개념(observation) 또는 condition_occurrence(condition_status=과거)"

# (정규식, 테이블, 필드토큰, 신뢰도, 어휘(vocabulary) 힌트, 변환·주의)
RULES = [
    # 식별·인구학
    (r"^(병원번호|환자등록번호|환자번호|등록번호|no_patient|patient_id|pid)$", "person", "person_source_value", "높음", "-", "가명 ID 권장. person_id 는 정수 대체키로 생성"),
    (r"^(no_hospital|요양기관\s*번호|의료기관\s*(id|번호|코드))$", "care_site", "care_site_source_value", "높음", "-", "care_site_id 생성 후 person.care_site_id 연결"),
    (r"^(성별|sex|gender)$", "person", "gender_concept_id", "높음", "Gender", "M→8507, F→8532 (gender_source_value에 원값)"),
    (r"생년월일|dt_birth", "person", "birth_datetime", "높음", "-", "year_of_birth·month_of_birth·day_of_birth 함께 채움"),
    (r"^(나이|age|진단시\s*연령|진단\s*나이)$", "person", "year_of_birth", "낮음", "-", "나이만 있으면 기준일(진단일)로 출생연도 역산"),
    (r"사망\s*일|dt_death|death_date", "death", "death_date", "높음", "-", ""),
    (r"사인|사망\s*원인|cause_of_death|^COD_", "death", "cause_concept_id", "중간", "ICD10/KCD8 → SNOMED", "cause_source_value에 원값"),
    (r"생존\s*(여부|상태)|survival_status|^사망\s*여부$|mortality", "death", "death_date", "낮음", "-", "사망이면 death 행 생성(일자는 사망일자 항목 사용)"),
    (r"직업|occupation|학력|교육|education|결혼|marital", "observation", "VAL", "중간", "SNOMED", "사회력(social history) 관찰"),
    # 진단
    (r"^(진단명|진단코드|dx_code|원발부위코드|진단종류명)$|kcd|icd-?10", "condition_occurrence", "condition_concept_id", "높음", "KCD8→ICD10→SNOMED / ICDO3",
     "condition_source_value에 원코드. 종양은 ICDO3 조직형/부위 조합 개념 권장"),
    (r"^(진단일자|진단일|dt_diagnosis|조직검사 암 진단일|산정특례 진단일|등록일자)$", "condition_occurrence", "condition_start_date", "높음", "-", ""),
    (r"조직학적\s*(진단명|유형|진단)|histolog(ic)?_?type|조직\s*형|morpholog", "condition_occurrence", "condition_concept_id", "중간", "ICDO3",
     "조직형(ICDO3 histology) + 원발부위(topography) 조합 개념으로 진단 레코드 구성"),
    (r"편측성|laterality", "measurement", "value_as_concept_id", "중간", "Cancer Modifier / SNOMED", MOD),
    (r"전이\s*(진단)?\s*일자|전신전이진단일자", "condition_occurrence", "condition_start_date", "중간", "-", "이차성 악성신생물(전이) 진단 레코드"),
    # 병기·종양 특성 (Cancer Modifier)
    (r"병기\s*(종류|체계)|staging_system|ajcc\s*(year|version|판)|edition|^stage year$|seer summary staging year", "measurement", "measurement_source_value", "낮음", "Cancer Modifier", "병기체계·판(edition)은 Cancer Modifier 개념 선택에 반영"),
    (r"tnm|병기\s*군|stage\s*group|_stage$|병기$|병기값$(?<!t병기값)(?<!n병기값)(?<!m병기값)", "measurement", "value_as_concept_id", "높음", "Cancer Modifier (AJCC/UICC)", "병기군(stage group). " + MOD),
    (r"t\s*병기|^y?[pc]{0,2}t$|^ycmri_?t$|clinical_t\b|_t_cat", "measurement", "value_as_concept_id", "높음", "Cancer Modifier (AJCC/UICC)", "T 범주 → Cancer Modifier 개념. " + MOD),
    (r"n\s*병기|^y?[pc]{0,2}n$|^ycmri_?n$|clinical_n\b|_n_cat", "measurement", "value_as_concept_id", "높음", "Cancer Modifier (AJCC/UICC)", "N 범주. " + MOD),
    (r"m\s*병기|^y?[pc]{0,2}m$|clinical_m\b|_m_cat", "measurement", "value_as_concept_id", "높음", "Cancer Modifier (AJCC/UICC)", "M 범주. " + MOD),
    (r"병기|stage", "measurement", "value_as_concept_id", "중간", "Cancer Modifier (AJCC/UICC)", "병기 관련 값. " + MOD),
    (r"부작용|합병증|toxicity|^grade_|compli|이상\s*반응|adverse|이식편\s*대\s*숙주|gvhd", "condition_occurrence", "CONCEPT_OR_DATE", "중간", "SNOMED / MedDRA",
     "이상반응을 condition으로, 등급(CTCAE)은 measurement(measurement_event_id=condition_occurrence_id)"),
    (r"gleason|조직학적\s*등급|핵\s*등급|분화도|fuhrman|differentiation|grade(?!_)", "measurement", "VAL", "중간", "Cancer Modifier", "조직학적 등급. " + MOD),
    (r"종양\s*(의\s*)?크기|tumou?r[_ ]?size|최대\s*(직경|크기)|병변의\s*크기", "measurement", "value_as_number", "높음", "Cancer Modifier / LOINC", "단위 mm(unit_concept_id 8588). " + MOD),
    (r"total\s*ln|총\s*림프절|검사\s*림프절|positive\s*ln|양성\s*림프절|전이\s*림프절\s*(수|개수)|sln", "measurement", "value_as_number", "높음", "Cancer Modifier", "림프절 수. " + MOD),
    (r"^lvi$|림프\s*혈관|lymphovascular|^pni$|신경\s*(주위)?\s*침윤|perineural|절제면|margin|잔여\s*종양|residual|radicality|침윤", "measurement", "value_as_concept_id", "중간", "Cancer Modifier / SNOMED", "병리 소견. " + MOD),
    (r"종양\s*개수|다발성|no_of_tumor|focality", "measurement", "value_as_number", "중간", "Cancer Modifier", MOD),
    (r"재발\s*부위|recur.*site|전이\s*부위|loca_of_metastasis|metastasis_site|원격\s*전이", "measurement", "value_as_concept_id", "중간", "Cancer Modifier (Metastasis to …)", MOD),
    # 질병 경과 (Oncology episode)
    (r"재발\s*(진단)?\s*(일자|일)|dt_recur|재발일|국소재발일", "episode", "episode_start_date", "중간", "Episode (Disease Progression 32677)", "episode_object_concept_id=재발 개념, episode_parent_id=Disease First Occurrence"),
    (r"재발\s*(여부|유무|형태|유형)|recur_yn|relapse_type|^국소\s*재발\s*(여부|유무)$", "episode", "episode_concept_id", "중간", "Episode (Disease Progression 32677)", "Y → 재발 episode 생성"),
    (r"치료\s*반응|치료\s*평가|response|^trg$|방사선치료후평가|disease.*status|질병\s*상태", "measurement", "value_as_concept_id", "중간", "Cancer Modifier / Episode", "치료 반응(RECIST 등) — 치료 episode에 연결"),
    # 수행상태·신체계측
    (r"ecog|karnofsky|lansky|수행\s*상태|performance", "measurement", "value_as_number", "높음", "LOINC (89247-1 ECOG)", ""),
    (r"^(height|키|신장|신장측정값)$", "measurement", "value_as_number", "높음", "LOINC 8302-2", "unit cm(8582)"),
    (r"^(weight|체중|몸무게|체중측정값)$|weight_postctx", "measurement", "value_as_number", "높음", "LOINC 29463-7", "unit kg(9529)"),
    (r"^(bmi|bmi값)$", "measurement", "value_as_number", "높음", "LOINC 39156-5", "unit kg/m2(9531)"),
    (r"체표면적|bsa", "measurement", "value_as_number", "높음", "LOINC 8277-6", "unit m2"),
    # 생활습관·가족력·병력 (observation)
    (r"흡연\s*(량|갑)|pack|smoking_amount|흡연\s*(기간|년수)|smoking_(duration|start|quit)", "observation", "value_as_number", "중간", "SNOMED/LOINC", "갑년(pack-year) 등 수치 관찰"),
    (r"흡연|smoking|tobacco|금연", "observation", "VAL", "높음", "SNOMED/LOINC (72166-2)", "여부·상태는 개념(현재/과거/비흡연), 수치는 value_as_number"),
    (r"음주\s*(량|횟수|빈도|기간)|drinking_(amount|no|duration)", "observation", "value_as_number", "중간", "SNOMED/LOINC", ""),
    (r"음주|drinking|alcohol", "observation", "VAL", "높음", "SNOMED", "여부는 개념, 연령·양은 value_as_number"),
    (r"가족력|fami_", "observation", "VAL", "중간", "SNOMED (Family history of …)", "observation_concept_id=가족력 개념, 관계는 qualifier_concept_id"),
    (r"과거력|현병력|^past_|^current_|기저\s*질환|동반\s*질환|comorbid", "observation", "VAL", "중간", "SNOMED", IV_HIST),
    (r"초경|폐경|출산|임신|모유|수유|hrt|경구\s*피임|menarche|menopaus", "observation", "VAL", "중간", "SNOMED/LOINC", "산과·생식력 관찰"),
    # 치료 — 수술·시술
    (r"수술\s*(일자|일)$|^dt_op$|수술일자|시술\s*일자", "procedure_occurrence", "procedure_date", "높음", "-", ""),
    (r"수술\s*명|op_name|수술\s*방법|op_method|수술명|시술\s*명|절제술|surgery", "procedure_occurrence", "procedure_concept_id", "높음", "SNOMED / ICD9Proc (국내 EDI 수가코드 매핑)", "procedure_source_value에 원값"),
    (r"수술\s*시간|소요\s*시간|op_time|허혈\s*시간|ischemic", "procedure_occurrence", "procedure_end_datetime", "낮음", "-", "시작·종료 시각이 있으면 procedure_datetime/procedure_end_datetime, 소요시간만 있으면 measurement 검토"),
    # 치료 — 방사선
    (r"방사선\s*(선량|총선량)|radiation.*dos|\bgy\b|rt_dose", "measurement", "value_as_number", "중간", "Cancer Modifier / UCUM Gy", "measurement_event_id = procedure_occurrence_id(방사선치료)"),
    (r"방사선\s*(횟수|분할)|fraction", "procedure_occurrence", "quantity", "중간", "-", "분할 횟수"),
    (r"방사선.*(시작|개시)|prert_start|rt_start|dt_postrt_start", "procedure_occurrence", "procedure_date", "높음", "-", "방사선치료 시작일"),
    (r"방사선.*(종료|완료)|prert_finish|rt_finish|rt_end", "procedure_occurrence", "procedure_end_date", "높음", "-", ""),
    (r"방사선\s*(치료)?\s*(명|종류|방법|여부|유무|목적명?)|radiation.*type|^rt_type|^postrt_yn$|^prert_yn$|ccrt|방사선치료$", "procedure_occurrence", "procedure_concept_id", "중간",
     "SNOMED / ICD9Proc", "치료 과정 단위는 episode(Treatment Regimen) 병행. 여부 항목은 Y → 레코드 생성"),
    # 치료 — 약물
    (r"요법$|regimen|항암제\s*프로토콜|postctx_type|prectx_type|ctx_type", "episode", "episode_object_concept_id", "중간", "HemOnc", "요법(regimen) = Treatment Regimen episode, 개별 약은 drug_exposure"),
    (r"(항암제?|약제|호르몬제?|면역항암제?|표적항암제?)\s*(성분명|약제명|약품명|명)|약제성분명|drug", "drug_exposure", "drug_concept_id", "높음", "RxNorm / RxNorm Extension (EDI·ATC 경유)", "drug_source_value에 원값"),
    (r"(항암|ctx|투여|호르몬).*(시작|start)|처방\s*일자", "drug_exposure", "drug_exposure_start_date", "높음", "-", ""),
    (r"(항암|ctx|투여).*(종료|finish|end)|투약\s*기간|치료\s*기간", "drug_exposure", "drug_exposure_end_date", "중간", "-", "기간만 있으면 days_supply"),
    (r"cycle|주기|사이클", "episode", "episode_number", "중간", "Episode (Treatment Cycle 32532)", "치료 주기 episode"),
    (r"용량|dose(?!_)|투여량", "drug_exposure", "quantity", "중간", "-", "단위는 dose_unit_source_value"),
    (r"용법|투여\s*경로|route", "drug_exposure", "sig", "중간", "-", "경로는 route_concept_id"),
    # 내원
    (r"입원\s*일|내원\s*일|초진|dt_admission|방문\s*일", "visit_occurrence", "visit_start_date", "높음", "-", ""),
    (r"퇴원\s*일|dt_discharge", "visit_occurrence", "visit_end_date", "높음", "-", ""),
    (r"재원\s*기간|hospital_stay", "visit_occurrence", "visit_end_date", "낮음", "-", "기간만 있으면 visit_start_date + 기간으로 산출"),
    (r"내원\s*목적|진료\s*구분|퇴원시\s*상태", "visit_occurrence", "visit_concept_id", "중간", "Visit", "입원 9201, 외래 9202, 응급 9203"),
    # 검체·검사·판독문
    (r"채취\s*일자|collect", "specimen", "specimen_date", "높음", "-", ""),
    (r"검체\s*(종류|명)|specimen", "specimen", "specimen_concept_id", "중간", "SNOMED", ""),
    (r"채취\s*(부위|위치)", "specimen", "anatomic_site_concept_id", "중간", "SNOMED", ""),
    (r"판독문|판독\s*내용|결과지|기록지|소견\s*내용|외래기록|결과\s*내용|conclusion", "note", "note_text", "중간", "-", "note_type/class 개념 지정, NLP는 note_nlp"),
    (r"\b(er|pr|her\s*-?2|ki-?67|pd-?l1|alk|ros1|egfr|kras|k-ras|n-ras|braf|msi|mlh1|msh2|msh6|pms2|brca|cea|ca\s*-?\s*19-?9|afp|psa|ldh|crp)\b", "measurement", "VAL", "높음", "LOINC / OMOP Genomic", "표지자·유전자 검사 결과"),
]
COMPILED = [(re.compile(p, re.I), t, f, c, v, n) for p, t, f, c, v, n in RULES]


def load_fields(path=FIELD_CSV):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    fields = {}
    for r in rows:
        k = r["cdmTableName"] + "." + r["cdmFieldName"]
        fields[k] = {"table": r["cdmTableName"], "field": r["cdmFieldName"], "required": r["isRequired"] == "TRUE",
                     "type": r["cdmDatatype"], "fk": r["fkTableName"] if r["fkTableName"] != "NA" else "",
                     "fkDomain": r["fkDomain"] if r["fkDomain"] != "NA" else "", "guide": (r["userGuidance"] or "")[:240]}
    return fields


def load_tables(path=TABLE_CSV):
    out = {}
    for r in csv.DictReader(open(path, encoding="utf-8")):
        out[r["cdmTableName"]] = (r.get("tableDescription") or "")[:300]
    return out


def is_flag(it):
    codes = it.get("codes") or []
    if codes and sorted(str(c[0]).upper() for c in codes) in (["N", "U", "Y"], ["N", "Y"]):
        return True
    return it["role"] == "여부" or re.search(r"(여부|유무)$", it["name"]) or re.search(r"_yn$", it["name"], re.I)


def resolve(table, token, it):
    tdef = T[table]
    if token == "DATE":
        return tdef["date"]
    if token == "CONCEPT":
        return tdef["concept"]
    if token == "CONCEPT_OR_DATE":
        return tdef["date"] if it["type"] == "DATE" else tdef["concept"]
    if token != "VAL":
        return token
    if it["type"] == "DATE":
        return tdef["date"]
    if table == "measurement":
        if it["type"] in ("NUMERIC", "INTEGER"):
            return "value_as_number"
        return "value_as_concept_id" if (it["type"] == "CODE" or is_flag(it)) else "value_source_value"
    if table == "observation":
        if it["type"] in ("NUMERIC", "INTEGER"):
            return "value_as_number"
        return "value_as_concept_id" if (it["type"] == "CODE" or is_flag(it)) else "value_as_string"
    return tdef["concept"]


def fallback(it):
    """2단계: KR Core FHIR 리소스 + 자료형으로 대체 배정"""
    path = it["core"]["path"]
    res = path.split(".")[0]
    t, d = it["type"], it["role"]
    meas_like = d in ("수치", "결과", "표지자", "등급", "단위", "횟수") or it["cat1"] in ("검사", "병리") or t in ("NUMERIC", "INTEGER")
    if res == "Patient":
        return ("observation", "VAL", "낮음", "SNOMED", "인구학 관찰")
    if res == "Organization":
        return ("care_site", "care_site_source_value", "중간", "-", "")
    if res == "Encounter":
        return ("visit_occurrence", "DATE" if t == "DATE" else "visit_source_value", "중간", "Visit", "")
    if res == "Condition":
        if path.endswith("verificationStatus") or is_flag(it):
            return ("observation", "value_as_concept_id", "중간", "SNOMED", IV_HIST)
        if t == "DATE":
            return ("condition_occurrence", "condition_start_date", "중간", "-", "")
        if path.endswith(".note"):
            return ("note", "note_text", "낮음", "-", "진단 관련 서술 — 구조화 가능하면 condition_occurrence")
        return ("condition_occurrence", "condition_concept_id", "중간", "SNOMED / ICD10", "condition_source_value에 원값")
    if res in ("Procedure",):
        if t == "DATE":
            return ("procedure_occurrence", "procedure_date", "중간", "-", "")
        if is_flag(it) or path.endswith(".status"):
            return ("procedure_occurrence", "procedure_concept_id", "낮음", "SNOMED", "Y → 해당 시술 레코드 생성, N → 미생성")
        if path.endswith(".note") or t == "VARCHAR" and not path.endswith(".code"):
            return ("measurement" if meas_like else "observation", "VAL", "낮음", "SNOMED", "시술 관련 속성 — measurement_event_id/observation_event_id 로 procedure_occurrence 연결")
        return ("procedure_occurrence", "procedure_concept_id", "중간", "SNOMED / ICD9Proc", "")
    if res in ("MedicationRequest", "Medication", "Immunization"):
        if t == "DATE":
            return ("drug_exposure", "drug_exposure_start_date", "중간", "-", "")
        if is_flag(it) or path.endswith(".status"):
            return ("drug_exposure", "drug_concept_id", "낮음", "RxNorm", "Y → 약물 노출 레코드 생성(약 정보 필요)")
        if "dosage" in path:
            return ("drug_exposure", "sig", "중간", "-", "")
        return ("drug_exposure", "drug_concept_id", "중간", "RxNorm / RxNorm Extension", "")
    if res == "AdverseEvent":
        if t == "DATE":
            return ("condition_occurrence", "condition_start_date", "중간", "-", "이상반응 발생일")
        return ("condition_occurrence", "condition_concept_id", "중간", "SNOMED / MedDRA", "등급은 measurement 수식자")
    if res == "FamilyMemberHistory":
        return ("observation", "VAL", "중간", "SNOMED (Family history of …)", "")
    if res == "Specimen":
        return ("specimen", "DATE" if t == "DATE" else "specimen_concept_id", "중간", "SNOMED", "")
    if res == "DiagnosticReport":
        if t == "DATE":
            return ("procedure_occurrence", "procedure_date", "중간", "-", "검사(영상·병리) 시행일")
        if path.endswith(".code"):
            return ("procedure_occurrence", "procedure_concept_id", "중간", "SNOMED / LOINC", "검사 시행 레코드")
        return ("note", "note_text", "중간", "-", "판독·보고서 서술")
    # Observation (기본)
    if t == "DATE":
        return ("measurement" if meas_like else "observation", "DATE", "중간", "-", "")
    if path.endswith(".note"):
        return ("observation", "value_as_string", "낮음", "-", "")
    return ("measurement" if meas_like else "observation", "VAL", "중간" if meas_like else "낮음",
            "LOINC / SNOMED" if meas_like else "SNOMED", "")


def map_item(it, fields):
    names = [("표준명", [it["name"]]), ("원천별칭", [a[0] for a in it.get("aliases", []) if a[0] != it["name"]])]
    hit = None
    for label, cands in names:
        for rx, table, token, conf, vocab, note in COMPILED:
            n = next((x for x in cands if rx.search(x)), None)
            if n is not None:
                hit = (table, token, conf if label == "표준명" or conf != "높음" else "중간", vocab, note, label + " '" + n + "' ~ /" + rx.pattern[:60] + "/")
                break
        if hit:
            break
    if not hit:
        table, token, conf, vocab, note = fallback(it)
        hit = (table, token, conf, vocab, note, "대체규칙: FHIR " + it["core"]["path"] + " · " + it["type"] + " · " + it["role"])
    table, token, conf, vocab, note, basis = hit
    field = resolve(table, token, it)
    key = table + "." + field
    if key not in fields:
        raise KeyError("OMOP 필드 없음: " + key + " (" + it["name"] + ")")
    tdef = T[table]
    return {"table": table, "field": field, "concept": tdef["concept"], "date": tdef["date"], "source": tdef["source"],
            "vocab": vocab, "note": note, "conf": conf, "basis": basis}


def apply(items):
    fields = load_fields()
    tables = load_tables()
    for it in items:
        it["omop"] = map_item(it, fields)
    dict_ = {"version": "5.4", "source": "https://github.com/OHDSI/CommonDataModel (inst/csv/OMOP_CDMv5.4_Field_Level.csv)",
             "tables": [{"name": t, "desc": tables.get(t, ""), "fields": [k.split(".", 1)[1] for k in fields if k.startswith(t + ".")]} for t in CLINICAL],
             "fields": {k: v for k, v in fields.items() if v["table"] in CLINICAL}}
    return dict_


if __name__ == "__main__":
    from common import setup_console
    setup_console()
    import json
    from collections import Counter
    spec = json.load(open(os.path.join(ROOT, "spec", "kcure_spec.json"), encoding="utf-8"))
    d = apply(spec["items"])
    it = spec["items"]
    print("fields", len(d["fields"]), "tables", len(d["tables"]))
    print(Counter(i["omop"]["table"] for i in it))
    print(Counter(i["omop"]["conf"] for i in it))
    print(Counter("규칙" if not i["omop"]["basis"].startswith("대체") else "대체" for i in it))
    import random
    random.seed(7)
    for x in random.sample(it, 45):
        print(f"  {x['name'][:24]:26s} {x['type']:8s} -> {x['omop']['table']}.{x['omop']['field']} [{x['omop']['conf']}]")
