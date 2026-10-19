# 변경 이력

v0.2 수정개발은 [docs/03_수정개발계획서.md](docs/03_수정개발계획서.md)의 단계(S0~S6)를 따르며, 단계마다 git 커밋으로 남깁니다.

## v0.2.0-dev

### S2 Level 2 가명처리 코드 추천 (Hospital sw flow FR-01~03)
- 새 탭 **④ 가명처리 코드**를 추가했습니다. 원천 샘플(앞 10행)이나 ① 선택 항목을 넣으면 컬럼별로 기법·근거·신뢰도를 추천합니다.
  - 승인한 컬럼만 코드로 만듭니다.
  - 복합 컬럼 전개도 제안합니다(TNM·수용체·크기).
- `spec/deid_rules.json`: 추천 규칙 21개(DR-01~20, 99), 기법 11종, 비정형 PII 정규식 9종, 의학 예외어, 금지 구문 목록을 담았습니다.
- `src/js/deid.js`: 샘플 패턴 탐지, 규칙 추천, 비정형 PII 탐지·치환을 맡습니다.
- `src/js/codegen.js`가 다음을 생성합니다.
  - Python(pandas, UTF-8/CP949 입력, 새 파일 출력, 솔트 환경변수)
  - SQL 뷰 3개 방언
  - `regex_pii.py`, `run.bat`(chcp 65001·venv 직접 호출·오프라인 wheels), 실행 안내, 감사이력
- 원본 수정 구문 자체 검사(주석은 제외)를 추가했습니다.
- `tools/devserver.py`(127.0.0.1 전용, 테스트 산출물 저장), `tools/verify_generated.py`(생성 코드 실제 실행 검증)를 추가했습니다.
  - 대장암 UTF-8 CSV, 유방암 CP949 CSV·XLSX에서 통과했습니다.
  - 확인 항목: 원본 해시 불변, 삭제·미승인 제외, 가명키 = 변환기 방식, 재현성, PII 치환
- '부가: 환자 데이터 변환'은 합성·더미 데이터 검증용이라고 화면에 표시했습니다. 앱 버전 표기는 `v0.2.0-dev`입니다.
- 테스트 30개를 추가했습니다(169/169 통과).

### S1 매핑 품질 보강
- **KR CDI**: 80항목 중 17개에 수집범위(`직접식별자 제외` 6 · `기관 메타데이터` 5 · `전송 시 생성` 6)와 사유를 붙였습니다(`tools/build_spec.py` `KRCDI_SCOPE`).
  - 커버리지는 이제 "대응 36 · 수집범위외 17 · 실제 미대응 27"로 나누어 보고합니다.
  - 수집범위외 R 항목(예: 성명)은 적합성 점검에서 경고가 아니라 정보(`KRCDI_R_SCOPE`)로 남깁니다.
- **매핑 수정안**: `tools/audit_spec.py`가 검토 대상 171건(168항목)의 제안 경로를 `spec/corrections.json`에 `후보`로 기록합니다.
  - 담당자가 `status`를 `승인`으로 바꾼 건만 `build_spec.py`가 명세(`core.path`)에 반영합니다. 원래 경로는 `core.pathOrig`에 남습니다.
  - 기존 파일의 상태·승인자·메모는 다시 실행해도 보존됩니다. 현재 승인된 건은 0건이라 명세 경로는 바뀌지 않았습니다.
- **mCODE·KR Core**: 기반 리소스가 다른 167항목에 `mcode.resConflict`와 기본 표현(`mcode.primary`)을 붙였습니다.
  - 기본 표현은 KR Core 120건, mCODE 47건입니다. 규칙은 KR Core 우선이며, KR Core가 '확장필요'이고 mCODE가 '직접재사용'일 때만 mCODE를 권고합니다.
  - 통합 엑셀, mCODE 매핑표, mCODE ConceptMap 주석, 명세 상세에 표시합니다.
- **ARGO**: 직접 규칙 4개를 추가했습니다(주성분코드 → drug_id, 총 처방용량 → prescribed_cumulative_drug_dose, 치료 차수 → line_of_treatment, 방사선 처방 종류 → radiation_therapy_modality).
  - 대응 항목은 467 → 475개, Core 직접 충족은 45 → 48 / 79입니다.
  - 파생·지정값 규칙 17개(`argo.derived`)를 추가했습니다. 커버리지에는 '파생 가능', '제출 시 지정값'으로 **직접 대응과 따로** 셉니다.
- 화면 ①②의 요약, 통합 엑셀 요약·KR CDI·ARGO 커버리지 시트에 위 구분을 반영했습니다.
- 테스트 14개를 추가했습니다(139/139 통과).

### S0 기준선 정비
- 명세 원본 4종을 `spec/sources/`에 고정하고 `manifest.json`(SHA-256)을 두었습니다. `tools/sync_sources.py`로 갱신·점검합니다.
- `tools/common.py`: cp949 콘솔에서도 출력되도록 stdout을 UTF-8로 설정하고, 원본 경로를 해석합니다.
- `requirements.txt`를 추가하고, README에 venv·Windows 안내를 넣었습니다. README 수치를 정정했습니다.

## v0.1.0
- 프로토타입 기준선: 9개 암종 항목 → KR CDI·KR Core·mCODE·OMOP·DCAT·ARGO 메타데이터 변환, 부가 환자 데이터 변환(테스트 125개).
