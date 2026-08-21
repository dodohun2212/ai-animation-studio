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

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-ai-team.ps1" ^
    -MainDir "%MAIN_DIR%" ^
    -FrontDir "%FRONT_DIR%" ^
    -BackendDir "%BACKEND_DIR%" ^
    -CodexCommand "%CODEX_CMD%" ^
    -ClaudeCommand "%CLAUDE_CMD%"

endlocal
