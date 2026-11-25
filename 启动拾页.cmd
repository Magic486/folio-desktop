@echo off
python -B "%~dp0serve.py" --open
if errorlevel 1 pause
