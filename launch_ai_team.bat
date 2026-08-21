@echo off
setlocal

set "MAIN_DIR=%~dp0"
set "FRONT_DIR=%~dp0..\frontend"
set "BACKEND_DIR=%~dp0..\backend"
set "CODEX_CMD=%APPDATA%\npm\codex.cmd"
set "CLAUDE_CMD=%USERPROFILE%\.local\bin\claude.exe"

if not exist "%CODEX_CMD%" (
    echo Codex CLI was not found: %CODEX_CMD%
    pause
    exit /b 1
)

if not exist "%CLAUDE_CMD%" (
    echo Claude CLI was not found: %CLAUDE_CMD%
    pause
    exit /b 1
)

if not exist "%FRONT_DIR%\.git" (
    echo Frontend worktree was not found: %FRONT_DIR%
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\.git" (
    echo Backend worktree was not found: %BACKEND_DIR%
    pause
    exit /b 1
)

start "GPT-5.6 SOL - MAIN" powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%MAIN_DIR%'; & '%CODEX_CMD%' -m 'gpt-5.6-sol'"
start "CLAUDE - FRONTEND" powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%FRONT_DIR%'; & '%CLAUDE_CMD%'"
start "GPT-5.6 TERRA - BACKEND" powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%BACKEND_DIR%'; & '%CODEX_CMD%' -m 'gpt-5.6-terra'"

endlocal
