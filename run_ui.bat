@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE="

if exist "%~dp0.venv\Scripts\pythonw.exe" (
    set "PYTHON_EXE=%~dp0.venv\Scripts\pythonw.exe"
)

for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python314\pythonw.exe"
    "%LOCALAPPDATA%\Programs\Python\Python313\pythonw.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"
) do (
    if not defined PYTHON_EXE if exist "%%~P" set "PYTHON_EXE=%%~P"
)

if not defined PYTHON_EXE (
    where pyw.exe >nul 2>nul && set "PYTHON_EXE=pyw.exe"
)

if not defined PYTHON_EXE (
    where pythonw.exe >nul 2>nul && set "PYTHON_EXE=pythonw.exe"
)

if not defined PYTHON_EXE (
    echo Python 3.12 or newer was not found.
    echo Install Python from https://www.python.org/downloads/windows/
    echo and enable "Add Python to PATH", then run this file again.
    pause
    exit /b 1
)

start "AI Animation Studio" "%PYTHON_EXE%" -m app.ui
