# 🎮 GameHub - 在线游戏平台

> 一个基于 Web 的多人在线游戏平台，支持五子棋、中国象棋、围棋、井字棋、消消乐等多种经典游戏。

![GameHub](https://img.shields.io/badge/GameHub-在线游戏平台-e94560?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.8+-3776ab?style=flat-square&logo=python)
![WebSocket](https://img.shields.io/badge/WebSocket-实时通信-00d9ff?style=flat-square)
![Nginx](https://img.shields.io/badge/Nginx-反向代理-009639?style=flat-square&logo=nginx)

## 🎯 游戏列表

| 游戏 | 类型 | 模式 | 状态 |
|------|------|------|------|
| 🎯 五子棋 | 策略 | 双人对战 · 联机 | ✅ 可玩 |
| 🐘 中国象棋 | 策略 | 双人对战 · 联机 | ✅ 可玩 |
| ⚫ 围棋 | 策略 | 双人对战 · 联机 | ✅ 可玩 |
| ✈️ 飞行棋 | 休闲 | 多人对战 · 联机 | 🔨 开发中 |
| ❌ 井字棋 | 休闲 | 双人对战 · 联机 | ✅ 可玩 |
| 💎 消消乐 | 休闲 | 益智关卡 | ✅ 可玩 |
| 🏃 弹跳球 | 跑酷 | 3D 单人 | ✅ 可玩 |
| 📜 规则即力量 | 解谜 | 推箱关卡 | ✅ 可玩 |

## 🛠 技术栈

### 前端
- HTML5 Canvas
- 原生 JavaScript (ES6+)
- CSS3 动画
- Three.js (3D 游戏)

### 后端
- Python 3.8+
- websockets (实时通信)
- asyncio (异步处理)

### 部署
- Nginx (反向代理)
- systemd (服务管理)
- Ubuntu 22.04 LTS

## 🚀 快速开始

### 环境要求
- Python 3.8+
- Node.js (可选，用于本地开发)
- Nginx (生产环境)

### 本地运行

1. **克隆项目**
```bash
git clone https://github.com/yourusername/gamehub.git
cd gamehub
```

2. **安装 Python 依赖**
```bash
# 为每个游戏安装依赖
cd gomoku
pip install websockets

cd ../chinese-chess
pip install websockets

# ... 其他游戏同理
```

3. **启动后端服务**
```bash
# 以五子棋为例
cd gomoku
python server.py
```

4. **打开浏览器**
```
直接打开 index.html 或通过本地服务器访问
```

### 部署到服务器

使用提供的部署脚本：

```bash
# 1. 上传项目到服务器
scp -r ./gamehub user@your-server:/opt/

# 2. SSH 登录服务器
ssh user@your-server

# 3. 运行部署脚本
cd /opt/gamehub
chmod +x deploy.sh
./deploy.sh
```

或手动部署：

```bash
# 1. 配置 Nginx
sudo cp nginx.conf /etc/nginx/sites-available/gamehub
sudo ln -s /etc/nginx/sites-available/gamehub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 2. 设置权限
sudo chown -R www-data:www-data /opt/gamehub

# 3. 启动游戏服务
# 参考 systemd 服务配置示例
```

## 📁 项目结构

```
gamehub/
├── index.html          # 平台首页
├── platform.css        # 公共样式
├── audiofx.js          # 音效引擎
├── nginx.conf          # Nginx 配置
├── deploy.sh           # 部署脚本
│
├── gomoku/            # 五子棋
│   ├── index.html
│   ├── style.css
│   ├── gomoku.js
│   └── server.py
│
├── chinese-chess/      # 中国象棋
├── go/                 # 围棋
├── ludo/              # 飞行棋 🔨
├── tictactoe/         # 井字棋
├── match-three/       # 消消乐
├── rollball/          # 弹跳球 (Three.js)
└── baba-is-you/       # 规则即力量
```

## 🔧 WebSocket 端口

| 游戏 | 端口 |
|------|------|
| 五子棋 | 6789 |
| 中国象棋 | 6790 |
| 围棋 | 6792 |
| 井字棋 | 6793 |
| 消消乐 | 6794 |

## 🎨 界面预览

平台采用深色主题设计，金色与红色作为强调色，营造沉浸式游戏体验。

- 左右分栏布局：左侧游戏列表，右侧详情预览
- 流畅的页面过渡动画
- 响应式设计，支持移动端

## 📝 开发指南

### 添加新游戏

1. 在项目根目录创建游戏文件夹
2. 参照现有游戏结构编写代码
3. 在 `index.html` 中添加游戏入口
4. 配置 WebSocket 后端服务
5. 更新 Nginx 配置（反向代理）

### 代码规范

- 使用 ES6+ 语法
- 遵循语义化 HTML
- CSS 变量统一管理主题
- WebSocket 使用 JSON 格式通信

## 📄 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- 游戏素材与规则参考经典游戏设计
- Web Audio API 用于音效合成
- Three.js 用于 3D 游戏渲染

---

**Made with ❤️ for gamers everywhere**
