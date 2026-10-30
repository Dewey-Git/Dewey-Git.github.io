@echo off
REM ============================================================
REM  Sync local changes to GitHub (Dewey-Git.github.io)
REM  Flow: add -> commit -> pull --rebase -> push
REM  Usage:
REM    sync.bat                 (auto commit message with timestamp)
REM    sync.bat "your message"  (custom commit message)
REM ============================================================
cd /d D:\DeweyProject\ID_Card

git add -A
git diff --cached --quiet
if errorlevel 1 (
    if "%~1"=="" (
        git commit -m "update %date% %time%"
    ) else (
        git commit -m "%~1"
    )
)

git pull --rebase origin main
git push origin main
echo.
echo Sync finished.
pause
