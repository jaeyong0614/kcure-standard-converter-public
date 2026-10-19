# K-CURE 표준변환기 (프로토타입 v0.2.0-dev)

K-CURE 9개 암종의 **항목(컬럼)** 을 메타데이터로 변환하는 무설치 SW입니다. 대상 표준은 **KR CDI V3**, **KR Core V2(HL7 FHIR R4)**, **HL7 mCODE STU4**, **OMOP CDM v5.4**, **DCAT 2.0(국가 데이터 카탈로그, DCAT-AP 2.1 + NIA 확장)**, **ICGC ARGO Data Dictionary v1.34** 6종입니다.
환자 데이터를 FHIR·KR CDI로 바꾸는 기능은 부가 기능으로 남겨 두었습니다.

## 0. 주 기능: 암종별 컬럼 → 메타데이터

`① 암종·항목 선택 → ② 메타데이터 매핑 → ③ 메타데이터 내려받기`

- **① 선택:** 암종을 고르면 그 암종의 항목 전체가 선택됩니다(간암 242 … 유방암 333). 일부 컬럼만 쓰려면 컬럼 목록 파일을 불러옵니다. 원천 데이터 헤더, 세로 목록, 항목정의서 형식을 모두 받습니다.
- **② 매핑:** 컬럼마다 아래 내용을 한 줄에 보여 줍니다. OMOP·ARGO 대응은 화면에서 직접 고칠 수 있습니다.
  - KR CDI: 분류·항목·필수
  - KR Core: 프로파일·FHIR 경로·판정
  - mCODE: 프로파일·경로·데이터요소·참조수준
  - OMOP: 테이블.필드·개념 필드·어휘·ETL 주의
  - DCAT: xsd 자료형
  - ARGO: 스키마.필드·Tier·변환 주의
- **③ 내려받기:** 암종 패키지(zip) 또는 9개 암종 일괄 zip으로 받습니다. 패키지 구성은 다음과 같습니다.

| 표준 | 파일 |
|---|---|
| 통합 | `00_통합_메타데이터.xlsx` (12개 시트: 요약 · 컬럼별 통합(6개 표준) · KR CDI · KR Core · mCODE 매핑/프로파일/데이터요소 · OMOP ETL매핑/필드커버리지 · DCAT 변수 · ARGO 매핑/커버리지) |
| KR CDI V3 | 컬럼 대응표, 80항목 커버리지(R 미대응 표시), FHIR ConceptMap |
| KR Core V2 | **FHIR 논리모델**(StructureDefinition kind=logical, 컬럼=요소, `element.mapping`에 KR Core·KR CDI·mCODE·OMOP·ARGO), 프로파일·경로별 컬럼, ConceptMap |
| mCODE STU4 | 컬럼 매핑(프로파일 URL·데이터요소), **프로파일 38종(임상 36 + Bundle·Group 2)·데이터요소 417개 충족 현황**, ConceptMap |
| OMOP CDM v5.4 | **ETL 매핑 명세**(테이블·대상 필드·개념/일자/원천값 필드·권장 어휘·변환 주의), 사용 테이블의 필드 충족 현황, **source_to_concept_map 작성 템플릿**, ConceptMap |
| DCAT 2.0 | 암종 데이터셋 카탈로그 RDF/XML·Turtle·JSON-LD. 컬럼 정의는 `ndi:profile`에 넣고, `dct:conformsTo`는 KR CDI·KR Core·ARGO. 필수속성 검증 결과 포함 |
| ICGC ARGO v1.34 | 컬럼 매핑(후보), 245필드 커버리지(Core·Required 충족), ConceptMap, **제출 템플릿 TSV**와 채우기 안내 |

> **mCODE**는 항목정의서 v2.4의 대응(프로파일·경로·참조수준)을 그대로 씁니다. 여기에 PC에 있던 mCODE STU4 데이터 사전을 연결해 프로파일 URL과 데이터요소를 붙였습니다.
>
> **OMOP CDM 매핑은 새로 만든 것입니다.** OHDSI 공식 명세(`spec/sources/OMOP_CDMv5.4_*.csv`)를 기준으로 2단계 규칙(`tools/omop_map.py`)을 적용했습니다. 먼저 항목명 규칙을 적용하고, 남은 항목은 FHIR 리소스·자료형으로 대체 배정합니다. 그 결과 1,255개 항목 모두에 테이블·필드 후보가 있습니다(신뢰도 높음·중간·낮음). 종양 병기·조직 특성은 OMOP Oncology 관례(Cancer Modifier + `measurement_event_id`)를 따릅니다. 재발·치료요법은 `episode`를 씁니다. **개념 ID(concept_id)는 Athena 어휘로 따로 매핑해야 합니다.** 그 작업에 쓰도록 source_to_concept_map 템플릿을 넣었습니다.
>
> **ARGO 매핑은 새로 만든 것입니다.** 기존 항목정의서에는 ARGO 대응이 없었습니다. 그래서 항목명·원천 별칭에 대한 규칙(`tools/argo_map.py`, 약 140개)으로 **자동 후보**를 만들었습니다. 결과는 1,255개 중 467개 항목이고, 신뢰도를 높음·중간·낮음으로 표시합니다. 전문가 검토가 필요합니다.
> ARGO는 날짜 대신 진단일 기준 경과일(interval)을 쓰므로, 일자 컬럼에는 변환 주의가 붙습니다.

## 0-1. Level 2: 가명처리 코드 추천 (④ 탭, v0.2)

Hospital SW flow의 "원본 미수정 · 코드 추천" 원칙을 따릅니다. SW는 원본 데이터를 바꾸지 않고, 병원 담당자가 검토한 뒤 직접 실행할 **코드**를 만듭니다.

1. **입력:** 원천 샘플 파일(CSV·XLSX)을 불러옵니다. 컬럼명과 **앞 10행**만 분석하며, 샘플값은 화면에서만 쓰고 산출물에 넣지 않습니다. ① 선택 항목만으로도 추천할 수 있습니다(샘플 없이).
2. **추천:** 컬럼마다 표준항목 매핑, 샘플 패턴(날짜·주민번호·전화·자유문), 기법, 근거 규칙, 신뢰도를 보여 줍니다. 규칙은 `spec/deid_rules.json`에 있습니다.
   - 기법: 삭제, 마스킹, 솔트+SHA-256 가명키, 연도만, 날짜 이동, 경과일, 구간화, 상·하단 코딩, 희귀 범주 통합, 정규식 PII 치환, 유지
3. **승인:** 신뢰도 '높음'만 자동 승인됩니다. 나머지는 담당자가 확인하고 승인해야 코드에 들어갑니다(Human-in-the-loop). 기법과 파라미터는 직접 바꿀 수 있습니다.
4. **산출물(zip):**
   - `deid.py`: pandas. 입력은 UTF-8, 실패하면 CP949로 읽습니다. 결과는 새 파일에 쓰고, 솔트는 환경변수 `KCURE_SALT`에서 읽습니다.
   - `deid_<방언>.sql`: PostgreSQL·SQL Server·Oracle. 원천 테이블을 읽어 `deid` 스키마에 뷰를 만듭니다.
   - `regex_pii.py`(비정형 텍스트), `run.bat`, `requirements.txt`, `README_실행안내.md`, 요약 JSON, `감사이력.jsonl`
   - 생성할 때마다 자체 검사를 합니다. `UPDATE`·`DELETE FROM`·`DROP TABLE`·원본 덮어쓰기 같은 구문이 있으면 패키지를 만들지 않습니다.
   - 가명키는 변환기의 FHIR·KR CDI 가명키와 같은 방식(`sha256(솔트|값)` 앞 32자)입니다.
5. **비정형 PII 시험:** 경과기록 샘플을 붙여 넣으면 내장 정규식의 탐지 결과와 치환 결과를 미리 봅니다.

생성 코드 실행 검증(개발자용): `python tools/devserver.py`를 띄우고 `tests/test.html`을 열면 패키지가 `tests/_out/`에 저장됩니다. 그 뒤 `python tools/verify_generated.py`를 실행합니다. 이 도구는 다음을 확인합니다.
- 실행 성공, 원본 해시 불변
- 삭제·미승인 컬럼 제외
- 가명키가 변환기 방식과 같은지, 재현성
- PII 치환

## 1. 바로 쓰기 (무설치)

1. `dist/KCURE_표준변환기.html` **파일 1개**를 원하는 PC에 복사합니다.
2. 더블클릭하면 Edge나 Chrome에서 열립니다. 설치·관리자 권한·인터넷이 필요 없습니다.
3. `① 암종·항목 선택 → ② 메타데이터 매핑 → ③ 메타데이터 내려받기` 순서로 진행합니다.
   - 파일명 뒤에 `#selftest`를 붙여 열면 9개 암종 메타데이터 변환과 부가 기능(합성 샘플 데이터 변환)을 자동 점검합니다.
   - `#view=mmap&cancer=대장암`처럼 붙이면 해당 암종을 고른 상태로 그 화면이 열립니다.

> **개인정보:** 모든 처리는 이 PC의 브라우저 안에서만 수행합니다. CSP(`connect-src 'none'`)로 네트워크 전송을 원천 차단했습니다. 환자 식별자는 기본적으로 솔트+SHA-256으로 가명처리하고, 생년월일은 연도만 남깁니다.

지원 환경: Windows 10/11 기본 Edge(또는 Chrome) 103 이상. XLSX 읽기에는 브라우저 내장 압축해제 기능을 씁니다.

### 어떤 파일을 어디에 넣나

| 가진 파일 | 넣는 곳 |
|---|---|
| 암종 전체 항목을 변환 | ① 에서 암종 선택 |
| 특정 컬럼만 변환 (원천 데이터 헤더, 컬럼명 세로 목록, 항목정의서 일부 행) | ① 「컬럼 목록 파일 불러오기」 |
| 개정된 항목정의서 (`항목ID`·`표준항목명`·`KR_Core_FHIR_Path` 열) | 명세 조회 → 개정 항목정의서 불러오기 (변환 기준 교체) |
| 환자 데이터 (1행 = 환자 1명) | 부가: 환자 데이터 변환 → 불러오기 |

## 2. 기능

| 탭 | 내용 |
|---|---|
| ① 암종·항목 선택 | 9개 암종 중 하나를 고르거나 컬럼 목록 파일을 불러옵니다. 항목별로 포함·제외를 정합니다. |
| ② 메타데이터 매핑 | 컬럼별 KR CDI·KR Core·DCAT·ARGO 대응과 요약(KR CDI 80항목 대응 수, KR Core 직접·제약·확장, ARGO Core·Required 충족)을 보여 줍니다. ARGO는 수정할 수 있습니다. |
| ③ 메타데이터 내려받기 | 암종 패키지(zip), 통합 엑셀, 9개 암종 일괄 zip. 파일별 미리보기와 DCAT 필수속성 검증 결과를 함께 보여 줍니다. |
| 명세 조회 | 1,255 항목 검색과 상세 조회. **개정 항목정의서(xlsx)를 불러오면 명세가 즉시 교체됩니다.** |
| 카탈로그·변환 설정 | 제공기관, 담당자, 라이선스, 엔드포인트, NDI TOKEN 등 |
| 부가: 환자 데이터 변환 | 환자 단위 원천 데이터를 FHIR Bundle·KR CDI 교류데이터·DCAT으로 바꿉니다(가명처리·값 검증 포함). 아래 산출물 표 참고 |

### 산출물 (데이터 변환)

| 표준 | 파일 |
|---|---|
| KR Core V2 · FHIR R4 | `_FHIR_Bundle.json` (transaction/collection), `_FHIR.ndjson` |
| KR CDI V3 | `_KRCDI.json` (환자별 14분류 구조), `_KRCDI.csv` (long), `_KRCDI_커버리지.csv` (80항목 커버리지·R 누락) |
| DCAT 2.0 | `_DCAT.rdf` (RDF/XML, One-윈도우 연계 기본), `_DCAT.ttl`, `_DCAT.jsonld` |
| 검증·재사용 | `_변환로그.csv`, `_매핑설정.json` |

## 3. 변환 규칙 요약

자세한 내용은 [docs/01_개발계획서.md](docs/01_개발계획서.md)에 있습니다.

- **FHIR:** 항목별 `KR_Core_FHIR_Path`에 따라 리소스를 생성합니다. 리소스는 (리소스유형, 대분류, 중분류) 단위로 묶습니다.
  - Observation은 값 항목 1개당 1개입니다. 같은 그룹의 일자·방법·부위·단위 항목은 값 리소스에 공통으로 적용합니다.
  - `meta.profile`에는 KR Core canonical(`http://www.hl7korea.or.kr/fhir/krcore/StructureDefinition/krcore-*`)을 넣습니다. KR Core에 정의가 없으면 KR-mCODE 후보 프로파일(PRF-001~041)을 넣습니다.
  - 모든 리소스에 `meta.tag`=규칙승인(후보)를 붙이고, `source-item` 확장(K-CURE 항목ID)으로 원천을 추적합니다.
  - 자료형이 경로와 맞지 않으면 버리지 않고 `item-{항목ID}` 확장으로 보존한 뒤 로그에 남깁니다.
- **KR CDI:** KR CDI가 배정된 186개 항목만 대상입니다. 직접대응/부분대응을 구분하고, 사용 중인 분류에서 R(필수) 항목이 빠졌는지 보고합니다.
- **DCAT:** NIA 가이드 [표 5]의 필수 속성(Catalog·Dataset·Distribution·DataService·CatalogRecord + `ndi:viewCnt/downloadCnt/srvcType/pltfrmAccessToken`)을 자동 검증합니다.
  - 항목 정의와 컬럼 통계는 `ndi:profile`(JSON)에 넣습니다. 배포 파일에는 SHA-256 체크섬(`spdx:checksum`)을 붙입니다.
  - 환자 단위 샘플(`ndi:sample`)은 넣지 않습니다.

## 4. 항목정의서(v2.4)에서 발견된 매핑 검토 대상 — 168개 항목(171건)

변환기를 만들면서, 그대로 변환하면 데이터가 왜곡되는 배정을 찾았습니다. 한 항목에 문제가 두 가지 겹치는 경우가 3개 있어 건수(171)가 항목 수(168)보다 많습니다. 변환기는 이 항목들을 자동보정하거나 별도로 처리하고 로그에 남깁니다.
다음 개정 때 검토해야 할 목록은 [docs/02_매핑검토대상.csv](docs/02_매핑검토대상.csv)에 있습니다(`python tools/audit_spec.py`로 재생성).

| 코드 | 문제 | 건수 | 예 |
|---|---|---|---|
| B1 | 여부 항목이 `status`/`verificationStatus`에 배정 | 74 | `Robotic 여부`=N → 수술 자체가 "not-done"이 됨 |
| D1 | 수치 항목이 `valueCodeableConcept`에 배정 | 51 | 음주량·흡연량 |
| A1 | 날짜 항목이 비날짜 경로에 배정 | 18 | `MMG 검사일자` → `DiagnosticReport.code`, `사망일자` → `Patient.identifier` |
| A2 | 나이·기간·시각이 날짜 경로에 배정 | 18 | `나이` → `Patient.birthDate`, `hospital_stay` → `Encounter.period.end` |
| C1 | 식별자가 아닌 항목이 `Patient.identifier`에 배정 | 5 | `survival_status`, `mortality_op`, `사망여부` |
| B2 | 자유문이 `status` 코드에 배정 | 4 | `퇴원시 상태` → `Encounter.status` |
| E1 | FHIR R4에 없는 경로 | 1 | `AdverseEvent.description` |

## 5. 폴더 구조

```
KCURE_표준변환기_프로토타입/
├─ dist/KCURE_표준변환기.html   ← 배포본(단일 파일, 약 2.5MB — 내장 명세 2.2MB 포함)
├─ src/                        ← 소스 (index.html, css/, js/)
│   └─ js/ util · sha256 · readers(CSV/XLSX) · spec · values · mapper · fhir · krcdi · pipeline · dcat · artifacts · app
├─ spec/kcure_spec.json(.js)   ← 내장 명세 (v2.4 + V1.2에서 추출)
├─ samples/                    ← 합성(가상) 샘플: 대장암 CSV, 유방암 XLSX·CP949 CSV
├─ spec/sources/               ← 명세 원본 고정 사본(항목정의서 v2.4·V1.2, ARGO·mCODE 사전, OMOP 명세) + manifest.json(SHA-256)
├─ tests/test.html, tests.js   ← 브라우저 자동 테스트 125개
├─ tools/                      ← build_spec.py · argo_map.py(ARGO 규칙) · omop_map.py(OMOP 규칙) · mcode_dict.py(mCODE 사전) · make_samples.py · build.py · audit_spec.py · sync_sources.py(원본 고정) · common.py
└─ docs/                       ← 개발계획서, 매핑검토대상, 03 수정개발계획서(v0.2), 04 맞춤형 프롬프트
```

## 6. 개발자용

### 6.1 Windows 개발 환경 (권장)

```bat
py -3.11 -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe toolsuild.py --all
```

- PowerShell 실행 정책 때문에 `venv\Scripts\Activate.ps1`이 막히면, 위처럼 `venv\Scripts\python.exe`를 직접 호출하면 됩니다.
- Microsoft Store판 `python`에서 `python -I`로 실행하면 사용자 site-packages(openpyxl)를 찾지 못합니다. venv를 쓰세요.
- 도구 스크립트는 시작할 때 콘솔 출력을 UTF-8로 바꿉니다(`tools/common.py`). 그래서 cp949 콘솔에서도 한글·기호 출력 오류가 나지 않습니다.
- 경로에 한글과 공백이 있습니다(`OneDrive\바탕 화면\…`). 명령에서는 항상 따옴표로 감싸세요.
- 그 밖의 Windows 유의사항은 [docs/03_수정개발계획서.md §5](docs/03_수정개발계획서.md)를 보세요.

### 6.2 빌드

```bash
python tools/build.py --all
```
(명세 추출 → 샘플 생성 → 단일 HTML 빌드. openpyxl 필요)

명세 원본은 `spec/sources/`의 고정 사본을 씁니다. 원본(상위 폴더의 항목정의서 등)이 개정되면 다음 명령을 실행합니다.
```bash
python tools/sync_sources.py --update   # 최신본 복사 + manifest.json(SHA-256) 갱신
python tools/sync_sources.py --check    # 해시만 점검
```
`build_spec.py --final/--aux/--argo/--mcode <파일>`로 원본을 직접 지정할 수도 있습니다.

### 6.3 테스트

```bash
python -m http.server 8765
```
그 다음 브라우저에서 `http://localhost:8765/tests/test.html`을 열면 테스트가 실행됩니다.

- 항목정의서가 개정되면 `tools/build_spec.py --final <새 파일>`로 명세를 다시 만들고 빌드합니다. 사용자는 앱의 "명세 조회 → 개정 항목정의서 불러오기"로 즉시 교체할 수도 있습니다.
- 외부 라이브러리 없이 동작합니다. ES 모듈 대신 클래식 스크립트를 쓰는데, file:// 환경에서도 실행되게 하기 위해서입니다.

## 7. 한계

- 매핑은 **규칙승인(후보)** 단계를 따르며, 항목별 전문가 의미검증(L3)은 0건입니다. 따라서 산출물도 후보 등급입니다.
- FHIR 검증은 내장 구조검증(R4 필수요소·날짜형식·참조 무결성)까지만 합니다. KR Core 프로파일 적합성은 HL7 FHIR Validator와 KR Core 패키지로 별도 검증해야 합니다.
- 코드표가 없는 항목(138건)과 단위가 정해지지 않은 항목(95건)은 원문 텍스트를 보존하는 방식(`CodeableConcept.text`, `valueString`)으로 처리합니다.
- 입력은 1행 1환자(wide) 형식을 기준으로 합니다. 같은 환자의 여러 행은 행별로 리소스를 만들고, Patient만 하나로 합칩니다.
- mCODE 데이터 사전(`spec/sources/mCODEDataDictionary-STU4.xlsx`)의 IG 버전 표기는 `4.0.0-ballot`입니다. 정식 STU4(4.0.0, 2025-02-16) 사전과 프로파일·데이터요소가 같은지 확인해야 합니다.
- 대용량은 아직 검증하지 않았습니다(수천 행 수준을 상정). 수만 행 이상이면 NDJSON 분할 출력 등을 추가해야 합니다.

## 8. 확인 필요 사항

| # | 항목 | 현재 값(임시) |
|---|---|---|
| 1 | 실제 K-CURE 원천 데이터의 형식 (wide/long, 컬럼명 체계, 1파일 1암종 여부) | 9개암종 항목정의서 ASIS 항목명 기준 |
| 2 | 중개포털 도메인과 FHIR 서버 엔드포인트 | `https://kcure-portal.example.kr/` |
| 3 | 제공기관 사업자등록번호, 담당자, 라이선스·접근권한 문구 | 설정 탭 [확인 필요] |
| 4 | NDI(One-윈도우) 연계기관 TOKEN, `ndi:` 네임스페이스 URI (가이드에 URI가 정의되어 있지 않음) | `https://ndi.nia.or.kr/ns#` |
| 5 | K-CURE/KR-mCODE canonical URL 체계 | `http://khis.kr/fhir/kcure/` |
| 6 | 가명처리 기준 (솔트 관리 주체, 생년월일·일자 처리 수준, 가명정보 처리 가이드라인 적용 범위) | 솔트+SHA-256, 생년 연도만 |
| 7 | KR Core 병리·영상 DiagnosticReport 프로파일 ID (원문에서 확인하지 못함) | `krcore-diagnosticreport-pathology-results` 등(추정) |
| 8 | 산출 FHIR를 적재할 대상 (FHIR 서버 / 파일 교환) | transaction Bundle 기본 |
