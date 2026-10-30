@echo off
REM ============================================================
REM  Dewey business card - publish workflow
REM  Step 1: encrypt every local plaintext channel in data/*.json
REM  Step 2: commit (data/ is gitignored) + pull --rebase + push
REM  Usage:
REM    publish.bat                 (auto timestamp message)
REM    publish.bat "your message"
REM ============================================================
cd /d D:\DeweyProject\ID_Card

REM --- 1. encrypt all channels (skip keys.json) ---
if exist data\*.json (
  for %%f in (data\*.json) do (
    if /I not "%%~nf"=="keys" (
      echo [encrypt] %%~nf
      node tools/rotate.js %%~nf
    )
  )
) else (
  echo No data/*.json found, skipping encryption.
)

REM --- 2. commit + push (data/ is gitignored, only ciphertext goes up) ---
git add -A
git diff --cached --quiet
if errorlevel 1 (
    if "%~1"=="" (
        git commit -m "update %date% %time%"
    ) else (
        git commit -m "%~1"
    )
) else (
    echo Nothing to commit.
)
git pull --rebase origin main
git push origin main
echo.
echo Publish finished.
pause
