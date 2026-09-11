@echo off
cd /d "%~dp0"
echo [58moto 本地预览] 正在启动静态服务...
start "" node "%~dp0__srv.js" "%~dp0" 8080
timeout /t 2 >nul
start "" http://localhost:8080
echo 已在浏览器打开 http://localhost:8080 （看不到就手动输这个地址）
pause

