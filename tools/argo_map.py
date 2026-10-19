"""K-CURE 표준항목 → ICGC ARGO Data Dictionary v1.34 후보 매핑 (규칙 기반).

기존 항목정의서에는 ARGO 대응이 없으므로, 항목명·원천 별칭·정의문에 대한 정규식 규칙으로
'후보' 매핑을 만든다. 첫 번째로 일치하는 규칙을 채택한다(순서 = 우선순위).
신뢰도: 높음(명칭이 개념과 1:1) / 중간(개념은 같으나 값 변환·해석 필요) / 낮음(관련 개념, 전문가 확인 필수)

사용: build_spec.py 가 import 해서 spec 에 argo 사전과 항목별 argo 후보를 넣는다.
단독 실행 시 커버리지 요약을 출력한다.
"""
import os
import re
import warnings

from openpyxl import load_workbook

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from common import setup_console, source_path  # noqa: E402

IV = "일자 → 진단일 기준 경과일(interval, days) 계산 필요"

# (정규식, 스키마.필드, 신뢰도, 변환·주의)  — 정규식은 '항목명 | 별칭들' 문자열에 대해 대소문자 무시로 검사
RULES = [
    # ---- 제외(오탐 방지): 매핑하지 않음 ----
    (r"^(기록일자|자료등록년도|등록일자|STAGE YEAR|SEER SUMMARY STAGING YEAR|AJCC Year)$", None, "", ""),
    (r"\bcea\b|cea_|_cea|^yccea", None, "", ""),          # CEA: ARGO biomarker 에 대응 필드 없음
    (r"백신|vaccine", None, "", ""),                        # HPV 백신 ≠ HPV 검사
    (r"prior_abdominal|이전\s*(복부\s*)?수술|과거\s*수술", None, "", ""),  # 과거 수술력: ARGO 대응 필드 없음
    (r"이식편\s*대\s*숙주|gvhd", "treatment.adverse_events", "중간", "GVHD → 이상반응(CTCAE)으로 표현"),
    (r"mortality_op|수술\s*(관련\s*)?사망", "donor.vital_status", "낮음", "수술 관련 사망 여부 — vital_status + cause_of_death 조합으로 표현 검토"),
    # ---- 식별자 ----
    (r"^(병원번호|환자등록번호|환자번호|등록번호|no_patient|patient_id|pid)$", "sample_registration.submitter_donor_id", "중간",
     "원 식별자 제출 금지 — 가명 ID로 치환해 제출(정규식 ^[A-Za-z0-9\\-\\._]{1,64}$)"),
    # ---- donor ----
    (r"^(성별|sex|gender)$", "sample_registration.gender", "높음", "값 매핑: M→Male, F→Female, U→(해당 없음)"),
    (r"생존\s*(여부|상태)|survival_status|^사망\s*여부$|vital", "donor.vital_status", "높음", "값 매핑: 생존→Alive, 사망→Deceased"),
    (r"사망\s*일|dt_death|death_date", "donor.survival_time", "중간", "진단일~사망일 일수 계산(vital_status=Deceased일 때)"),
    (r"사인|사망\s*원인|cause_of_death|^COD_|유방암 치료와 사망의 관련성", "donor.cause_of_death", "중간", "값 매핑: 암 사망→Died of cancer, 기타→Died of other reasons"),
    (r"원발\s*부위", "donor.primary_site", "중간", "ICD-O 부위명(ARGO 허용값 70종)으로 변환"),
    (r"^(height|키|신장|신장측정값)$", "donor.height", "높음", "단위 cm"),
    (r"^(weight|체중|몸무게|체중측정값)$", "donor.weight", "높음", "단위 kg"),
    (r"^(bmi|bmi값)$", "donor.bmi", "높음", "단위 kg/m²"),
    (r"폐경\s*(유무|여부|상태)|menopaus", "donor.menopause_status", "높음", "값 매핑: Y→Postmenopausal, N→Premenopausal"),
    (r"초경\s*나이|menarche", "donor.age_at_menarche", "높음", ""),
    (r"임신\s*횟수|pregnanc", "donor.number_of_pregnancies", "높음", ""),
    (r"출산\s*자녀\s*수|자녀\s*수|number_of_children", "donor.number_of_children", "높음", ""),
    (r"hrt\s*기간", "donor.hrt_duration", "높음", "개월 단위"),
    (r"hrt", "donor.hrt_type", "중간", "경험 유무 → HRT 종류 허용값 매핑 필요"),
    (r"경구\s*피임약.*기간|contraception.*duration", "donor.contraception_duration", "높음", "개월 단위"),
    (r"경구\s*피임약|contracept", "donor.contraception_type", "중간", "사용 유무 → 종류 허용값 매핑 필요"),
    (r"hereditary|유전성|유전\s*질환", "donor.genetic_disorders", "중간", ""),
    # ---- primary_diagnosis ----
    (r"^(나이|age|진단시\s*연령|진단\s*나이)$", "primary_diagnosis.age_at_diagnosis", "중간", "기준 시점이 진단 시인지 확인 필요(ARGO: 진단 시 나이, 최대 90)"),
    (r"생년월일|dt_birth", "primary_diagnosis.age_at_diagnosis", "중간", "생년월일·진단일로 진단 시 나이 계산"),
    (r"^(진단명|진단코드|dx_code|원발부위코드|진단종류명)$|kcd|icd-?10", "primary_diagnosis.cancer_type_code", "중간", "KCD → ICD-10 C/D 코드 형식(^[C|D][0-9]{2}...)"),
    (r"^(진단일자|진단일|dt_diagnosis|조직검사 암 진단일|산정특례 진단일)$", "primary_diagnosis.age_at_diagnosis", "낮음", "진단일 = ARGO 모든 interval의 기준(day 0). 나이 계산 입력"),
    (r"진단\s*(방법|경로)|meth_diagnosis|basis", "primary_diagnosis.basis_of_diagnosis", "중간", "값 매핑: 조직검사→Histology of the primary tumour 등"),
    (r"편측성|laterality", "primary_diagnosis.laterality", "높음", "값 매핑: L→Left, R→Right"),
    (r"주\s*증상|초기\s*증상|^pre_symptom|presenting", "primary_diagnosis.presenting_symptoms", "중간", ""),
    (r"ecog|karnofsky|lansky|수행\s*상태|performance", "primary_diagnosis.performance_status", "높음", "ECOG 0~4"),
    (r"임상\s*병기\s*종류|clinical.*staging_system", "primary_diagnosis.clinical_tumour_staging_system", "높음", "예: AJCC 8th edition"),
    (r"임상\s*t\s*병기|^ct$|^ct_|clinical_t", "primary_diagnosis.clinical_t_category", "높음", ""),
    (r"임상\s*n\s*병기|^cn$|^cn_|clinical_n", "primary_diagnosis.clinical_n_category", "높음", ""),
    (r"임상\s*m\s*병기|^cm$|^cm_|clinical_m", "primary_diagnosis.clinical_m_category", "높음", ""),
    (r"임상\s*(tnm\s*)?병기\s*값|임상\s*병기$|clinical.*stage", "primary_diagnosis.clinical_stage_group", "높음", ""),
    (r"total\s*ln|총\s*림프절|검사\s*림프절|number_lymph_nodes_examined|no_ln_harvest|total\s*(n)?sln", "primary_diagnosis.number_lymph_nodes_examined", "높음", ""),
    (r"positive\s*ln|양성\s*림프절|전이\s*림프절\s*(수|개수)|no_ln_meta", "primary_diagnosis.number_lymph_nodes_positive", "높음", ""),
    (r"sentinel|감시\s*림프절", "primary_diagnosis.lymph_nodes_examined_method", "중간", ""),
    # ---- specimen (병리) ----
    (r"병리\s*(학적)?\s*병기\s*종류|pathologic.*staging_system|ajcc", "specimen.pathological_tumour_staging_system", "높음", ""),
    (r"^y[pc]{1,2}(tnm)?_?stage|^y[pc]{1,2}tnm|치료\s*후.*(tnm\s*)?병기\s*(값)?$", "follow_up.posttherapy_stage_group", "높음", ""),
    (r"^y[pc]{1,2}(mri_?)?t$|수술\s*후.*t\s*병기|치료\s*후.*t\s*병기", "follow_up.posttherapy_t_category", "높음", ""),
    (r"^y[pc]{1,2}(mri_?)?n$|치료\s*후.*n\s*병기", "follow_up.posttherapy_n_category", "높음", ""),
    (r"^y[pc]{1,2}m$|치료\s*후.*m\s*병기", "follow_up.posttherapy_m_category", "높음", ""),
    (r"병리\s*t\s*병기|^pt$|^pt_|pathologic.*_t|병리학적\s*t", "specimen.pathological_t_category", "높음", ""),
    (r"병리\s*n\s*병기|^pn$|^pn_|pathologic.*_n|병리학적\s*n", "specimen.pathological_n_category", "높음", ""),
    (r"병리\s*m\s*병기|^pm$|^pm_|pathologic.*_m|병리학적\s*m", "specimen.pathological_m_category", "높음", ""),
    (r"병리\s*(학적)?\s*(tnm\s*)?병기\s*값|병리\s*병기$|pathologic.*stage", "specimen.pathological_stage_group", "높음", ""),
    (r"조직학적\s*(진단명|유형|진단)|histolog(ic)?_?type|조직\s*형|morpholog", "specimen.tumour_histological_type", "높음", "ICD-O-3 형태코드 형식"),
    (r"gleason|조직학적\s*등급|핵\s*등급|분화도|fuhrman|histologic.*grade|differentiation", "specimen.tumour_grade", "중간", "등급체계(tumour_grading_system) 함께 지정"),
    (r"종양\s*세포.*(%|비율)|tumou?r.*cellularity", "specimen.percent_tumour_cells", "중간", ""),
    (r"채취\s*(부위|위치)|채취부위|specimen.*(site|location)", "specimen.specimen_anatomic_location", "중간", ""),
    (r"채취\s*일자|collect", "specimen.specimen_acquisition_interval", "중간", IV),
    (r"검체\s*(종류|명)|specimen_type|검체종류", "sample_registration.specimen_tissue_source", "낮음", "검체 원천 허용값 매핑"),
    # ---- surgery ----
    (r"종양\s*(의\s*)?크기|tumou?r[_ ]?size|최대\s*(직경|크기)|병변의\s*크기|tumor_size", "surgery.greatest_dimension_tumour", "중간", "단위 cm→mm 확인"),
    (r"종양\s*개수|다발성|no_of_tumor|focality|tumour number", "surgery.tumour_focality", "중간", "개수 → Unifocal/Multifocal"),
    (r"잔여\s*종양|residual|radicality|^r[012]$", "surgery.residual_tumour_classification", "높음", "R0/R1/R2"),
    (r"절제면|resection_margin|radial_margin|margin", "surgery.margin_types_involved", "중간", "침범 절제면 종류로 재구성"),
    (r"^lvi$|림프\s*혈관|lymphovascular|^lymphatic", "surgery.lymphovascular_invasion", "높음", ""),
    (r"^pni$|신경\s*(주위)?\s*침윤|perineural", "surgery.perineural_invasion", "높음", ""),
    (r"수술\s*부위|op_site|surgery_site", "surgery.surgery_site", "중간", ""),
    (r"수술\s*(일자|일)$|^dt_op$|수술일자|시술\s*일자", "treatment.treatment_start_interval", "중간", "treatment_type=Surgical; " + IV),
    (r"수술\s*명|op_name|수술\s*방법|op_method|^surgery|수술명|시술\s*명|절제술", "surgery.surgery_type", "중간", "ARGO surgery_type 허용값으로 매핑"),
    # ---- radiation ----
    (r"방사선\s*(선량|총선량)|radiation.*dos|\bgy\b|rt_dose", "radiation.radiation_therapy_dosage", "높음", "단위 Gy"),
    (r"방사선\s*(횟수|분할)|fraction", "radiation.radiation_therapy_fractions", "높음", ""),
    (r"방사선\s*치료\s*부위|조사\s*부위|irradiat", "radiation.anatomical_site_irradiated", "높음", ""),
    (r"방사선.*(시작|개시)|prert_start|rt_start|dt_postrt_start", "treatment.treatment_start_interval", "중간", "treatment_type=Radiation therapy; " + IV),
    (r"방사선.*(종료|완료)|prert_finish|rt_finish|rt_end", "treatment.treatment_duration", "중간", "시작~종료 일수 계산"),
    (r"방사선\s*치료\s*(명|종류)|rt_type|radiation.*type|방사선\s*치료\s*방법|modality", "radiation.radiation_therapy_type", "중간", "External/Internal"),
    (r"방사선.*(여부|유무)|^postrt_yn|^prert_yn|ccrt", "treatment.treatment_type", "중간", "Y → treatment_type=Radiation therapy"),
    # ---- systemic therapy ----
    (r"호르몬제?\s*(성분명|약제명)", "hormone_therapy.drug_name", "중간", "RxNorm 연계 권장"),
    (r"호르몬.*(투여|치료).*(여부|유무)|호르몬치료제\s*여부|차세대?호르몬", "treatment.treatment_type", "중간", "Y → treatment_type=Hormonal therapy"),
    (r"면역\s*항암|immuno", "immunotherapy.immunotherapy_type", "중간", ""),
    (r"표적\s*항암", "treatment.treatment_type", "중간", "Y → treatment_type=Targeted therapy"),
    (r"(항암제?|약제)\s*(성분명|약제명|약품명)|약제성분명|postctx_type|prectx_type|regimen|요법$|항암제\s*프로토콜", "chemotherapy.drug_name", "중간", "요법명은 성분별 행으로 분해, RxNorm 연계 권장"),
    (r"용량\s*감량|dose.*reduc", "chemotherapy.dose_intensity_reduction", "높음", ""),
    (r"(항암|ctx).*(시작|start)|처방\s*일자|투여\s*시작", "treatment.treatment_start_interval", "중간", "treatment_type=Chemotherapy; " + IV),
    (r"(항암|ctx).*(종료|finish|end)|투약\s*기간|치료\s*기간", "treatment.treatment_duration", "중간", "시작~종료 일수"),
    (r"cycle|주기|사이클", "treatment.number_of_cycles", "중간", ""),
    (r"치료\s*목적|intent|curative_palliative", "treatment.treatment_intent", "높음", "값 매핑: 근치→Curative, 고식→Palliative"),
    (r"선행|보조|neoadjuvant|adjuvant|^preop_tx|수술\s*전\s*(항암|방사선|치료)", "treatment.treatment_setting", "중간", "Neoadjuvant/Adjuvant"),
    (r"치료\s*반응|치료\s*평가|response|^trg$|방사선치료후평가", "treatment.response_to_treatment", "중간", "RECIST/TRG 기준 지정(response_to_treatment_criteria_method)"),
    (r"부작용|합병증|toxicity|^grade_|compli|이상\s*반응|adverse", "treatment.adverse_events", "중간", "CTCAE 용어·등급으로 매핑"),
    (r"임상\s*시험|clinical_trial", "treatment.clinical_trial_number", "중간", ""),
    (r"조혈모|이식|transplant", "treatment.treatment_type", "낮음", "treatment_type=Stem cell transplant"),
    (r"(항암|ctx|약제).*(여부|유무|_yn)|^postctx_yn|^prectx_yn|^chemo", "treatment.treatment_type", "중간", "Y → treatment_type=Chemotherapy"),
    (r"(수술|시술).*(여부|유무)|^reop", "treatment.treatment_type", "낮음", "Y → treatment_type=Surgical (재수술 등은 별도 치료 레코드)"),
    # ---- follow_up ----
    (r"재발\s*부위|recur.*site|전이\s*부위|loca_of_metastasis|metastasis_site", "follow_up.anatomic_site_progression_or_recurrence", "중간", ""),
    (r"재발\s*(확인|진단)\s*방법|progression.*method", "follow_up.method_of_progression_status", "중간", ""),
    (r"재발\s*(진단)?\s*(일자|일)|dt_recur|재발일|국소재발일|전이\s*진단\s*일자|전신전이진단일자", "follow_up.relapse_interval", "중간", IV),
    (r"재발\s*(형태|유형|종류)|국소\s*재발|원격\s*(재발|전이)|relapse_type", "follow_up.relapse_type", "중간", "Local recurrence/Distant recurrence 등"),
    (r"재발.*병기", "follow_up.recurrence_stage_group", "중간", ""),
    (r"재발\s*(여부|유무)|recur_yn|^recur", "follow_up.disease_status_at_followup", "중간", "값 매핑: Y→Relapse or recurrence, N→No evidence of disease"),
    (r"최종\s*(추적|내원|관찰)|last_follow|추적\s*관찰\s*(일|일자)$", "follow_up.interval_of_followup", "중간", IV),
    (r"추적\s*관찰\s*결과|질병\s*상태|disease.*status", "follow_up.disease_status_at_followup", "중간", ""),
    (r"weight_postctx|추적.*체중", "follow_up.weight_at_followup", "중간", ""),
    # ---- exposure ----
    (r"흡연\s*(량|갑)|pack|smoking_amount", "exposure.pack_years_smoked", "중간", "갑/일 × 흡연년수 = 갑년 계산"),
    (r"흡연\s*(기간|년수)|smoking_duration|smoking_start|smoking_quit", "exposure.pack_years_smoked", "낮음", "갑년 계산 입력값"),
    (r"흡연|smoking|tobacco", "exposure.tobacco_smoking_status", "중간", "값 매핑: 현재/과거/비흡연 → ARGO 허용값"),
    (r"음주\s*종류|alcohol_type", "exposure.alcohol_type", "높음", ""),
    (r"음주\s*(량|횟수|빈도|기간)|drinking_(amount|no|duration)", "exposure.alcohol_consumption_category", "낮음", "섭취량 → 범주(None/Social/Moderate/Heavy) 변환"),
    (r"음주|drinking|alcohol", "exposure.alcohol_history", "높음", "Y→Yes, N→No"),
    (r"운동|exercise", "exposure.exercise_frequency", "중간", ""),
    # ---- family_history ----
    (r"가족력.*(관계)|fami_person|가족\s*관계", "family_history.relationship_type", "높음", ""),
    (r"가족력.*암종|fami_hx_ca_type|가족력_암종", "family_history.cancer_type_code_of_relative", "중간", "암종 → ICD-10 코드"),
    (r"가족력.*암\s*여부|fami_hx_ca_yn|가족력_암여부", "family_history.relative_with_cancer_history", "높음", "Y→Yes, N→No"),
    (r"가족력\s*(여부)?$|fami_hx_yn|가족력여부", "family_history.relative_with_cancer_history", "낮음", "전체 가족력 여부(암 이외 포함) — 확인 필요"),
    # ---- biomarker ----
    (r"ca\s*-?\s*19\s*-?\s*9", "biomarker.ca19-9_level", "높음", ""),
    (r"\bcrp\b", "biomarker.crp_levels", "높음", ""),
    (r"\bldh\b", "biomarker.ldh_level", "높음", ""),
    (r"\banc\b|호중구", "biomarker.anc", "중간", ""),
    (r"\balc\b|림프구\s*수", "biomarker.alc", "중간", ""),
    (r"brca", "biomarker.brca_carrier", "중간", ""),
    (r"\ber\b.*allred", "biomarker.er_allred_score", "높음", ""),
    (r"\ber\s*\(%\)|\ber\b.*(%|percent|비율)", "biomarker.er_percent_positive", "높음", ""),
    (r"\ber\b|에스트로겐", "biomarker.er_status", "높음", "Y→Positive, N→Negative"),
    (r"\bpr\b.*allred", "biomarker.pr_allred_score", "높음", ""),
    (r"\bpr\s*\(%\)|\bpr\b.*(%|percent|비율)", "biomarker.pr_percent_positive", "높음", ""),
    (r"\bpr\b|프로게스테론", "biomarker.pr_status", "높음", "Y→Positive, N→Negative"),
    (r"her\s*-?2.*(ish|fish|sish)", "biomarker.her2_ish_status", "높음", ""),
    (r"her\s*-?2|c-?erbb2", "biomarker.her2_ihc_status", "높음", ""),
    (r"pd\s*-?l1", "biomarker.pd-l1_status", "높음", ""),
    (r"\balk\b.*fish", "biomarker.alk_fish_status", "높음", ""),
    (r"\balk\b", "biomarker.alk_ihc_status", "중간", ""),
    (r"ros\s*-?1", "biomarker.ros1_ihc_status", "높음", ""),
    (r"\bret\b", "biomarker.ret_fish_status", "중간", ""),
    (r"\bhpv\b", "biomarker.hpv_dna_status", "중간", "검사법(IHC/DNA) 확인"),
    # ---- comorbidity ----
    (r"과거력.*암\s*(여부|종)|past_dx_ca|이전\s*암|prior.*malig", "comorbidity.prior_malignancy", "중간", "값 매핑: Y→Yes"),
    (r"과거력|현병력|^past_|^current_|기저\s*질환|동반\s*질환|comorbid", "comorbidity.comorbidity_type_code", "중간", "질환 → ICD-10 코드(comorbidity_type_code)"),
]

COMPILED = [(re.compile(p, re.I), t, c, n) for p, t, c, n in RULES]


def load_dictionary(path=None):
    path = path or source_path("argo")
    """ARGO 사전 → {schemas:[...], fields:{'schema.field': {...}}}"""
    wb = load_workbook(path, read_only=True, data_only=True)
    pv = {}
    if "Permissible_Values" in wb.sheetnames:
        for r in list(wb["Permissible_Values"].iter_rows(values_only=True))[1:]:
            if r[0]:
                pv.setdefault(f"{r[0]}.{r[1]}", []).append(str(r[3]))
    schemas, fields = [], {}
    idx = {}
    for r in list(wb["Index"].iter_rows(values_only=True))[3:]:
        if r[0] and r[1] is not None:
            idx[str(r[0])] = str(r[2] or "")
    for ws in wb.worksheets:
        if ws.title in ("Index", "Permissible_Values", "Validation_Scripts"):
            continue
        rows = list(ws.iter_rows(values_only=True))
        head = [str(h) for h in rows[0]]
        col = {h: i for i, h in enumerate(head)}
        names = []
        for r in rows[1:]:
            if not r[0]:
                continue
            key = f"{ws.title}.{r[0]}"
            perm = str(r[col["Permissible Values / Restrictions"]] or "")
            vals = pv.get(key)
            fields[key] = {
                "schema": ws.title, "field": str(r[0]), "label": str(r[col["Display Name"]] or ""),
                "desc": str(r[col["Description"]] or ""), "tier": str(r[col["Data Tier"]] or ""),
                "req": str(r[col["Attributes"]] or ""), "type": str(r[col["Type"]] or ""),
                "units": str(r[col["Units"]] or ""), "dependsOn": str(r[col["Depends On"]] or ""),
                # 짧은 허용값 목록은 셀 안에 줄바꿈으로, 긴 목록은 Permissible_Values 시트에 있다
                "values": vals if vals else ([] if not perm or perm.startswith(("Range", "Regular", "Regex")) or "values — see" in perm
                                             else [v.strip() for v in perm.split("\n") if v.strip()]),
                "restriction": perm if (perm.startswith(("Range", "Regular")) ) else "",
            }
            names.append(str(r[0]))
        schemas.append({"name": ws.title, "desc": idx.get(ws.title, ""), "fields": names})
    return {"version": "1.34", "source": "https://docs.icgc-argo.org/dictionary", "schemas": schemas, "fields": fields}


def map_item(item, fields):
    # 1차: 표준항목명으로만 대조 → 2차: 원천 별칭으로 대조 (별칭의 우연한 일치가 이름 일치를 가리지 않도록)
    passes = [("표준명", [item["name"]]), ("원천별칭", [a[0] for a in item.get("aliases", []) if a[0] != item["name"]])]
    for label, names in passes:
        for rx, target, conf, note in COMPILED:
            hit = next((n for n in names if rx.search(n)), None)
            if hit is None:
                continue
            if target is None:
                return None
            if target not in fields:
                raise KeyError(f"규칙 대상 필드 없음: {target}")
            if label == "원천별칭" and conf == "높음":
                conf = "중간"
            return {"key": target, "conf": conf, "note": note, "basis": label + " '" + hit + "' ~ /" + rx.pattern + "/"}
    return None


def apply(items, dict_path=None):
    d = load_dictionary(dict_path)
    n = 0
    for it in items:
        m = map_item(it, d["fields"])
        if m:
            it["argo"] = m
            n += 1
        else:
            it["argo"] = {}
    return d, n


if __name__ == "__main__":
    setup_console()
    import json
    from collections import Counter
    spec = json.load(open(os.path.join(ROOT, "spec", "kcure_spec.json"), encoding="utf-8"))
    d, n = apply(spec["items"])
    print("fields", len(d["fields"]), "mapped items", n, "/", len(spec["items"]))
    print(Counter(i["argo"]["key"].split(".")[0] for i in spec["items"] if i["argo"]))
    print(Counter(i["argo"]["conf"] for i in spec["items"] if i["argo"]))
    cov = Counter(i["argo"]["key"] for i in spec["items"] if i["argo"])
    core_req = [k for k, f in d["fields"].items() if f["tier"] in ("Core",) ]
    print("Core fields covered", sum(1 for k in core_req if cov[k]), "/", len(core_req))
    print("uncovered core:", [k for k in core_req if not cov[k]])
    import random
    random.seed(1)
    for it in random.sample([i for i in spec["items"] if i["argo"]], 40):
        print(f"  {it['name'][:28]:30s} -> {it['argo']['key']} [{it['argo']['conf']}]")
