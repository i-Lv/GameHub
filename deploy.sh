#!/bin/bash
# ====================================================
# GameHub - One-click Deployment Script
# ====================================================
# Usage:
#   1. Upload project to server
#   2. Run: chmod +x deploy.sh && sudo ./deploy.sh
# ====================================================

set -e

INSTALL_DIR="/opt/gamehub"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "  GameHub Deployment"
echo "========================================"

# ── 1. System Dependencies ─────────────────────────
echo ""
echo "[1/17] Installing system dependencies..."
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
    echo "Unsupported package manager. Please install nginx and python3 manually."
    exit 1
fi
echo "Done: System dependencies installed"

# ── 2. Copy Platform Files ─────────────────────────
echo ""
echo "[2/14] Copying platform files to ${INSTALL_DIR}..."
sudo mkdir -p "${INSTALL_DIR}"

sudo cp "${SCRIPT_DIR}/index.html" "${INSTALL_DIR}/"
sudo cp "${SCRIPT_DIR}/platform.css" "${INSTALL_DIR}/"
echo "Done: Platform files copied"

# ── 3. Copy Gomoku Files ───────────────────────────
echo ""
echo "[3/14] Copying Gomoku files..."
sudo mkdir -p "${INSTALL_DIR}/gomoku"

sudo cp "${SCRIPT_DIR}/gomoku/index.html" "${INSTALL_DIR}/gomoku/"
sudo cp "${SCRIPT_DIR}/gomoku/style.css" "${INSTALL_DIR}/gomoku/"
sudo cp "${SCRIPT_DIR}/gomoku/gomoku.js" "${INSTALL_DIR}/gomoku/"
sudo cp "${SCRIPT_DIR}/gomoku/server.py" "${INSTALL_DIR}/gomoku/"
sudo cp "${SCRIPT_DIR}/gomoku/requirements.txt" "${INSTALL_DIR}/gomoku/"
echo "Done: Gomoku files copied"

# ── 4. Setup Gomoku Backend ────────────────────────
echo ""
echo "[4/14] Setting up Gomoku backend..."
cd "${INSTALL_DIR}/gomoku"
if [ ! -d "venv" ]; then
    sudo python3 -m venv venv
fi
sudo "${INSTALL_DIR}/gomoku/venv/bin/pip" install -r requirements.txt -q

sudo tee /etc/systemd/system/gomoku-ws.service > /dev/null <<'EOF'
[Unit]
Description=Gomoku WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gamehub/gomoku
ExecStart=/opt/gamehub/gomoku/venv/bin/python server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gomoku-ws
sudo systemctl restart gomoku-ws
echo "Done: Gomoku backend started"

# ── 5. Copy Chinese Chess Files ────────────────────
echo ""
echo "[5/14] Copying Chinese Chess files..."
sudo mkdir -p "${INSTALL_DIR}/chinese-chess"

sudo cp "${SCRIPT_DIR}/chinese-chess/index.html" "${INSTALL_DIR}/chinese-chess/"
sudo cp "${SCRIPT_DIR}/chinese-chess/style.css" "${INSTALL_DIR}/chinese-chess/"
sudo cp "${SCRIPT_DIR}/chinese-chess/chess.js" "${INSTALL_DIR}/chinese-chess/"
sudo cp "${SCRIPT_DIR}/chinese-chess/server.py" "${INSTALL_DIR}/chinese-chess/"
sudo cp "${SCRIPT_DIR}/chinese-chess/requirements.txt" "${INSTALL_DIR}/chinese-chess/"
echo "Done: Chinese Chess files copied"

# ── 6. Setup Chinese Chess Backend ─────────────────
echo ""
echo "[6/14] Setting up Chinese Chess backend..."
cd "${INSTALL_DIR}/chinese-chess"
if [ ! -d "venv" ]; then
    sudo python3 -m venv venv
fi
sudo "${INSTALL_DIR}/chinese-chess/venv/bin/pip" install -r requirements.txt -q

sudo tee /etc/systemd/system/chess-ws.service > /dev/null <<'EOF'
[Unit]
Description=Chinese Chess WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gamehub/chinese-chess
ExecStart=/opt/gamehub/chinese-chess/venv/bin/python server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable chess-ws
sudo systemctl restart chess-ws
echo "Done: Chinese Chess backend started"

# ── 7. Copy Go Files ───────────────────────────────
echo ""
echo "[7/14] Copying Go (Weiqi) files..."
sudo mkdir -p "${INSTALL_DIR}/go"

sudo cp "${SCRIPT_DIR}/go/index.html" "${INSTALL_DIR}/go/"
sudo cp "${SCRIPT_DIR}/go/style.css" "${INSTALL_DIR}/go/"
sudo cp "${SCRIPT_DIR}/go/go.js" "${INSTALL_DIR}/go/"
sudo cp "${SCRIPT_DIR}/go/server.py" "${INSTALL_DIR}/go/"
sudo cp "${SCRIPT_DIR}/go/requirements.txt" "${INSTALL_DIR}/go/"
echo "Done: Go files copied"

# ── 8. Setup Go Backend ──────────────────────────
echo ""
echo "[8/14] Setting up Go backend..."
cd "${INSTALL_DIR}/go"
if [ ! -d "venv" ]; then
    sudo python3 -m venv venv
fi
sudo "${INSTALL_DIR}/go/venv/bin/pip" install -r requirements.txt -q

sudo tee /etc/systemd/system/go-ws.service > /dev/null <<'EOF'
[Unit]
Description=Go (Weiqi) WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gamehub/go
ExecStart=/opt/gamehub/go/venv/bin/python server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable go-ws
sudo systemctl restart go-ws
echo "Done: Go backend started"

# ── 9. Copy Tic Tac Toe Files ─────────────────────
echo ""
echo "[9/14] Copying Tic Tac Toe files..."
sudo mkdir -p "${INSTALL_DIR}/tictactoe"

sudo cp "${SCRIPT_DIR}/tictactoe/index.html" "${INSTALL_DIR}/tictactoe/"
sudo cp "${SCRIPT_DIR}/tictactoe/style.css" "${INSTALL_DIR}/tictactoe/"
sudo cp "${SCRIPT_DIR}/tictactoe/tictactoe.js" "${INSTALL_DIR}/tictactoe/"
sudo cp "${SCRIPT_DIR}/tictactoe/server.py" "${INSTALL_DIR}/tictactoe/"
sudo cp "${SCRIPT_DIR}/tictactoe/requirements.txt" "${INSTALL_DIR}/tictactoe/"
echo "Done: Tic Tac Toe files copied"

# ── 10. Setup Tic Tac Toe Backend ────────────────
echo ""
echo "[10/14] Setting up Tic Tac Toe backend..."
cd "${INSTALL_DIR}/tictactoe"
if [ ! -d "venv" ]; then
    sudo python3 -m venv venv
fi
sudo "${INSTALL_DIR}/tictactoe/venv/bin/pip" install -r requirements.txt -q

sudo tee /etc/systemd/system/tictactoe-ws.service > /dev/null <<'EOF'
[Unit]
Description=Tic Tac Toe WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gamehub/tictactoe
ExecStart=/opt/gamehub/tictactoe/venv/bin/python server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tictactoe-ws
sudo systemctl restart tictactoe-ws
echo "Done: Tic Tac Toe backend started"

# ── 11. Copy Match Three Files ───────────────────
echo ""
echo "[11/14] Copying Match Three files..."
sudo mkdir -p "${INSTALL_DIR}/match-three"

sudo cp "${SCRIPT_DIR}/match-three/index.html" "${INSTALL_DIR}/match-three/"
sudo cp "${SCRIPT_DIR}/match-three/style.css" "${INSTALL_DIR}/match-three/"
sudo cp "${SCRIPT_DIR}/match-three/match-three.js" "${INSTALL_DIR}/match-three/"
sudo cp "${SCRIPT_DIR}/match-three/server.py" "${INSTALL_DIR}/match-three/"
sudo cp "${SCRIPT_DIR}/match-three/requirements.txt" "${INSTALL_DIR}/match-three/"
echo "Done: Match Three files copied"

# ── 12. Setup Match Three Backend ────────────────
echo ""
echo "[12/14] Setting up Match Three backend..."
cd "${INSTALL_DIR}/match-three"
if [ ! -d "venv" ]; then
    sudo python3 -m venv venv
fi
sudo "${INSTALL_DIR}/match-three/venv/bin/pip" install -r requirements.txt -q

sudo tee /etc/systemd/system/matchthree-ws.service > /dev/null <<'EOF'
[Unit]
Description=Match Three WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gamehub/match-three
ExecStart=/opt/gamehub/match-three/venv/bin/python server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable matchthree-ws
sudo systemctl restart matchthree-ws
echo "Done: Match Three backend started"

# ── 12.5. Copy Ludo Files ──────────────────────
echo ""
echo "[12.5/17] Copying Ludo (飞行棋) files..."
sudo mkdir -p "${INSTALL_DIR}/ludo"

sudo cp "${SCRIPT_DIR}/ludo/index.html" "${INSTALL_DIR}/ludo/"
sudo cp "${SCRIPT_DIR}/ludo/style.css" "${INSTALL_DIR}/ludo/"
sudo cp "${SCRIPT_DIR}/ludo/ludo.js" "${INSTALL_DIR}/ludo/"
sudo cp "${SCRIPT_DIR}/ludo/server.py" "${INSTALL_DIR}/ludo/"
echo "Done: Ludo files copied"

# ── 12.6. Setup Ludo Backend ────────────────────
echo ""
echo "[12.6/17] Setting up Ludo backend..."
cd "${INSTALL_DIR}/ludo"
if [ ! -d "venv" ]; then
    sudo python3 -m venv venv
fi
sudo "${INSTALL_DIR}/ludo/venv/bin/pip" install websockets -q

sudo tee /etc/systemd/system/ludo-ws.service > /dev/null <<'EOF'
[Unit]
Description=Ludo (飞行棋) WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/gamehub/ludo
ExecStart=/opt/gamehub/ludo/venv/bin/python server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ludo-ws
sudo systemctl restart ludo-ws
echo "Done: Ludo backend started"

# ── 13. Copy RollBall Files ──────────────────────
echo ""
echo "[13/16] Copying RollBall files..."
sudo mkdir -p "${INSTALL_DIR}/rollball"
sudo cp "${SCRIPT_DIR}/rollball/index.html" "${INSTALL_DIR}/rollball/"
sudo cp "${SCRIPT_DIR}/rollball/style.css" "${INSTALL_DIR}/rollball/"
sudo cp "${SCRIPT_DIR}/rollball/rollball.js" "${INSTALL_DIR}/rollball/"
if [ -d "${SCRIPT_DIR}/rollball/libs" ]; then
    sudo cp -r "${SCRIPT_DIR}/rollball/libs/"* "${INSTALL_DIR}/rollball/libs/" 2>/dev/null || true
fi
echo "Done: RollBall files copied"

# ── 14. Copy Baba Is You Files ───────────────────
echo ""
echo "[14/16] Copying Baba Is You files..."
sudo mkdir -p "${INSTALL_DIR}/baba-is-you"
sudo cp "${SCRIPT_DIR}/baba-is-you/index.html" "${INSTALL_DIR}/baba-is-you/"
sudo cp "${SCRIPT_DIR}/baba-is-you/style.css" "${INSTALL_DIR}/baba-is-you/"
sudo cp "${SCRIPT_DIR}/baba-is-you/engine.js" "${INSTALL_DIR}/baba-is-you/"
sudo cp "${SCRIPT_DIR}/baba-is-you/game.js" "${INSTALL_DIR}/baba-is-you/"
sudo cp "${SCRIPT_DIR}/baba-is-you/levels.js" "${INSTALL_DIR}/baba-is-you/"
sudo cp "${SCRIPT_DIR}/baba-is-you/renderer.js" "${INSTALL_DIR}/baba-is-you/"
echo "Done: Baba Is You files copied"

# ── 15. Configure Nginx ───────────────────────────
echo ""
echo "[15/16] Configuring Nginx..."
sudo cp "${SCRIPT_DIR}/nginx.conf" /etc/nginx/sites-available/gamehub

if [ -f /etc/nginx/sites-enabled/default ] && [ ! -L /etc/nginx/sites-enabled/gamehub ]; then
    sudo rm -f /etc/nginx/sites-enabled/default
fi
sudo ln -sf /etc/nginx/sites-available/gamehub /etc/nginx/sites-enabled/gamehub

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo "Done: Nginx configured and restarted"

# ── 16. Firewall ─────────────────────────────────
echo ""
echo "[16/16] Configuring firewall..."
if command -v ufw &>/dev/null; then
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    echo "Done: ufw opened 80/443"
elif command -v firewall-cmd &>/dev/null; then
    sudo firewall-cmd --permanent --add-port=80/tcp
    sudo firewall-cmd --permanent --add-port=443/tcp
    sudo firewall-cmd --reload
    echo "Done: firewalld opened 80/443"
else
    echo "Warning: No firewall tool detected. Please open port 80 manually."
fi

echo ""
echo "========================================"
echo "  Deployment Complete!"
echo "========================================"
echo ""
echo "  Platform:   http://YOUR_SERVER_IP"
echo "  Gomoku:     http://YOUR_SERVER_IP/gomoku/"
echo "  Chess:      http://YOUR_SERVER_IP/chinese-chess/"
echo "  Go:         http://YOUR_SERVER_IP/go/"
echo "  Tic Tac Toe: http://YOUR_SERVER_IP/tictactoe/"
echo "  Match Three: http://YOUR_SERVER_IP/match-three/"
echo "  Ludo:       http://YOUR_SERVER_IP/ludo/"
echo "  RollBall:   http://YOUR_SERVER_IP/rollball/"
echo "  Baba Is You: http://YOUR_SERVER_IP/baba-is-you/"
echo ""
echo "  Commands:"
echo "    Gomoku status:   sudo systemctl status gomoku-ws"
echo "    Chess status:    sudo systemctl status chess-ws"
echo "    Go status:       sudo systemctl status go-ws"
echo "    Tic Tac Toe status: sudo systemctl status tictactoe-ws"
echo "    Match Three status: sudo systemctl status matchthree-ws"
echo "    Ludo status:     sudo systemctl status ludo-ws"
echo "    Gomoku restart:  sudo systemctl restart gomoku-ws"
echo "    Chess restart:   sudo systemctl restart chess-ws"
echo "    Go restart:      sudo systemctl restart go-ws"
echo "    Tic Tac Toe restart: sudo systemctl restart tictactoe-ws"
echo "    Match Three restart: sudo systemctl restart matchthree-ws"
echo "    Ludo restart:     sudo systemctl restart ludo-ws"
echo "    Gomoku logs:     sudo journalctl -u gomoku-ws -f"
echo "    Chess logs:      sudo journalctl -u chess-ws -f"
echo "    Go logs:         sudo journalctl -u go-ws -f"
echo "    Tic Tac Toe logs: sudo journalctl -u tictactoe-ws -f"
echo "    Match Three logs: sudo journalctl -u matchthree-ws -f"
echo "    Ludo logs:        sudo journalctl -u ludo-ws -f"
echo "    Restart Nginx:   sudo systemctl restart nginx"
echo ""
