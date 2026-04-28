@echo off
chcp 65001 >nul
echo ============================================
echo  五子棋双人对战 - 启动脚本
echo ============================================
echo.

REM 安装依赖
echo [1/2] 安装 Python 依赖...
python -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo 安装失败，请确认 Python 已安装
    pause
    exit /b 1
)

REM 启动 WebSocket 服务
echo [2/2] 启动 WebSocket 服务 ws://localhost:6789 ...
start "五子棋WS服务" python server.py

REM 等待服务启动
timeout /t 1 /nobreak >nul

REM 启动前端静态服务
echo [3/3] 启动前端静态服务 http://localhost:8765 ...
start "五子棋前端" python -m http.server 8765

timeout /t 1 /nobreak >nul

REM 自动打开浏览器
echo.
echo 正在打开浏览器...
start http://localhost:8765

echo.
echo ✅ 已启动！请用两个浏览器标签页，输入相同房间号开始对战。
echo    关闭此窗口将不影响后台服务，如需停止请关闭对应命令窗口。
echo.
pause
