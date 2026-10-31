@echo off
rem Double-click to start Zawli for testing on this computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-zawli.ps1" %*
