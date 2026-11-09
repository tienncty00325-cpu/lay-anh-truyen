@echo off
title Manga Crawler Pro
IF NOT EXIST node_modules\ (
    set /p c="Chua co thu vien. Tai xuong? (Y/N): "
    if /I "%c%"=="Y" call npm i --no-fund --no-audit
)
echo Dang khoi dong server...
node server.js
pause
