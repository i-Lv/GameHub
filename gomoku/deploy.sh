#!/bin/bash
# ====================================================
# 五子棋项目 — 阿里云服务器一键部署脚本
# ====================================================
# 使用方法：
#   1. 把 gomoku 文件夹上传到服务器
#   2. 在服务器上执行：chmod +x deploy.sh && sudo ./deploy.sh
# ====================================================

set -e

INSTALL_DIR="/opt/gomoku"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "  五子棋项目部署到阿里云服务器"
echo "========================================"

# ── 1. 系统依赖 ──────────────────────────────────
echo ""
echo "[1/6] 安装系统依赖..."
if command -v apt-get &>/dev/null; then
    PKG_MANAGER="apt-get"
    sudo apt-get update -qq
    sudo apt-get install -y -qq nginx python3 python3-pip python3-venv
elif command -v yum &>/dev/null; then
    PKG_MANAGER="yum"
    sudo yum install -y nginx python3 python3-pip
elif command -v dnf &>/dev/null; then
    PKG_MANAGER="dnf"
    sudo dnf install -y nginx python3 python3-pip
else
    echo "不支持的包管理器，请手动安装 nginx 和 python3"
    exit 1
fi
echo "✓ 系统依赖安装完成"

# ── 2. 复制项目文件 ────────────────────────────────
echo ""
echo "[2/6] 复制项目文件到 ${INSTALL_DIR}..."
sudo mkdir -p "${INSTALL_DIR}"
sudo cp "${SCRIPT_DIR}/index.html" "${INSTALL_DIR}/"
sudo cp "${SCRIPT_DIR}/style.css"  "${INSTALL_DIR}/"
sudo cp "${SCRIPT_DIR}/gomoku.js"  "${INSTALL_DIR}/"
echo "✓ 前端文件已复制"

# ── 3. Python 虚拟环境 + 依赖 ─────────────────────
echo ""
echo "[3/6] 安装 Python 依赖..."
sudo cp "${SCRIPT_DIR}/server.py" "${INSTALL_DIR}/"
sudo cp "${SCRIPT_DIR}/requirements.txt" "${INSTALL_DIR}/"

# 创建虚拟环境
cd "${INSTALL_DIR}"
sudo python3 -m venv venv
sudo "${INSTALL_DIR}/venv/bin/pip" install -r requirements.txt -q
echo "✓ Python 依赖已安装"

# ── 4. 配置 systemd 服务（让后端自动运行）─────────
echo ""
echo "[4/6] 配置 WebSocket 后端服务..."
sudo tee /etc/systemd/system/gomoku-ws.service > /dev/null <<'EOF'
[Unit]
Description=Gomoku WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gomoku
ExecStart=/opt/gomoku/venv/bin/python server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gomoku-ws
sudo systemctl restart gomoku-ws
echo "✓ WebSocket 后端服务已启动（systemd 管理，开机自启）"

# ── 5. 配置 Nginx ─────────────────────────────────
echo ""
echo "[5/6] 配置 Nginx 反向代理..."
sudo cp "${SCRIPT_DIR}/nginx.conf" /etc/nginx/sites-available/gomoku

# 备份默认配置（如果存在且没有自定义过）
if [ -f /etc/nginx/sites-enabled/default ] && [ ! -L /etc/nginx/sites-enabled/gomoku ]; then
    sudo rm -f /etc/nginx/sites-enabled/default
fi

sudo ln -sf /etc/nginx/sites-available/gomoku /etc/nginx/sites-enabled/gomoku

# 测试 Nginx 配置
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo "✓ Nginx 配置完成并已重启"

# ── 6. 开放防火墙端口 ──────────────────────────────
echo ""
echo "[6/6] 配置防火墙..."
if command -v ufw &>/dev/null; then
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    echo "✓ ufw 已开放 80/443 端口"
elif command -v firewall-cmd &>/dev/null; then
    sudo firewall-cmd --permanent --add-port=80/tcp
    sudo firewall-cmd --permanent --add-port=443/tcp
    sudo firewall-cmd --reload
    echo "✓ firewalld 已开放 80/443 端口"
else
    echo "⚠ 未检测到防火墙工具，请手动开放 80 端口"
fi

echo ""
echo "========================================"
echo "  ✅ 部署完成！"
echo "========================================"
echo ""
echo "  访问地址: http://你的服务器IP"
echo ""
echo "  常用命令："
echo "    查看后端状态: sudo systemctl status gomoku-ws"
echo "    重启后端:    sudo systemctl restart gomoku-ws"
echo "    查看后端日志: sudo journalctl -u gomoku-ws -f"
echo "    重启 Nginx:  sudo systemctl restart nginx"
echo ""
