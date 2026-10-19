"""로컬 LLM(Ollama)으로 범용(비 K-CURE) 테스트 더미 데이터를 만든다.

Google Drive '항목정의 및 의료기관 배포 sw' 폴더의
「GPT/로컬 LLM 활용 테스트용 더미 데이터셋(Dummy Data) 생성 프롬프트」를 그대로(A) 또는 같은 형식으로 변형해(B·C) 쓴다.
B·C 는 컬럼명을 지정하지 않고 LLM 이 실제 EMR 추출본처럼 짓게 해서, 범용 사전이 처음 보는 컬럼명에 얼마나 대응하는지 시험한다.
모든 값은 가상(합성) 데이터다.

사용법: python tools/gen_dummy_llm.py [A B C ...] [--model qwen2.5:7b-instruct]
출력: samples/generic/<세트>_정형.csv, <세트>_경과기록.txt(있으면), <세트>_raw.txt(모델 원문), _생성기록.json
"""
import argparse
import csv
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "samples" / "generic"

# A: Drive 프롬프트 원문 (형식 그대로)
PROMPT_A = """GPT/로컬 LLM 활용 테스트용 더미 데이터셋(Dummy Data) 생성 프롬프트
```text
[System Context]
당신은 의료 데이터 연구용 가상 합성 데이터(Synthetic Data) 생성기입니다.

[Task]
프로토타입 검증을 위해 실제 환자 정보가 포함되지 않은 가상의 의료 데이터셋을 생성하세요.
1. 정형 데이터: PAT_ID, AGE, GENDER, DIAG_CODE, ADMIT_DATE 포함 50건의 CSV 텍스트
2. 비정형 데이터: 가상의 한글 경과기록(Clinical Notes) 샘플 3건

[Output Format]
1. CSV Data Format (UTF-8 encoded string)
2. Clinical Notes Text Samples
```"""

# B·C: 같은 형식, 다른 업무 영역. 컬럼명은 모델이 정한다.
PROMPT_B = """[System Context]
당신은 의료 데이터 연구용 가상 합성 데이터(Synthetic Data) 생성기입니다.

[Task]
프로토타입 검증을 위해 실제 환자 정보가 포함되지 않은 가상의 의료 데이터셋을 생성하세요.
1. 정형 데이터: 내과 외래 혈액검사 결과 30건의 CSV 텍스트. 한 행은 검사 1건(같은 환자가 여러 행에 나올 수 있음).
   환자 식별번호, 환자 이름, 검사 일시, 검사 코드, 검사명, 결과값, 단위, 참고치, 판정(H/L/N) 컬럼을 포함하고,
   컬럼명은 실제 병원 EMR 추출본처럼 영문 약어로 자유롭게 정하세요.

[Output Format]
1. CSV Data Format (UTF-8 encoded string)"""

PROMPT_C = """[System Context]
당신은 의료 데이터 연구용 가상 합성 데이터(Synthetic Data) 생성기입니다.

[Task]
프로토타입 검증을 위해 실제 환자 정보가 포함되지 않은 가상의 의료 데이터셋을 생성하세요.
1. 정형 데이터: 만성질환(고혈압·당뇨) 외래 처방 30건의 CSV 텍스트. 한 행은 처방 약 1건.
   등록번호, 성명, 생년월일, 성별, 연락처, 처방일, 진단코드, 약품코드, 약품명, 1회 투여량, 단위, 투여 경로, 1일 횟수, 처방일수, 처방의 이름 컬럼을 포함하고,
   컬럼명은 실제 병원 EMR 추출본처럼 한글로 자유롭게 정하세요.
2. 비정형 데이터: 가상의 한글 외래 진료기록 샘플 2건

[Output Format]
1. CSV Data Format (UTF-8 encoded string)
2. Clinical Notes Text Samples"""

SETS = {"A": ("Drive 원문 · 입원 진단", PROMPT_A, 50), "B": ("변형 · 외래 혈액검사(영문 약어)", PROMPT_B, 30),
        "C": ("변형 · 만성질환 처방(한글)", PROMPT_C, 30)}


def ask(model, prompt):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False, "keep_alive": "10m",
                       "options": {"temperature": 0.7, "num_ctx": 8192, "num_predict": 6000, "seed": 20261019}}).encode("utf-8")
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", data=body, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=1800) as r:
        res = json.load(r)
    return res["message"]["content"], round(time.time() - t0, 1), res.get("eval_count")


def split_output(text):
    """모델 원문 → (CSV 행 목록, 경과기록 문자열)."""
    blocks = re.findall(r"```(\w*)\n(.*?)```", text, flags=re.S)
    csv_text = next((b for lang, b in blocks if lang.lower() == "csv"), None)
    if csv_text is None:  # 코드펜스가 없으면 쉼표가 많은 연속 줄을 CSV 로 본다
        lines = [ln for ln in text.splitlines() if ln.count(",") >= 3]
        csv_text = "\n".join(lines)
    rows = [r for r in csv.reader(io.StringIO(csv_text.strip())) if any(c.strip() for c in r)]
    notes = [b.strip() for lang, b in blocks if lang.lower() in ("text", "", "plaintext") and b.count(",") < 20]
    if not notes:  # 코드펜스 밖의 경과기록
        tail = text.split("```")[-1] if text.count("```") >= 2 else ""
        notes = [tail.strip()] if len(tail.strip()) > 40 else []
    return rows, "\n\n".join(notes)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("sets", nargs="*", default=["A", "B", "C"])
    ap.add_argument("--model", default="qwen2.5:7b-instruct")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    log_path = OUT / "_생성기록.json"
    log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {}
    for key in a.sets:
        title, prompt, want = SETS[key]
        print(f"[{key}] {title} 생성 중…", flush=True)
        text, secs, tokens = ask(a.model, prompt)
        (OUT / f"{key}_raw.txt").write_text(text, encoding="utf-8")
        rows, notes = split_output(text)
        head = rows[0] if rows else []
        good = [r for r in rows[1:] if len(r) == len(head)]
        with open(OUT / f"{key}_정형.csv", "w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerows([head] + good)
        if notes:
            (OUT / f"{key}_경과기록.txt").write_text(notes, encoding="utf-8")
        log[key] = {"title": title, "model": a.model, "seconds": secs, "tokens": tokens, "columns": head,
                    "rows": len(good), "rowsRequested": want, "rowsDropped": len(rows) - 1 - len(good) if rows else 0,
                    "notesChars": len(notes), "prompt": prompt}
        print(f"  {secs}초 · 컬럼 {len(head)} · 행 {len(good)}/{want} · 경과기록 {len(notes)}자 · {head}", flush=True)
        log_path.write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
