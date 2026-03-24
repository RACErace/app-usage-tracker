@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0App Usage Tracker.exe" "%~dp0resources\app.asar\src\cli\query.js" %*
