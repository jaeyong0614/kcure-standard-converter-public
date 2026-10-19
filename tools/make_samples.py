"""합성(가상) 샘플 데이터 생성기 — 실제 환자 데이터가 아님.

대장암: 원천 영문 컬럼명(별칭 매칭 시험), UTF-8 BOM CSV
유방암: 한글 표준명 컬럼, XLSX + CP949 CSV (인코딩·XLSX 파서 시험)
일부 값은 검증 기능 시연을 위해 의도적으로 잘못 넣었다(예: 13월, 미정의 코드).
"""
import csv
import io
import json
import os
import random

from openpyxl import Workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "samples")
random.seed(20261006)


def d(y0=2015, y1=2024):
    return f"{random.randint(y0, y1)}{random.randint(1, 12):02d}{random.randint(1, 28):02d}"


def yn(p=0.3):
    r = random.random()
    return "Y" if r < p else ("U" if r > 0.95 else "N")


def crc_rows(n=15):
    rows = []
    for i in range(1, n + 1):
        op = d(2018, 2023)
        dead = random.random() < 0.2
        rows.append({
            "no_hospital": "11100338",
            "no_patient": f"CRC{i:05d}",
            "sex": random.choice(["M", "F"]),
            "dt_birth": d(1940, 1975),
            "dt_admission": op[:6] + "01",
            "dt_discharge": op[:6] + "12",
            "height": f"{random.uniform(150, 185):.1f}",
            "weight": f"{random.uniform(45, 90):.1f}",
            "dt_pre_measure": op,
            "drinking_yn": yn(0.4),
            "smoking_yn": yn(0.3),
            "fami_hx_yn": yn(0.2),
            "past_dx_ca": yn(0.1),
            "current_HTN": yn(0.35),
            "current_DM": yn(0.2),
            "pre_CEA": f"{random.uniform(0.5, 30):.1f}",
            "ASA": random.choice(["1", "2", "2", "3"]),
            "dt_op": op,
            "op_name": random.choice(["Low anterior resection", "Right hemicolectomy", "Anterior resection"]),
            "op_method": random.choice(["Laparoscopic", "Open", "Robotic"]),
            "op_time": str(random.randint(120, 360)),
            "pT": random.choice(["T1", "T2", "T3", "T3", "T4a"]),
            "pN": random.choice(["N0", "N0", "N1a", "N2b"]),
            "pM": random.choice(["M0", "M0", "M0", "M1a"]),
            "histologic_type": random.choice(["Adenocarcinoma", "Mucinous adenocarcinoma"]),
            "LVI": random.choice(["Present", "Absent", "Absent"]),
            "MSI_pcr": random.choice(["MSS", "MSS", "MSI-H"]),
            "K-ras": random.choice(["Wild", "Mutant"]),
            "tumor_location_patho": random.choice(["Sigmoid colon", "Rectum", "Ascending colon"]),
            "postCTX_yn": yn(0.6),
            "postCTX_type": random.choice(["FOLFOX", "CAPOX", "Capecitabine", ""]),
            "dt_posCTX_start": d(2018, 2023),
            "grade_neuropathy": random.choice(["G1", "G2", "", ""]),
            "reop_yn": yn(0.05),
            "recur_yn": yn(0.2),
            "dt_recur_detection": d(2020, 2024) if random.random() < 0.2 else "",
            "dt_last_follow_up": d(2024, 2025),
            "survival_status": "Dead" if dead else "Alive",
            "dt_death": d(2022, 2025) if dead else "",
            "memo_internal": "내부메모",
        })
    rows[2]["dt_op"] = "20211340"          # 잘못된 날짜(13월)
    rows[4]["sex"] = "X"                   # 허용값 외 코드
    rows[6]["height"] = "약 170"           # 수치형 아님
    return rows


def breast_rows(n=15):
    rows = []
    for i in range(1, n + 1):
        op = d(2018, 2023)
        rows.append({
            "병원번호": f"H{700000 + i * 37}",
            "환자등록번호": f"BRC{i:05d}",
            "성별": "F",
            "나이": str(random.randint(32, 78)),
            "초진연월일": op[:6] + "02",
            "신장측정값": f"{random.uniform(148, 172):.1f}",
            "체중측정값": f"{random.uniform(42, 80):.1f}",
            "BMI값": f"{random.uniform(18, 31):.1f}",
            "기록일자": op[:6] + "02",
            "흡연력여부": yn(0.1),
            "음주량": f"{random.uniform(0, 3):.1f}",
            "폐경 유무": random.choice(["Y", "N"]),
            "초경 나이": str(random.randint(11, 16)),
            "가족력_암여부": yn(0.25),
            "가족력_암종": random.choice(["5", "1", "", ""]),
            "과거력 고혈압여부": yn(0.3),
            "과거력 당뇨여부": yn(0.15),
            "진단명": "C50.9",
            "진단경로": random.choice(["0", "1", "2"]),
            "등록일자": op[:6] + "05",
            "편측성": random.choice(["L", "R"]),
            "수술일자": op,
            "수술명": random.choice(["Breast conserving surgery", "Total mastectomy"]),
            "외과병리 채취일자": op,
            "외과병리 판독일자": op[:6] + "20",
            "외과병리 ER 양성여부": random.choice(["Y", "N", "Y"]),
            "외과병리 PR 양성여부": random.choice(["Y", "N"]),
            "외과병리 유방종양크기값": f"{random.uniform(0.5, 5):.1f}",
            "Total LN": str(random.randint(1, 20)),
            "Positive LN": str(random.randint(0, 3)),
            "MMG BI-RADS category": random.choice(["4A", "4B", "5"]),
            "MMG 검사일자": op[:6] + "03",
            "항암제 성분명": random.choice(["Doxorubicin", "Paclitaxel", ""]),
            "처방일자": d(2018, 2023),
            "호르몬제 투여 여부": yn(0.6),
            "방사선 횟수": random.choice(["25", "16", ""]),
            "퇴원일": op[:6] + "09",
            "재발부위명": random.choice(["", "", "간", "폐", "뼈"]),
            "국소재발일": "",
            "사망일자": "",
        })
    rows[1]["진단경로"] = "7"              # 허용값 외 코드
    rows[3]["수술일자"] = "2020-02-30"     # 존재하지 않는 날짜
    return rows


def write_csv(path, rows, encoding):
    with open(path, "w", newline="", encoding=encoding) as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def write_xlsx(path, rows):
    wb = Workbook()
    ws = wb.active
    ws.title = "유방암_합성데이터"
    keys = list(rows[0].keys())
    ws.append(keys)
    for r in rows:
        ws.append([int(r[k]) if k in ("나이", "Total LN", "Positive LN") and r[k] else r[k] for k in keys])
    wb.save(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    crc, brc = crc_rows(), breast_rows()
    write_csv(os.path.join(OUT, "합성샘플_대장암_원천영문컬럼.csv"), crc, "utf-8-sig")
    write_xlsx(os.path.join(OUT, "합성샘플_유방암_한글컬럼.xlsx"), brc)
    write_csv(os.path.join(OUT, "합성샘플_유방암_한글컬럼_CP949.csv"), brc, "cp949")
    # 앱 내장용(무설치 단일 HTML에서 '샘플로 시험' 버튼) — UTF-8 CSV 텍스트
    embed = {}
    for key, rows, name in (("crc", crc, "합성샘플_대장암_원천영문컬럼.csv"), ("brc", brc, "합성샘플_유방암_한글컬럼.csv")):
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
        embed[key] = {"name": name, "csv": buf.getvalue()}
    with open(os.path.join(ROOT, "spec", "samples.js"), "w", encoding="utf-8") as f:
        f.write("window.KCURE_SAMPLES=" + json.dumps(embed, ensure_ascii=False) + ";\n")
    print("samples written:", os.listdir(OUT))


if __name__ == "__main__":
    main()
