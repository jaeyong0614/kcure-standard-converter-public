/* DICOM 헤더 비식별화 스크립트 생성 (Hospital sw flow FR-04)
 * DICOM PS3.15 Annex E Basic Application Level Confidentiality Profile 의 주요 태그 동작을 내장하고,
 * 옵션(날짜 이동·환자 특성 유지·private 태그 삭제)에 맞춘 pydicom 폴더 일괄 처리 스크립트를 만든다.
 * 브라우저는 DICOM 파일을 읽지 않는다. 스크립트는 입력 폴더를 바꾸지 않고 출력 폴더에 새 파일을 쓴다. */
window.KC = window.KC || {};

KC.dicomgen = (function () {
  'use strict';
  // 동작: X 삭제, Z 빈 값, D 가명값(환자 가명키), U UID 재생성, S 날짜 이동(옵션 off 이면 Z/X), K 유지
  // group: patientChar(환자 특성 유지 옵션), desc(설명 유지 옵션)
  const TAGS = [
    ['0008,0050', 'AccessionNumber', 'Z'], ['0008,0080', 'InstitutionName', 'X'], ['0008,0081', 'InstitutionAddress', 'X'],
    ['0008,0090', 'ReferringPhysicianName', 'Z'], ['0008,0092', 'ReferringPhysicianAddress', 'X'], ['0008,0094', 'ReferringPhysicianTelephoneNumbers', 'X'],
    ['0008,1010', 'StationName', 'X'], ['0008,1030', 'StudyDescription', 'X', 'desc'], ['0008,103E', 'SeriesDescription', 'X', 'desc'],
    ['0008,1040', 'InstitutionalDepartmentName', 'X'], ['0008,1048', 'PhysiciansOfRecord', 'X'], ['0008,1050', 'PerformingPhysicianName', 'X'],
    ['0008,1060', 'NameOfPhysiciansReadingStudy', 'X'], ['0008,1070', 'OperatorsName', 'X'], ['0008,1080', 'AdmittingDiagnosesDescription', 'X'],
    ['0008,0014', 'InstanceCreatorUID', 'U'], ['0008,0018', 'SOPInstanceUID', 'U'], ['0020,000D', 'StudyInstanceUID', 'U'],
    ['0020,000E', 'SeriesInstanceUID', 'U'], ['0020,0052', 'FrameOfReferenceUID', 'U'], ['0008,1155', 'ReferencedSOPInstanceUID', 'U'],
    ['0040,A124', 'UID', 'U'], ['0020,0200', 'SynchronizationFrameOfReferenceUID', 'U'],
    ['0010,0010', 'PatientName', 'D'], ['0010,0020', 'PatientID', 'D'], ['0010,0030', 'PatientBirthDate', 'Y'],
    ['0010,0032', 'PatientBirthTime', 'X'], ['0010,0040', 'PatientSex', 'Z', 'patientChar'], ['0010,1010', 'PatientAge', 'X', 'patientChar'],
    ['0010,1020', 'PatientSize', 'X', 'patientChar'], ['0010,1030', 'PatientWeight', 'X', 'patientChar'],
    ['0010,1000', 'OtherPatientIDs', 'X'], ['0010,1001', 'OtherPatientNames', 'X'], ['0010,1002', 'OtherPatientIDsSequence', 'X'],
    ['0010,1040', 'PatientAddress', 'X'], ['0010,1060', 'PatientMotherBirthName', 'X'], ['0010,2154', 'PatientTelephoneNumbers', 'X'],
    ['0010,2160', 'EthnicGroup', 'X'], ['0010,21B0', 'AdditionalPatientHistory', 'X'], ['0010,4000', 'PatientComments', 'X'],
    ['0020,0010', 'StudyID', 'Z'], ['0032,1032', 'RequestingPhysician', 'X'], ['0032,1060', 'RequestedProcedureDescription', 'X', 'desc'],
    ['0040,0275', 'RequestAttributesSequence', 'X'], ['0040,0253', 'PerformedProcedureStepID', 'X'], ['0040,0254', 'PerformedProcedureStepDescription', 'X', 'desc'],
    ['0018,1000', 'DeviceSerialNumber', 'X'], ['0018,1030', 'ProtocolName', 'X', 'desc'], ['0008,4000', 'IdentifyingComments', 'X'],
    ['0008,0020', 'StudyDate', 'S'], ['0008,0021', 'SeriesDate', 'S'], ['0008,0022', 'AcquisitionDate', 'S'], ['0008,0023', 'ContentDate', 'S'],
    ['0040,0244', 'PerformedProcedureStepStartDate', 'S'], ['0008,0030', 'StudyTime', 'Z'], ['0008,0031', 'SeriesTime', 'X'],
    ['0008,0032', 'AcquisitionTime', 'X'], ['0008,0033', 'ContentTime', 'X']
  ];
  const MODALITIES = { CT: 'CT', MR: 'MR', MG: '유방촬영(MG)', US: '초음파(US)', PT: 'PET(PT)', DX: '일반촬영(DX)', SM: '병리 WSI(SM)' };

  function actions(o) {
    return TAGS.map(function (t) {
      let a = t[2];
      if (t[3] === 'patientChar' && o.keepPatientChar) a = 'K';
      if (t[3] === 'desc' && o.keepDescriptions) a = 'K';
      if (a === 'S' && !o.shiftDates) a = t[1] === 'StudyDate' || t[1] === 'ContentDate' ? 'Z' : 'X';
      if (a === 'Y' && !o.birthYear) a = 'Z';
      return { tag: t[0], name: t[1], action: a };
    });
  }

  function py(o) {
    o = Object.assign({ input: 'C:\\dicom_in', output: 'C:\\dicom_out', shiftDates: true, range: 30, keepPatientChar: false, keepDescriptions: false,
      removePrivate: true, birthYear: true, modality: 'CT' }, o || {});
    const acts = actions(o);
    const pyPath = function (p) { p = String(p); return /["\\]$/.test(p) || p.indexOf('"') >= 0 ? JSON.stringify(p) : 'r"' + p + '"'; };
    const L = ['# -*- coding: utf-8 -*-',
      '# K-CURE DICOM 헤더 비식별화 스크립트 — K-CURE 표준변환기 ' + KC.APP_VERSION + ' 자동 생성',
      '# 기준: DICOM PS3.15 Annex E Basic Application Level Confidentiality Profile (주요 태그) · 대상 ' + (MODALITIES[o.modality] || o.modality),
      '# 옵션: 날짜 이동 ' + (o.shiftDates ? '±' + o.range + '일' : '안 함') + ' · 환자 특성(성별·나이·키·체중) ' + (o.keepPatientChar ? '유지' : '삭제') +
        ' · 설명 ' + (o.keepDescriptions ? '유지' : '삭제') + ' · private 태그 ' + (o.removePrivate ? '삭제' : '유지') + ' · 생년월일 ' + (o.birthYear ? '연도만(0101)' : '빈 값'),
      '# 입력 폴더는 읽기만 합니다. 결과는 출력 폴더에 같은 하위 구조로 새로 씁니다. 솔트는 환경변수 KCURE_SALT.',
      '# 주의: 픽셀에 새겨진 글자(burned-in annotation)는 지우지 못합니다. 해당 파일은 로그에 경고로 남깁니다.',
      'import csv', 'import hashlib', 'import os', 'import sys', 'from datetime import datetime, timedelta', 'from pathlib import Path', '',
      'import pydicom', 'from pydicom.errors import InvalidDicomError', '',
      'try:', '    sys.stdout.reconfigure(encoding="utf-8")', 'except (AttributeError, ValueError):', '    pass', '',
      'INPUT_DIR = Path(' + pyPath(o.input) + ')', 'OUTPUT_DIR = Path(' + pyPath(o.output) + ')',
      'SALT = os.environ.get("KCURE_SALT", "")', 'DATE_RANGE = ' + (+o.range || 30), 'REMOVE_PRIVATE = ' + (o.removePrivate ? 'True' : 'False'), '',
      '# (group, element) → 동작  X 삭제 · Z 빈 값 · D 환자 가명키 · U UID 재생성 · S 날짜 이동 · Y 연도만 · K 유지',
      'ACTIONS = {'];
    acts.forEach(function (a) { const g = a.tag.split(','); L.push('    (0x' + g[0] + ', 0x' + g[1] + '): ' + JSON.stringify(a.action) + ',  # ' + a.name); });
    L.push('}', '', '',
      'def sha(v):', '    return hashlib.sha256((SALT + "|" + str(v).strip()).encode("utf-8")).hexdigest()', '', '',
      'def new_uid(uid):', '    """원 UID → 2.25.<정수> (솔트 기반, 같은 UID는 항상 같은 새 UID)"""', '    return "2.25." + str(int(sha(uid)[:30], 16))', '', '',
      'def shift(value, offset):',
      '    try:',
      '        return (datetime.strptime(str(value)[:8], "%Y%m%d") + timedelta(days=offset)).strftime("%Y%m%d")',
      '    except ValueError:',
      '        return ""', '', '',
      'def deidentify(ds, offset, pseudo):',
      '    burned = str(ds.get("BurnedInAnnotation", "")).upper() == "YES"',
      '    if REMOVE_PRIVATE:',
      '        ds.remove_private_tags()',
      '',
      '    def visit(d):',
      '        for elem in list(d):',
      '            if elem.VR == "SQ":',
      '                act = ACTIONS.get((elem.tag.group, elem.tag.element))',
      '                if act == "X":',
      '                    del d[elem.tag]',
      '                    continue',
      '                for item in elem.value:',
      '                    visit(item)',
      '                continue',
      '            act = ACTIONS.get((elem.tag.group, elem.tag.element))',
      '            if act is None or act == "K":',
      '                continue',
      '            if act == "X":',
      '                del d[elem.tag]',
      '            elif act == "Z":',
      '                elem.value = ""',
      '            elif act == "D":',
      '                elem.value = pseudo',
      '            elif act == "U" and elem.value:',
      '                elem.value = new_uid(elem.value)',
      '            elif act == "S":',
      '                elem.value = shift(elem.value, offset) if elem.value else ""',
      '            elif act == "Y":',
      '                elem.value = (str(elem.value)[:4] + "0101") if elem.value else ""',
      '',
      '    visit(ds)',
      '    if "SOPInstanceUID" in ds and hasattr(ds, "file_meta"):',
      '        ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID',
      '    ds.PatientIdentityRemoved = "YES"',
      '    ds.DeidentificationMethod = "K-CURE PS3.15 Basic Profile (subset)' + (o.shiftDates ? ', date shift' : '') + '"',
      '    return burned', '', '',
      'def main():',
      '    if not SALT:',
      '        raise SystemExit("환경변수 KCURE_SALT 를 설정하세요 (예: set KCURE_SALT=기관비밀값)")',
      '    if not INPUT_DIR.is_dir():',
      '        raise FileNotFoundError(f"입력 폴더가 없습니다: {INPUT_DIR}")',
      '    out_root = OUTPUT_DIR.resolve()',
      '    in_root = INPUT_DIR.resolve()',
      '    if out_root == in_root or in_root in out_root.parents:',
      '        raise SystemExit("출력 폴더가 입력 폴더와 같거나 그 안에 있습니다 — 원본 보호를 위해 중단")',
      '    log = []',
      '    for src in sorted(p for p in INPUT_DIR.rglob("*") if p.is_file()):',
      '        rel = src.relative_to(INPUT_DIR)',
      '        try:',
      '            ds = pydicom.dcmread(src)',
      '        except InvalidDicomError:',
      '            log.append([str(rel), "건너뜀", "DICOM 아님"])',
      '            continue',
      '        except (OSError, ValueError) as e:',
      '            log.append([str(rel), "오류", str(e)[:200]])',
      '            continue',
      '        pid = str(ds.get("PatientID", ""))',
      '        h = sha(pid)',
      '        offset = int(h[:8], 16) % (2 * DATE_RANGE + 1) - DATE_RANGE',
      '        burned = deidentify(ds, offset, h[:32])',
      '        dst = OUTPUT_DIR / rel',
      '        dst.parent.mkdir(parents=True, exist_ok=True)',
      '        ds.save_as(dst)',
      '        log.append([str(rel), "완료", "픽셀 문자 확인 필요(BurnedInAnnotation=YES)" if burned else ""])',
      '    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)',
      '    with open(OUTPUT_DIR / "_비식별화로그.csv", "w", newline="", encoding="utf-8-sig") as f:',
      '        csv.writer(f).writerows([["파일", "결과", "비고"]] + log)',
      '    done = sum(1 for r in log if r[1] == "완료")',
      '    print(f"완료 {done}개 · 건너뜀 {sum(1 for r in log if r[1] == \'건너뜀\')}개 · 오류 {sum(1 for r in log if r[1] == \'오류\')}개 → {OUTPUT_DIR}")',
      '', '',
      'if __name__ == "__main__":', '    main()', '');
    return L.join('\n');
  }

  return { TAGS: TAGS, MODALITIES: MODALITIES, actions: actions, python: py };
})();
