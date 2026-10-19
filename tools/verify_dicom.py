"""생성된 DICOM 비식별화 스크립트(deid_dicom.py) 실행 검증 — pydicom 필요.

합성 DICOM(같은 환자·같은 검사 2장, private 태그, 시퀀스 안 UID, DICOM 아닌 파일)을 만들어 스크립트를 실행하고 확인한다.
  1) 입력 폴더 불변(파일 해시)  2) PatientName·PatientID = 가명키(sha256(솔트|PatientID) 앞 32자)
  3) UID 재생성·같은 원본 UID는 같은 새 UID  4) 같은 환자의 날짜는 같은 일수만큼 이동
  5) private 태그·기관명 삭제, PatientIdentityRemoved=YES  6) DICOM 아닌 파일은 건너뜀
  7) 출력 폴더가 입력 폴더 안이면 중단

사용법: python tools/verify_dicom.py [deid_dicom.py 경로, 기본 tests/_out/deid_dicom.py]
"""
import hashlib
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from common import ROOT, setup_console


def make_dataset(path, sop_uid, study_uid):
    import pydicom
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    meta.MediaStorageSOPInstanceUID = sop_uid
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = Dataset()
    ds.file_meta = meta
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = sop_uid
    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = study_uid + ".1"
    ds.PatientName = "홍^길동"
    ds.PatientID = "CRC00001"
    ds.PatientBirthDate = "19720426"
    ds.PatientSex = "F"
    ds.StudyDate = "20240305"
    ds.SeriesDate = "20240305"
    ds.InstitutionName = "가나다대학교병원"
    ds.ReferringPhysicianName = "Kim^Doctor"
    ds.Modality = "CT"
    ds.AccessionNumber = "A123456"
    ref = Dataset()
    ref.ReferencedSOPInstanceUID = study_uid + ".9"
    ds.ReferencedImageSequence = [ref]
    ds.add_new(0x00091010, "LO", "PRIVATE-SECRET")
    ds.SpecificCharacterSet = "ISO_IR 192"
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.save_as(path, enforce_file_format=True) if "enforce_file_format" in ds.save_as.__code__.co_varnames else ds.save_as(path, write_like_original=False)


def sha_file(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    setup_console()
    import pydicom
    script = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tests" / "_out" / "deid_dicom.py"
    salt = "verify-salt-0001"
    fails = []
    with tempfile.TemporaryDirectory(prefix="kcure_dcm_") as t:
        t = Path(t)
        din, dout = t / "in", t / "out"
        study = "1.2.410.200001.1.1"
        make_dataset(din / "pt1" / "img1.dcm", study + ".1.1", study)
        make_dataset(din / "pt1" / "img2.dcm", study + ".1.2", study)
        (din / "readme.txt").write_text("not dicom", encoding="utf-8")
        before = {p: sha_file(p) for p in din.rglob("*") if p.is_file()}
        code = script.read_text(encoding="utf-8")
        code = re.sub(r"^INPUT_DIR = Path\(.*\)$", lambda m: "INPUT_DIR = Path(" + repr(str(din)) + ")", code, count=1, flags=re.M)
        code = re.sub(r"^OUTPUT_DIR = Path\(.*\)$", lambda m: "OUTPUT_DIR = Path(" + repr(str(dout)) + ")", code, count=1, flags=re.M)
        run = t / "run.py"
        run.write_text(code, encoding="utf-8")
        env = dict(os.environ, KCURE_SALT=salt, PYTHONIOENCODING="utf-8")
        r = subprocess.run([sys.executable, str(run)], capture_output=True, text=True, encoding="utf-8", env=env)
        print(" ", r.stdout.strip())
        if r.returncode != 0:
            fails.append("실행 실패: " + r.stderr[-800:])
        else:
            if {p: sha_file(p) for p in din.rglob("*") if p.is_file()} != before:
                fails.append("입력 폴더가 바뀌었습니다")
            outs = [pydicom.dcmread(dout / "pt1" / n) for n in ("img1.dcm", "img2.dcm")]
            h = hashlib.sha256((salt + "|CRC00001").encode("utf-8")).hexdigest()
            off = int(h[:8], 16) % 61 - 30
            for ds in outs:
                if str(ds.PatientID) != h[:32] or str(ds.PatientName) != h[:32]:
                    fails.append("PatientID/Name 가명키 불일치")
                if str(ds.StudyInstanceUID).startswith(study) or not str(ds.StudyInstanceUID).startswith("2.25."):
                    fails.append("StudyInstanceUID 미변경")
                if ds.file_meta.MediaStorageSOPInstanceUID != ds.SOPInstanceUID:
                    fails.append("file_meta SOPInstanceUID 불일치")
                if str(ds.ReferencedImageSequence[0].ReferencedSOPInstanceUID).startswith(study):
                    fails.append("시퀀스 안 UID 미변경")
                want = (datetime(2024, 3, 5).toordinal() + off)
                if datetime.strptime(ds.StudyDate, "%Y%m%d").toordinal() != want:
                    fails.append(f"StudyDate 이동량 불일치 {ds.StudyDate}")
                if ds.PatientBirthDate != "19720101":
                    fails.append(f"생년월일 연도만 아님 {ds.PatientBirthDate}")
                if "InstitutionName" in ds or (0x0009, 0x1010) in ds:
                    fails.append("기관명 또는 private 태그 남음")
                if ds.get("PatientIdentityRemoved") != "YES":
                    fails.append("PatientIdentityRemoved 미설정")
            if outs[0].StudyInstanceUID != outs[1].StudyInstanceUID:
                fails.append("같은 검사의 StudyInstanceUID가 서로 다름")
            log = (dout / "_비식별화로그.csv").read_text(encoding="utf-8-sig")
            if "readme.txt,건너뜀" not in log:
                fails.append("DICOM 아닌 파일 건너뜀 기록 없음")
            print(f"  출력 {len(outs)}개 · StudyDate 20240305 → {outs[0].StudyDate} (이동 {off:+d}일) · UID {outs[0].StudyInstanceUID[:24]}…")
        # 출력이 입력 안이면 중단해야 한다
        code2 = re.sub(r"^OUTPUT_DIR = Path\(.*\)$", lambda m: "OUTPUT_DIR = Path(" + repr(str(din / "out")) + ")", code, count=1, flags=re.M)
        run.write_text(code2, encoding="utf-8")
        r2 = subprocess.run([sys.executable, str(run)], capture_output=True, text=True, encoding="utf-8", env=env)
        if r2.returncode == 0 or (din / "out").exists():
            fails.append("출력 폴더가 입력 폴더 안인데 중단하지 않음")
    if fails:
        print("[실패]")
        for f in fails:
            print(" -", f)
        sys.exit(1)
    print("DICOM 검증 통과")


if __name__ == "__main__":
    main()
