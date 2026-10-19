"""범용(비 K-CURE) 표준 사전 생성 → spec/generic_spec.json(.js)

K-CURE 항목정의서에 없는 일반 병원 데이터(입원·외래·검사·처방 등)를 변환하기 위한 사전이다.
항목은 K-CURE 항목과 같은 구조(id·name·type·role·cdi·core·mcode·omop·aliases)라서 기존 매핑·FHIR·KR CDI·DCAT·가명처리 엔진을 그대로 쓴다.
- KR CDI V3 80항목을 기준으로 하고(cdi 번호), KR Core 경로·프로파일은 kcure_spec.json 의 KR CDI 대응표에서 가져온다.
- 별칭(aliases)은 정확히 같은 이름, 패턴(patterns)은 별칭 사전에 없는 컬럼명을 약어 단위로 대조한다(위에서부터 처음 일치).
- obsMod: 세로형(long) 검사 데이터에서 같은 행의 값 Observation 에 붙는 수식 항목(code·display·referenceRange·interpretation)

사용법: python tools/build_generic.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "spec" / "kcure_spec.json"
OUT = ROOT / "spec" / "generic_spec.json"

# (id, 이름, 정의, cat1, cat2, domain, role, type, unit, KR CDI 번호, KR Core 경로 덮어쓰기, OMOP "table.field", 어휘, 별칭, 추가속성)
G = [
    ("G001", "환자ID", "의료기관이 부여한 환자 식별번호", "환자", "기본정보", "Patient", "식별·인구학", "VARCHAR", "", 1, None, "person.person_source_value", "-",
     ["환자ID", "환자번호", "등록번호", "병록번호", "차트번호", "병원번호", "PAT_ID", "PATIENT_ID", "PT_ID", "PT_NO", "PID", "MRN", "CHART_NO", "REG_NO", "HOSP_NO", "PAT_NO"], {}),
    ("G002", "성명", "환자 성명", "환자", "기본정보", "Patient", "식별·인구학", "VARCHAR", "", 2, None, None, "-",
     ["성명", "이름", "환자명", "환자성명", "환자이름", "NAME", "PAT_NM", "PT_NM", "PATIENT_NAME", "PAT_NAME", "PT_NAME"], {}),
    ("G003", "생년월일", "환자 생년월일", "환자", "기본정보", "Patient", "식별·인구학", "DATE", "", 3, None, "person.birth_datetime", "-",
     ["생년월일", "생일", "BIRTH_DT", "BIRTH_DATE", "DOB", "BIRTH_YMD", "BRTH_DT", "BIRTHDAY"], {}),
    ("G004", "성별", "환자 성별", "환자", "기본정보", "Patient", "식별·인구학", "CODE", "", 4, None, "person.gender_concept_id", "Gender",
     ["성별", "GENDER", "SEX", "SEX_CD", "GENDER_CD", "SEX_TP"], {"codeYN": "Y", "allowed": "M: 남, F: 여, U: 미상", "codes": [["M", "남"], ["F", "여"], ["U", "미상"]]}),
    ("G005", "나이", "기준 시점의 나이(세)", "환자", "기본정보", "Patient", "연령", "INTEGER", "a", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueQuantity"),
     "observation.value_as_number", "LOINC 30525-0", ["나이", "연령", "AGE", "PAT_AGE", "PT_AGE", "AGE_YR"], {}),
    ("G006", "전화번호", "환자 연락처", "환자", "연락처", "Patient", "식별·인구학", "VARCHAR", "", 5, None, None, "-",
     ["전화번호", "연락처", "휴대폰", "휴대전화", "TEL", "TEL_NO", "PHONE", "PHONE_NO", "HP", "HP_NO", "MOBILE", "CELL"], {}),
    ("G007", "이메일", "환자 이메일", "환자", "연락처", "Patient", "식별·인구학", "VARCHAR", "", 6, None, None, "-", ["이메일", "EMAIL", "E_MAIL", "EMAIL_ADDR"], {}),
    ("G008", "주소", "환자 주소", "환자", "연락처", "Patient", "식별·인구학", "VARCHAR", "", 7, None, "location.address_1", "-", ["주소", "거주지", "ADDR", "ADDRESS", "ADDR1", "HOME_ADDR"], {}),
    ("G009", "건강보험유형", "건강보험 자격 구분", "환자", "기본정보", "Patient", "명칭", "CODE", "", 8, None, "observation.value_source_value", "-",
     ["건강보험유형", "보험유형", "급여구분", "보험구분", "INS_TYPE", "INS_TP", "PAYER"], {}),
    ("G010", "사망일자", "사망 일자", "환자", "사망", "Patient", "일자", "DATE", "", None, ("KR Core Patient Profile", "Patient.deceasedDateTime"), "death.death_date", "-",
     ["사망일", "사망일자", "DEATH_DT", "DEATH_DATE", "DOD"], {}),
    ("G011", "진료의ID", "진료의 식별번호(면허번호 등)", "진료", "진료의", "Patient", "식별·인구학", "VARCHAR", "", 10, None, "provider.provider_source_value", "-",
     ["진료의ID", "의사번호", "면허번호", "DR_ID", "DOC_ID", "PHYS_ID", "PROVIDER_ID"], {}),
    ("G012", "진료의 성명", "진료·처방한 의사 이름", "진료", "진료의", "Patient", "식별·인구학", "VARCHAR", "", 11, None, None, "-",
     ["진료의", "진료의명", "처방의", "처방의사", "처방의명", "담당의", "담당의사", "주치의", "의사명", "DR_NM", "DOC_NM", "DOCTOR", "PHYSICIAN", "ATTEND_DR"], {}),
    ("G013", "진료과", "진료과목", "진료", "내원", "Patient", "명칭", "CODE", "", 12, None, "visit_occurrence.visit_source_value", "-",
     ["진료과", "진료과목", "진료과명", "DEPT", "DEPT_CD", "DEPT_NM", "DEPARTMENT", "MED_DEPT"], {}),
    ("G014", "의료기관ID", "요양기관번호 등 기관 식별자", "진료", "기관", "Patient", "명칭", "VARCHAR", "", 13, None, "care_site.care_site_source_value", "-",
     ["의료기관ID", "요양기관번호", "기관코드", "병원코드", "HOSP_CD", "INST_CD", "ORG_CD", "FACILITY_ID"], {}),
    ("G015", "진료구분", "외래·입원·응급 구분", "진료", "내원", "Patient", "상태", "CODE", "", 19, None, "visit_occurrence.visit_concept_id", "Visit",
     ["진료구분", "내원구분", "외래입원구분", "입원외래구분", "VISIT_TYPE", "ENC_TYPE", "IO_TP", "IO_GB", "PAT_TYPE"], {}),
    ("G016", "입원(내원)일자", "입원 또는 내원 시작 일자", "진료", "내원", "Patient", "일자", "DATE", "", 21, None, "visit_occurrence.visit_start_date", "-",
     ["입원일", "입원일자", "내원일", "내원일자", "진료일", "진료일자", "외래일자", "ADMIT_DATE", "ADMIT_DT", "ADM_DT", "ADM_DATE", "VISIT_DT", "VISIT_DATE", "IN_DT", "도착일시", "도착시간", "내원일시", "ARRIVAL_DT", "ARRIVAL_TIME", "ER_IN_DT"], {}),
    ("G017", "퇴원일자", "퇴원 또는 내원 종료 일자", "진료", "내원", "Patient", "일자", "DATE", "", 22, None, "visit_occurrence.visit_end_date", "-",
     ["퇴원일", "퇴원일자", "DISCH_DT", "DSCH_DT", "DISCHARGE_DATE", "DISCH_DATE", "OUT_DT"], {}),
    ("G018", "진단코드", "진단(상병) 코드(KCD-8/ICD-10)", "진단", "진단", "Disease", "명칭", "CODE", "", 24, None, "condition_occurrence.condition_concept_id", "KCD-8 → ICD10",
     ["진단코드", "상병코드", "주상병코드", "질병코드", "DIAG_CODE", "DIAG_CD", "DX_CD", "DX_CODE", "ICD_CD", "ICD10", "KCD", "KCD_CD", "SICK_CD"], {"codeYN": "Y", "codeName": "KCD-8"}),
    ("G019", "진단명", "진단(상병)명", "진단", "진단", "Disease", "명칭", "VARCHAR", "", 24, None, "condition_occurrence.condition_source_value", "-",
     ["진단명", "상병명", "질병명", "DIAG_NM", "DIAG_NAME", "DX_NM", "DX_NAME", "SICK_NM"], {"ccText": True}),
    ("G020", "진단일자", "진단 일자", "진단", "진단", "Disease", "일자", "DATE", "", 23, None, "condition_occurrence.condition_start_date", "-",
     ["진단일", "진단일자", "DIAG_DT", "DIAG_DATE", "DX_DT", "DX_DATE"], {}),
    ("G021", "수술·처치명", "수술 또는 처치 명칭·코드", "치료", "수술", "Treatment", "명칭", "VARCHAR", "", 30, None, "procedure_occurrence.procedure_concept_id", "EDI / SNOMED",
     ["수술명", "처치명", "수술코드", "시술명", "OP_CD", "OP_NM", "OP_NAME", "PROC_CD", "PROC_NM", "SURG_NM"], {}),
    ("G022", "수술·처치일자", "수술 또는 처치 일자", "치료", "수술", "Treatment", "일자", "DATE", "", 29, None, "procedure_occurrence.procedure_date", "-",
     ["수술일", "수술일자", "시술일", "처치일", "OP_DT", "OP_DATE", "PROC_DT", "SURG_DT"], {}),
    ("G023", "약품코드", "처방 약품 코드(EDI/KD)", "치료", "처방", "Treatment", "명칭", "CODE", "", 33, None, "drug_exposure.drug_concept_id", "EDI → RxNorm",
     ["약품코드", "약코드", "약제코드", "처방코드", "DRUG_CD", "DRUG_CODE", "MED_CD", "MED_CODE", "EDI_CD", "ITEM_CD"], {"codeYN": "Y", "codeName": "심평원 EDI"}),
    ("G024", "약품명", "처방 약품명", "치료", "처방", "Treatment", "명칭", "VARCHAR", "", 33, None, "drug_exposure.drug_source_value", "-",
     ["약품명", "약명", "약제명", "처방약", "처방약품명", "DRUG_NM", "DRUG_NAME", "MED_NM", "MED_NAME", "ITEM_NM"], {"ccText": True}),
    ("G025", "성분명", "약품 주성분명", "치료", "처방", "Treatment", "명칭", "VARCHAR", "", 34, None, "drug_exposure.drug_source_value", "ATC",
     ["성분명", "주성분", "주성분명", "INGR_NM", "INGREDIENT", "GENERIC_NM"], {}),
    ("G026", "1회 투여량", "1회 투여 용량", "치료", "처방", "Treatment", "수치", "NUMERIC", "", 35, None, "drug_exposure.quantity", "-",
     ["1회량", "1회투여량", "1회 투여량", "투여량", "용량", "DOSE", "DOSE_QTY", "ONCE_QTY", "QTY"], {}),
    ("G027", "투여량 단위", "1회 투여 용량 단위", "치료", "처방", "Treatment", "단위", "VARCHAR", "", 36, None, "drug_exposure.dose_unit_source_value", "UCUM",
     ["투여단위", "용량단위", "투여량단위", "DOSE_UNIT", "DOSE_UNIT_CD"], {}),
    ("G028", "1일 투여횟수", "하루 투여(복용) 횟수", "치료", "처방", "Treatment", "횟수", "INTEGER", "회/일", 37, None, "drug_exposure.sig", "-",
     ["복용횟수", "투여횟수", "1일횟수", "1일 횟수", "1일투여횟수", "FREQ", "FREQUENCY", "DAILY_FREQ", "TIMES"], {}),
    ("G029", "투여경로", "투여 경로·용법", "치료", "처방", "Treatment", "방법", "VARCHAR", "", 38, None, "drug_exposure.route_source_value", "-",
     ["투여경로", "용법", "경로", "ROUTE", "ROUTE_CD", "ADMIN_ROUTE"], {}),
    ("G030", "처방일수", "처방(투약) 일수", "치료", "처방", "Treatment", "기간", "INTEGER", "d", 39, None, "drug_exposure.days_supply", "-",
     ["처방일수", "투약일수", "일수", "DAYS", "ORD_DAYS", "DAYS_SUPPLY", "RX_DAYS"], {}),
    ("G031", "처방일시", "처방 일자·일시", "치료", "처방", "Treatment", "일자", "DATE", "", 44, None, "drug_exposure.drug_exposure_start_date", "-",
     ["처방일", "처방일자", "처방일시", "ORD_DT", "ORDER_DT", "ORDER_DATE", "RX_DT", "PRSC_DT"], {}),
    ("G032", "검사코드", "검사 코드(EDI/LOINC/기관 코드)", "검사", "검체검사", "Assessment", "명칭", "CODE", "", 45, None, "measurement.measurement_source_value", "EDI / LOINC",
     ["검사코드", "LAB_CD", "LAB_CODE", "TEST_CD", "TEST_CODE", "EXAM_CD", "EXAM_CODE", "ORD_CD_LAB"], {"obsMod": "code"}),
    ("G033", "검사명", "검사 항목명", "검사", "검체검사", "Assessment", "명칭", "VARCHAR", "", 45, None, "measurement.measurement_source_value", "-",
     ["검사명", "검사항목", "LAB_NM", "LAB_NAME", "TEST_NM", "TEST_NAME", "EXAM_NM", "EXAM_NAME"], {"obsMod": "display"}),
    ("G034", "검사결과", "검사 결과값", "검사", "검체검사", "Assessment", "결과", "VARCHAR", "", 47, None, "measurement.value_as_number", "-",
     ["검사결과", "결과", "결과값", "RESULT", "RSLT", "RSLT_VAL", "RESULT_VAL", "RESULT_VALUE", "LAB_RESULT", "TEST_RESULT", "VALUE", "VAL"], {}),
    ("G035", "결과 단위", "검사 결과 단위", "검사", "검체검사", "Assessment", "단위", "VARCHAR", "", None, ("KR Core Observation Profile for Laboratory Result", "Observation.valueQuantity.unit"),
     "measurement.unit_source_value", "UCUM", ["결과단위", "단위", "UNIT", "RSLT_UNIT", "RESULT_UNIT", "UNIT_CD"], {}),
    ("G036", "참고치", "참고구간(정상범위)", "검사", "검체검사", "Assessment", "결과", "VARCHAR", "", 49, None, "measurement.range_low", "-",
     ["참고치", "참고구간", "참고범위", "정상범위", "정상치", "REF_RANGE", "REF_RNG", "NORMAL_RANGE", "REF", "REFERENCE"], {"obsMod": "referenceRange"}),
    ("G037", "판정", "결과 판정(H/L/N)", "검사", "검체검사", "Assessment", "등급", "CODE", "", 50, None, "measurement.value_source_value", "HL7 Interpretation",
     ["판정", "결과판정", "이상여부", "FLAG", "HL", "H_L", "ABN_FLAG", "RSLT_FLAG", "RESULT_FLAG", "JUDGE"], {"obsMod": "interpretation"}),
    ("G038", "검사일시", "검사(검체 채취) 일자·일시", "검사", "검체검사", "Assessment", "일자", "DATE", "", 52, ("KR Core Observation Profile for Laboratory Result", "Observation.effectiveDateTime"),
     "measurement.measurement_date", "-", ["검사일", "검사일자", "검사일시", "채취일", "채취일시", "TEST_DT", "TEST_DATE", "LAB_DT", "EXAM_DT", "COLL_DT", "SPCM_DT", "RSLT_DT"], {}),
    ("G039", "검체 종류", "검체 종류", "검사", "검체검사", "Assessment", "명칭", "VARCHAR", "", 46, None, "specimen.specimen_source_value", "SNOMED",
     ["검체", "검체종류", "SPECIMEN", "SPCM", "SPCM_TP", "SAMPLE_TYPE"], {}),
    ("G040", "영상검사명", "진단영상검사 명칭", "검사", "영상검사", "Assessment", "명칭", "VARCHAR", "", 53, None, "procedure_occurrence.procedure_source_value", "EDI / LOINC",
     ["영상검사명", "영상검사", "검사종류", "검사구분", "IMG_NM", "RAD_NM", "MODALITY", "EXAM_TYPE", "STUDY_TYPE", "MODALITY_CD"], {}),
    ("G041", "판독소견", "영상 판독 소견(자유문)", "검사", "영상검사", "Assessment", "소견", "VARCHAR", "", 54, None, "note.note_text", "-",
     ["판독소견", "판독결과", "판독", "READING", "RPT_TXT", "REPORT_TEXT", "IMPRESSION"], {}),
    ("G042", "키", "신장(키)", "검사", "신체계측", "Assessment", "수치", "NUMERIC", "cm", 68, None, "measurement.value_as_number", "LOINC 8302-2",
     ["키", "신장측정값", "HT", "HEIGHT", "HT_CM", "BODY_HT"], {}),
    ("G043", "체중", "체중(몸무게)", "검사", "신체계측", "Assessment", "수치", "NUMERIC", "kg", 69, None, "measurement.value_as_number", "LOINC 29463-7",
     ["체중", "몸무게", "WT", "WEIGHT", "WT_KG", "BODY_WT"], {}),
    ("G044", "수축기 혈압", "수축기 혈압", "검사", "활력징후", "Assessment", "수치", "NUMERIC", "mmHg", 62, None, "measurement.value_as_number", "LOINC 8480-6",
     ["수축기혈압", "수축기 혈압", "SBP", "BP_SYS", "SYSTOLIC"], {}),
    ("G045", "이완기 혈압", "이완기 혈압", "검사", "활력징후", "Assessment", "수치", "NUMERIC", "mmHg", 63, None, "measurement.value_as_number", "LOINC 8462-4",
     ["이완기혈압", "이완기 혈압", "DBP", "BP_DIA", "DIASTOLIC"], {}),
    ("G046", "맥박수", "맥박수(심박수)", "검사", "활력징후", "Assessment", "수치", "NUMERIC", "/min", 64, None, "measurement.value_as_number", "LOINC 8867-4",
     ["맥박", "맥박수", "심박수", "PR", "PULSE", "HR", "HEART_RATE"], {}),
    ("G047", "체온", "체온", "검사", "활력징후", "Assessment", "수치", "NUMERIC", "Cel", 66, None, "measurement.value_as_number", "LOINC 8310-5",
     ["체온", "BT", "TEMP", "BODY_TEMP"], {}),
    ("G048", "BMI", "체질량지수", "검사", "신체계측", "Assessment", "수치", "NUMERIC", "kg/m2", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueQuantity"),
     "measurement.value_as_number", "LOINC 39156-5", ["BMI", "체질량지수"], {}),
    ("G049", "알레르기 원인물질", "알레르기·불내성 원인 물질", "환자", "알레르기", "Patient", "명칭", "VARCHAR", "", 71, None, "observation.observation_source_value", "ATC",
     ["알레르기", "알레르기원인", "약물알레르기", "ALLERGY", "ALLERGEN"], {}),
    ("G050", "흡연상태", "흡연 상태", "환자", "건강상태", "Patient", "여부", "CODE", "", 80, None, "observation.value_as_concept_id", "SNOMED",
     ["흡연", "흡연여부", "흡연상태", "SMOKING", "SMK", "SMK_YN", "SMOKE"], {}),
    ("G051", "음주상태", "음주 상태", "환자", "건강상태", "Patient", "여부", "CODE", "", 79, None, "observation.value_as_concept_id", "SNOMED",
     ["음주", "음주여부", "음주상태", "ALCOHOL", "ALC", "ALC_YN", "DRINKING"], {}),
    ("G052", "진료기록(자유문)", "경과기록·메모 등 자유문", "진료", "기록", "Patient", "소견", "VARCHAR", "", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueString"),
     "note.note_text", "-", ["경과기록", "진료기록", "간호기록", "메모", "비고", "소견", "NOTE", "NOTES", "PROGRESS_NOTE", "NURSING_NOTE", "NURSE_NOTE", "MEMO", "REMARK", "RMK", "COMMENT"], {}),
    # ---- v0.2: 영상·병리·간호·응급·수술 상세·진단 구분 ----
    ("G053", "영상검사일시", "영상 촬영(검사) 일자·일시", "검사", "영상검사", "Assessment", "일자", "DATE", "", None, ("KR Core DiagnosticReport Profile for Diagnostic Imaging", "DiagnosticReport.effectiveDateTime"),
     "procedure_occurrence.procedure_date", "-", ["촬영일", "촬영일시", "영상검사일", "영상검사일시", "SCAN_DT", "IMG_DT", "STUDY_DT", "STUDY_DATE"], {}),
    ("G054", "검사 부위", "검사·촬영 부위", "검사", "검사부위", "Assessment", "부위", "VARCHAR", "", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.bodySite"),
     "procedure_occurrence.procedure_source_value", "SNOMED", ["검사부위", "촬영부위", "부위", "BODY_SITE", "BODYPART", "BODY_PART", "SITE", "EXAM_SITE"], {}),
    ("G055", "판독일시", "판독(보고) 일자·일시", "검사", "영상검사", "Assessment", "일자", "DATE", "", 48, ("KR Core DiagnosticReport Profile for Diagnostic Imaging", "DiagnosticReport.issued"),
     "note.note_date", "-", ["판독일", "판독일시", "판독일자", "보고일", "보고일시", "READ_DT", "READING_DT", "REPORT_DT", "RPT_DT"], {}),
    ("G056", "판독의", "판독한 의사 이름", "진료", "판독의", "Patient", "식별·인구학", "VARCHAR", "", 11, None, None, "-",
     ["판독의", "판독의사", "판독의명", "판독자", "READ_DR", "READER", "RADIOLOGIST", "PATHOLOGIST", "READ_DOC"], {}),
    ("G057", "병리번호", "병리(검체) 접수번호", "검사", "병리검사", "Assessment", "식별·인구학", "VARCHAR", "", None, ("KR Core Specimen Profile", "Specimen.accessionIdentifier"),
     "specimen.specimen_source_id", "-", ["병리번호", "병리검사번호", "검체번호", "PATH_NO", "PATHO_NO", "ACC_NO", "ACCESSION_NO", "SPCM_NO"], {}),
    ("G058", "병리진단명", "조직병리 진단명", "검사", "병리검사", "Assessment", "결과", "VARCHAR", "", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueCodeableConcept"),
     "observation.value_as_string", "ICD-O-3", ["병리진단", "병리진단명", "조직진단", "조직학적진단", "PATH_DX", "PATHO_DX", "HISTOLOGY", "PATHOLOGY_DX", "PATH_DIAG"], {}),
    ("G059", "통증 점수", "통증 척도 점수(NRS 등)", "검사", "활력징후", "Assessment", "수치", "INTEGER", "{score}", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueQuantity"),
     "measurement.value_as_number", "LOINC 72514-3", ["통증", "통증점수", "통증척도", "NRS", "VAS", "PAIN", "PAIN_SCORE", "PAIN_SCR"], {}),
    ("G060", "의식 상태", "의식 수준(AVPU·GCS 등)", "검사", "활력징후", "Assessment", "등급", "CODE", "", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueCodeableConcept"),
     "measurement.value_source_value", "LOINC 80288-4", ["의식", "의식상태", "의식수준", "MENTAL", "MENTALITY", "LOC", "AVPU", "GCS", "CONSCIOUSNESS"], {}),
    ("G061", "섭취량", "수분 섭취량", "검사", "활력징후", "Assessment", "수치", "NUMERIC", "mL", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueQuantity"),
     "measurement.value_as_number", "LOINC 9108-2", ["섭취량", "섭취", "INTAKE", "IN_QTY", "IO_IN", "FLUID_IN"], {}),
    ("G062", "배설량", "배설(배출)량", "검사", "활력징후", "Assessment", "수치", "NUMERIC", "mL", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueQuantity"),
     "measurement.value_as_number", "LOINC 9187-6", ["배설량", "배출량", "소변량", "OUTPUT", "OUT_QTY", "IO_OUT", "URINE_OUT", "FLUID_OUT"], {}),
    ("G063", "병동", "입원 병동·병실", "진료", "내원", "Patient", "명칭", "VARCHAR", "", None, ("KR Core Encounter Profile", "Encounter.location"),
     "care_site.care_site_source_value", "-", ["병동", "병실", "병동명", "WARD", "WARD_CD", "WARD_NM", "ROOM", "UNIT_NM"], {}),
    ("G064", "내원 경로", "내원(입원) 경로", "진료", "내원", "Patient", "방법", "CODE", "", None, ("KR Core Encounter Profile", "Encounter.hospitalization.admitSource"),
     "visit_occurrence.admitted_from_source_value", "-", ["내원경로", "입원경로", "ARRIVAL_ROUTE", "ADM_ROUTE", "ADMIT_SOURCE", "VISIT_ROUTE", "ADM_SRC"], {}),
    ("G065", "내원 수단", "내원(이송) 수단", "진료", "응급", "Patient", "방법", "CODE", "", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueCodeableConcept"),
     "observation.value_as_string", "-", ["내원수단", "이송수단", "ARRIVAL_MODE", "ARRIVAL_MEANS", "TRANSPORT", "TRANS_MODE"], {}),
    ("G066", "주호소", "주호소(주증상)", "진단", "주호소", "Disease", "명칭", "VARCHAR", "", 27, None, "condition_occurrence.condition_source_value", "-",
     ["주호소", "주증상", "CC", "C_C", "CHIEF_COMPLAINT", "CHIEF_COMP"], {}),
    ("G067", "증상 발생일시", "주호소(증상) 발생 일시", "진단", "주호소", "Disease", "일자", "DATE", "", 26, None, "condition_occurrence.condition_start_date", "-",
     ["발생일", "발생일시", "증상발생일시", "ONSET_DT", "ONSET_TIME", "ONSET", "SX_ONSET"], {}),
    ("G068", "중증도(KTAS)", "응급 중증도 분류", "진료", "응급", "Patient", "등급", "INTEGER", "", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueQuantity"),
     "observation.value_as_number", "-", ["KTAS", "KTAS_LV", "KTAS_LEVEL", "중증도", "중증도분류", "TRIAGE", "TRIAGE_LV", "ESI"], {}),
    ("G069", "퇴실 결과", "응급실 퇴실·퇴원 형태", "진료", "내원", "Patient", "상태", "CODE", "", None, ("KR Core Encounter Profile", "Encounter.hospitalization.dischargeDisposition"),
     "visit_occurrence.discharged_to_source_value", "-", ["퇴실결과", "진료결과", "퇴원형태", "퇴실형태", "DISPOSITION", "DISP", "ER_RESULT", "DISCH_TYPE"], {}),
    ("G070", "호흡수", "호흡수", "검사", "활력징후", "Assessment", "수치", "NUMERIC", "/min", 65, None, "measurement.value_as_number", "LOINC 9279-1",
     ["호흡수", "호흡", "RR", "RESP", "RESP_RATE", "BREATH"], {}),
    ("G071", "산소포화도", "말초 산소포화도", "검사", "활력징후", "Assessment", "수치", "NUMERIC", "%", 67, None, "measurement.value_as_number", "LOINC 59408-5",
     ["산소포화도", "SPO2", "SP_O2", "O2SAT", "O2_SAT", "SAT"], {}),
    ("G072", "혈압(수축기/이완기)", "혈압 합본 표기(예: 120/80)", "검사", "활력징후", "Assessment", "수치", "VARCHAR", "mmHg", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueString"),
     "measurement.value_source_value", "LOINC 85354-9", ["혈압", "BP", "BLOOD_PRESSURE"], {}),
    ("G073", "마취 방법", "마취 방법", "치료", "수술", "Treatment", "방법", "CODE", "", 31, None, "procedure_occurrence.procedure_source_value", "SNOMED",
     ["마취", "마취방법", "마취종류", "ANES", "ANES_TP", "ANESTHESIA", "ANES_TYPE"], {}),
    ("G074", "진단 구분(주/부상병)", "주진단·부진단 구분", "진단", "진단", "Disease", "상태", "CODE", "", None, ("KR Core Condition Profile for Encounter Diagnosis", "Condition.category"),
     "condition_occurrence.condition_status_source_value", "-", ["상병구분", "진단구분", "주부상병", "주부상병구분", "DX_TP", "DIAG_TYPE", "DX_TYPE", "MAIN_YN", "PRIMARY_YN"], {}),
    ("G075", "간호사 성명", "기록·측정한 간호사 이름", "진료", "간호사", "Patient", "식별·인구학", "VARCHAR", "", None, ("KR Core Practitioner Profile for Medical Doctor", "Practitioner.name"), None, "-",
     ["간호사", "간호사명", "담당간호사", "작성간호사", "기록자", "작성자", "NURSE", "NURSE_NM", "RN_NM", "RECORDER"], {}),
    ("G076", "측정일시", "활력징후·간호 측정(기록) 일시", "검사", "활력징후", "Assessment", "일자", "DATE", "", None, ("KR Core Observation Profile for Laboratory Result", "Observation.effectiveDateTime"),
     "measurement.measurement_date", "-", ["측정일", "측정일시", "기록일시", "MEASURE_DT", "RECORD_DT", "VS_DT", "CHART_DT", "MSR_DT"], {}),
    ("G077", "수술 시간", "수술 소요 시간(분)", "치료", "수술", "Treatment", "기간", "INTEGER", "min", None, ("KR Core 미정의 — FHIR R4 Observation 기본 리소스 파생", "Observation.valueQuantity"),
     "observation.value_as_number", "-", ["수술시간", "소요시간", "OP_TIME", "OP_DURATION", "SURG_TIME"], {}),
]

# 별칭 사전에 없는 컬럼명 → 정규식(소문자, 공백·기호는 '_' 로 바꾼 뒤 대조). 위에서부터 처음 일치.
PATTERNS = [
    (r"(^|_)(dr|doc|doctor|phys|physician|attend)(_|$).*(nm|name)|(진료의|처방의|담당의|주치의|의사).*(명|이름|성명)?$", "G012"),
    (r"(^|_)(dr|doc|phys|provider)_?(id|no|cd)$|면허", "G011"),
    (r"birth|dob|생년월일|생일", "G003"),
    (r"(^|_)(pat|pt|patient|reg|chart|mrn|hosp|med_rec)_?(id|no|num|number|key)$|(환자|등록|차트|병록).*(번호|id)$|^(id|no|key)$", "G001"),
    (r"(^|_)(pat|pt|patient)?_?(nm|name|kor_nm)$|^(환자)?(성명|이름|환자명)$", "G002"),
    (r"(^|_)(sex|gender)", "G004"),
    (r"(^|_)age(_|$)|나이|연령", "G005"),
    (r"tel|phone|mobile|(^|_)hp(_|$)|cell|연락처|전화|휴대", "G006"),
    (r"e_?mail|이메일", "G007"),
    (r"addr|주소", "G008"),
    (r"death|dod|사망", "G010"),
    (r"(diag|dx|icd|kcd|sick|상병|진단).*(cd|code|코드)|^(icd|kcd)", "G018"),
    (r"(diag|dx|sick|상병|진단).*(nm|name|명)$", "G019"),
    (r"(diag|dx|진단).*(dt|date|일|ymd)", "G020"),
    (r"(adm|admit|visit|in|입원|내원|진료|외래).*(dt|date|일|일자|ymd)$", "G016"),
    (r"(disch|dsch|out|퇴원).*(dt|date|일|일자|ymd)$", "G017"),
    (r"(op|surg|proc|수술|시술|처치).*(dt|date|일|일자|ymd)$", "G022"),
    (r"(op|surg|proc|수술|시술|처치).*(cd|code|nm|name|명|코드)$", "G021"),
    (r"(lab|test|exam|검사|채취|coll|spcm|rslt|result).*(dt|date|dttm|tm|time|일|일시|일자|ymd)$", "G038"),
    (r"(ord|order|rx|prsc|처방).*(dt|date|dttm|일|일시|일자|ymd)$", "G031"),
    (r"(lab|test|exam|검사).*(cd|code|코드)$", "G032"),
    (r"(lab|test|exam|검사).*(nm|name|명|항목)$", "G033"),
    (r"(ref|normal|참고|정상).*(range|rng|val|치|범위|구간)?$", "G036"),
    (r"flag|(^|_)hl(_|$)|abn|interp|판정|이상", "G037"),
    (r"(rslt|result|결과).*(unit|단위)|^unit$|(^|_)unit(_|$)|^단위$", "G035"),
    (r"(rslt|result|결과|value|val)(_|$)|결과값", "G034"),
    (r"(drug|med|item|약|edi).*(cd|code|코드)$", "G023"),
    (r"(drug|med|item|약).*(nm|name|명)$", "G024"),
    (r"(ingr|성분)", "G025"),
    (r"dose.*unit|(투여|용량).*단위", "G027"),
    (r"(^|_)(dose|qty)|투여량|용량|1회", "G026"),
    (r"freq|횟수|(^|_)(tid|bid|qd)(_|$)", "G028"),
    (r"route|경로|용법", "G029"),
    (r"days|일수", "G030"),
    (r"dept|진료과", "G013"),
    (r"(hosp|inst|org|facility|기관|요양)", "G014"),
    (r"(visit|enc|io)_?(type|tp|gb)|구분$", "G015"),
    (r"arriv.*(dt|date|time|tm)$|도착", "G016"),
    (r"(read|판독).*(dr|doc|의$|의사|er$)|radiolog|patholog.*(dr|doc|ist)|판독의", "G056"),
    (r"(nurse|(^|_)rn(_|$)|간호사|작성자|기록자)", "G075"),
    (r"(measure|record|msr|(^|_)vs|vital|측정|기록).*(dt|date|time|tm|일시|일자)$", "G076"),
    (r"(read|rpt|report|판독|보고).*(dt|date|time|tm|일|일시|일자)$", "G055"),
    (r"(scan|img|image|study|촬영|영상).*(dt|date|time|tm|일|일시|일자)$", "G053"),
    (r"onset|발생", "G067"),
    (r"(patho|path|병리|검체|acc).*(no|num|번호)$", "G057"),
    (r"(patho|path|병리|조직).*(dx|diag|진단)|histolog", "G058"),
    (r"(body|exam)?_?(site|part)|부위", "G054"),
    (r"pain|통증|(^|_)nrs(_|$)", "G059"),
    (r"mental|consc|(^|_)(loc|avpu|gcs)(_|$)|의식", "G060"),
    (r"intake|섭취", "G061"),
    (r"(^|_)output|urine|배설|배출|소변", "G062"),
    (r"ward|병동|병실", "G063"),
    (r"(arriv|admit|adm|visit|내원|입원).*(route|path|src|source|경로)", "G064"),
    (r"(arriv|trans).*(mode|means|method)|수단", "G065"),
    (r"chief|(^|_)cc(_|$)|주호소|주증상", "G066"),
    (r"ktas|triage|(^|_)esi(_|$)|중증도", "G068"),
    (r"dispo|퇴실|(er|ed)_?(result|rslt)|^outcome$", "G069"),
    (r"systolic|(^|_)sbp(_|$)|수축기", "G044"),
    (r"diastolic|(^|_)dbp(_|$)|이완기", "G045"),
    (r"temp|체온", "G047"),
    (r"heart_?rate|pulse|(^|_)(hr|pr)(_|$)|맥박|심박", "G046"),
    (r"(^|_)(rr|resp)(_|$)|resp(iratory)?_?rate|breath|호흡", "G070"),
    (r"spo2|o2_?sat|(^|_)sat(_|$)|산소포화", "G071"),
    (r"(^|_)bp(_|$)|blood_?press|혈압", "G072"),
    (r"anes|마취", "G073"),
    (r"(dx|diag|진단|상병).*(type|tp|구분)|주부상병|main_?yn", "G074"),
    (r"(op|surg|수술).*(time|duration|시간)", "G077"),
    (r"note|memo|remark|rmk|comment|기록|메모|비고|소견|서술", "G052"),
]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    krcdi = {k["no"]: k for k in spec["krcdi"]}
    ids = spec["meta"]["krcoreIds"]
    base = spec["meta"]["krcoreBase"]
    omop_t = {"person": ("", "", "person_source_value"), "measurement": ("measurement_concept_id", "measurement_date", "measurement_source_value"),
              "observation": ("observation_concept_id", "observation_date", "observation_source_value"),
              "condition_occurrence": ("condition_concept_id", "condition_start_date", "condition_source_value"),
              "procedure_occurrence": ("procedure_concept_id", "procedure_date", "procedure_source_value"),
              "drug_exposure": ("drug_concept_id", "drug_exposure_start_date", "drug_source_value"),
              "visit_occurrence": ("visit_concept_id", "visit_start_date", "visit_source_value"),
              "note": ("note_class_concept_id", "note_date", "note_source_value"), "death": ("cause_concept_id", "death_date", "cause_source_value"),
              "specimen": ("specimen_concept_id", "specimen_date", "specimen_source_value"), "provider": ("", "", "provider_source_value"),
              "care_site": ("place_of_service_concept_id", "", "care_site_source_value"), "location": ("", "", "location_source_value"),
              "payer_plan_period": ("payer_concept_id", "payer_plan_period_start_date", "payer_source_value")}
    items = []
    for gid, name, defi, c1, c2, dom, role, typ, unit, cdi_no, core_over, omop, vocab, aliases, extra in G:
        k = krcdi.get(cdi_no)
        prof, path = core_over if core_over else (k["coreProfile"], k["corePath"])
        pid = ids.get(prof)
        it = {
            "id": "GEN-" + gid, "name": name, "def": defi, "cat1": c1, "cat2": c2, "tier": "범용", "domain": dom, "role": role, "cancers": [],
            "type": typ, "len": None, "dec": None, "storage": typ, "unit": unit, "codeYN": extra.get("codeYN", "N"), "codeName": extra.get("codeName", ""),
            "allowed": extra.get("allowed", ""), "req": "", "generic": True,
            "cdi": {"cls": k["cls"], "el": k["el"], "req": k["req"], "match": "직접대응", "no": k["no"]} if k else {},
            "core": {"profile": prof, "path": path, "judge": "직접재사용" if prof.startswith("KR Core ") and "미정의" not in prof else "제약재사용",
                     "url": base + pid[0] if pid else "", "urlSrc": ("KR Core(" + pid[1] + ")") if pid else ""},
            "mcode": {"profile": "해당 없음", "path": "해당 없음", "level": "미대응"},
            "prf": "", "grade": "", "stage": "범용 사전(후보)", "gap": "", "examples": [],
            "aliases": [[a, []] for a in aliases], "argo": {},
        }
        if omop:
            t, f = omop.split(".")
            c, d, s = omop_t.get(t, ("", "", ""))
            it["omop"] = {"table": t, "field": f, "concept": c, "date": d, "source": s, "vocab": vocab, "note": "", "conf": "중간", "basis": "범용 사전"}
        if "codes" in extra:
            it["codes"] = extra["codes"]
        if gid in ("G002", "G006", "G007", "G008", "G011", "G012", "G056", "G075"):
            it["directId"] = True  # 가명처리 ON 이면 FHIR·KR CDI 결과에서 제외
        if extra.get("ccText"):
            it["ccText"] = True  # 같은 행의 코드 항목과 같은 CodeableConcept 의 text 로 합친다
        if "obsMod" in extra:
            it["obsMod"] = extra["obsMod"]
        items.append(it)
    known = {i["id"] for i in items}
    for _rx, gid in PATTERNS:
        assert "GEN-" + gid in known, gid
    # 앞 컬럼 문맥으로 뜻을 정하는 항목: [모호 항목, 앞 컬럼 항목, 바꿀 항목]
    # 앞 컬럼 문맥 [모호 항목, 앞 컬럼 항목, 바꿀 항목] 또는 데이터셋 문맥 [모호 항목, {present, absent}, 바꿀 항목]
    context = [["GEN-G035", "GEN-G026", "GEN-G027"], ["GEN-G027", "GEN-G034", "GEN-G035"],
               # 판독 관련 컬럼이 있고 검사결과 값 컬럼이 없으면 '검사일'은 영상·병리 검사일
               ["GEN-G038", {"present": ["GEN-G055", "GEN-G041", "GEN-G040", "GEN-G056"], "absent": ["GEN-G034"]}, "GEN-G053"]]
    data = {"version": "0.2.1", "context": context, "note": "범용(비 K-CURE) 병원 데이터용 표준 사전 — KR CDI V3 기반, 규칙 후보",
            "items": items, "patterns": [[rx, "GEN-" + gid] for rx, gid in PATTERNS]}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    (OUT.with_suffix(".js")).write_text("window.KCURE_GENERIC=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8", newline="\n")
    print(f"범용 항목 {len(items)} · 별칭 {sum(len(i['aliases']) for i in items)} · 패턴 {len(PATTERNS)} · KR CDI 연결 {sum(1 for i in items if i['cdi'])} → {OUT}")


if __name__ == "__main__":
    main()
