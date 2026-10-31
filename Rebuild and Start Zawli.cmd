@echo off
rem Use after the code has changed: rebuilds the app, then starts Zawli.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-zawli.ps1" -Rebuild
