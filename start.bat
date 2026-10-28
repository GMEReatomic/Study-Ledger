@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "PY=python"
where py >nul 2>nul
if %errorlevel% equ 0 set "PY=py"

echo.
echo  一页工作台 · 本地服务器
echo  -------------------------
echo  地址: http://localhost:8000/
echo  说明: 必须通过 localhost 打开，Web Crypto 不能在 file:// 下使用。
echo  停止: 按 Ctrl+C
echo.

start "" "http://localhost:8000/"
%PY% -m http.server 8000 --bind 127.0.0.1

if errorlevel 1 (
  echo.
  echo 启动失败。请确认已安装 Python 3，并把 python 或 py 加入 PATH。
  pause
)
endlocal
