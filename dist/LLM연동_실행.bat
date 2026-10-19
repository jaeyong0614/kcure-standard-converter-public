@echo off
chcp 65001 >nul
rem K-CURE 표준변환기 LLM 연동본 실행기 (이 PC의 Ollama 에만 연결)
rem 파일을 더블클릭해 열면 Ollama 가 출처 null 을 거부하므로 127.0.0.1 주소로 띄웁니다.
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py -3
curl -s -m 3 http://127.0.0.1:11434/api/version >nul 2>nul || echo [안내] Ollama 가 실행 중이 아닙니다. 시작 메뉴에서 Ollama 를 실행하세요.
start "KCURE LLM 서버 - 닫으면 종료" /min %PY% -m http.server 8770 --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8770/KCURE_표준변환기_LLM.html"
echo 브라우저를 열었습니다. 작업이 끝나면 최소화된 "KCURE LLM 서버" 창을 닫으세요.
