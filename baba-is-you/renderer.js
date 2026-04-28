/**
 * Baba Is You 中文版 — Canvas 渲染器
 */

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = 56;
    this.gridOffsetX = 0;
    this.gridOffsetY = 0;
    this.animTime = 0;
    this.wobbleMap = new Map(); // cell.id → { dx, dy, t }
  }

  resize() {
    const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const dpr = isMobile ? Math.min(window.devicePixelRatio || 1, 2) : (window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  calcLayout(grid) {
    const rect = this.canvas.getBoundingClientRect();
    const maxW = rect.width * 0.9;
    const maxH = rect.height * 0.85;
    const cs = Math.floor(Math.min(maxW / grid.width, maxH / grid.height, 64));
    this.cellSize = cs;
    this.gridOffsetX = (rect.width - grid.width * cs) / 2;
    this.gridOffsetY = (rect.height - grid.height * cs) / 2;
  }

  render(grid, rules, dt) {
    this.animTime += dt;
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const cs = this.cellSize;

    // 背景
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, w, h);

    // 背景网格线
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= grid.width; x++) {
      ctx.beginPath();
      ctx.moveTo(this.gridOffsetX + x * cs, this.gridOffsetY);
      ctx.lineTo(this.gridOffsetX + x * cs, this.gridOffsetY + grid.height * cs);
      ctx.stroke();
    }
    for (let y = 0; y <= grid.height; y++) {
      ctx.beginPath();
      ctx.moveTo(this.gridOffsetX, this.gridOffsetY + y * cs);
      ctx.lineTo(this.gridOffsetX + grid.width * cs, this.gridOffsetY + y * cs);
      ctx.stroke();
    }

    // 绘制方块（先实体，后文字，文字在上层）
    const entities = [];
    const texts = [];
    for (const cell of grid.allCells()) {
      if (cell.isText) texts.push(cell);
      else entities.push(cell);
    }

    for (const cell of entities) {
      this.drawEntity(ctx, cell, cs);
    }
    for (const cell of texts) {
      this.drawText(ctx, cell, cs);
    }
  }

  drawEntity(ctx, cell, cs) {
    const x = this.gridOffsetX + cell.x * cs;
    const y = this.gridOffsetY + cell.y * cs;
    const pad = 3;
    const props = cell.activeProperties;

    ctx.save();

    // YOU 实体呼吸效果
    if (props.has(PROP.YOU)) {
      const pulse = 1 + 0.03 * Math.sin(this.animTime * 3);
      ctx.translate(x + cs / 2, y + cs / 2);
      ctx.scale(pulse, pulse);
      ctx.translate(-(x + cs / 2), -(y + cs / 2));
    }

    // 背景色
    const bg = this.getEntityBg(cell.type);
    const border = this.getEntityBorder(cell.type);

    // 圆角矩形
    const r = 8;
    ctx.beginPath();
    this.roundRect(ctx, x + pad, y + pad, cs - pad * 2, cs - pad * 2, r);
    ctx.fillStyle = bg;
    ctx.fill();

    // 边框
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 属性指示器（小角标）
    if (props.has(PROP.WIN)) {
      this.drawIndicator(ctx, x + cs - 14, y + 6, '★', '#ffd740');
    }
    if (props.has(PROP.DEFEAT)) {
      this.drawIndicator(ctx, x + cs - 14, y + cs - 16, '☠', '#ff4060');
    }
    if (props.has(PROP.STOP)) {
      this.drawIndicator(ctx, x + 4, y + cs - 16, '■', 'rgba(255,255,255,0.5)');
    }
    if (props.has(PROP.OPEN)) {
      this.drawIndicator(ctx, x + 4, y + 6, '○', '#40d080');
    }
    if (props.has(PROP.SHUT)) {
      this.drawIndicator(ctx, x + 4, y + 6, '●', '#d04040');
    }

    // 实体图标/文字
    const display = DISPLAY_NAMES[cell.type] || cell.type;
    const icon = this.getEntityIcon(cell.type);
    if (icon) {
      ctx.font = `${cs * 0.45}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.getEntityFg(cell.type);
      ctx.fillText(icon, x + cs / 2, y + cs / 2 + 2);
    } else {
      ctx.font = `bold ${cs * 0.28}px 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.getEntityFg(cell.type);
      ctx.fillText(display, x + cs / 2, y + cs / 2);
    }

    ctx.restore();
  }

  drawText(ctx, cell, cs) {
    const x = this.gridOffsetX + cell.x * cs;
    const y = this.gridOffsetY + cell.y * cs;
    const pad = 4;
    const display = DISPLAY_NAMES[cell.type] || cell.type;

    // 文字块背景 — 深色带边框
    const colors = this.getTextColors(cell.type);

    // 轻微浮动
    const floatY = 1.5 * Math.sin(this.animTime * 2 + cell.id * 0.7);

    ctx.save();
    ctx.translate(0, floatY);

    const r = 6;
    ctx.beginPath();
    this.roundRect(ctx, x + pad, y + pad, cs - pad * 2, cs - pad * 2, r);
    ctx.fillStyle = colors.bg;
    ctx.fill();
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 文字
    ctx.font = `bold ${cs * 0.32}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.fg;
    ctx.fillText(display, x + cs / 2, y + cs / 2);

    ctx.restore();
  }

  drawIndicator(ctx, x, y, text, color) {
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x + 5, y + 5);
  }

  getEntityBg(type) {
    const map = {
      BABA:  '#2d1f5e',
      WALL:  '#3a3a4a',
      FLAG:  '#1a3d2e',
      ROCK:  '#4a3a1e',
      WATER: '#1a2a4a',
      SKULL: '#3d1a1a',
      LAVA:  '#4a1a0a',
      KEY:   '#3d3010',
      DOOR:  '#1a2a3d',
      LOVE:  '#3d0a2a'
    };
    return map[type] || '#2a2a3a';
  }

  getEntityBorder(type) {
    const map = {
      BABA:  '#7c5cff',
      WALL:  '#6a6a7a',
      FLAG:  '#3dff7a',
      ROCK:  '#ffaa3d',
      WATER: '#3d8fff',
      SKULL: '#ff3d3d',
      LAVA:  '#ff6a1a',
      KEY:   '#ffd700',
      DOOR:  '#4a90e2',
      LOVE:  '#ff69b4'
    };
    return map[type] || '#5a5a6a';
  }

  getEntityFg(type) {
    const map = {
      BABA:  '#c4a8ff',
      WALL:  '#9a9aaa',
      FLAG:  '#7affaa',
      ROCK:  '#ffd080',
      WATER: '#80b8ff',
      SKULL: '#ff8080',
      LAVA:  '#ffaa60',
      KEY:   '#ffe066',
      DOOR:  '#80b4ff',
      LOVE:  '#ffaad4'
    };
    return map[type] || '#aaaacc';
  }

  getEntityIcon(type) {
    const map = {
      BABA:  '🐑',
      WALL:  '',
      FLAG:  '🚩',
      ROCK:  '🪨',
      WATER: '🌊',
      SKULL: '💀',
      LAVA:  '🌋',
      KEY:   '🗝️',
      DOOR:  '🚪',
      LOVE:  '💗'
    };
    return map[type];
  }

  getTextColors(type) {
    if (type === 'TEXT_IS') {
      return { bg: '#1a1a2a', border: '#5a5a7a', fg: '#9a9aba' };
    }
    if (window.NOUN_TEXTS && window.NOUN_TEXTS.includes(type)) {
      // 名词文字 — 紫色调
      return { bg: '#1a1030', border: '#6a4aaa', fg: '#c4a0ff' };
    }
    // 属性文字 — 对应属性的颜色
    const map = {
      TEXT_YOU:    { bg: '#101830', border: '#4a7aff', fg: '#80b0ff' },
      TEXT_WIN:    { bg: '#102818', border: '#3aff7a', fg: '#80ffaa' },
      TEXT_STOP:   { bg: '#1a1a1a', border: '#7a7a7a', fg: '#aaaaaa' },
      TEXT_PUSH:   { bg: '#281a08', border: '#ffaa3d', fg: '#ffd080' },
      TEXT_DEFEAT: { bg: '#280a0a', border: '#ff3d3d', fg: '#ff8080' },
      TEXT_SINK:   { bg: '#0a1a28', border: '#3d8fff', fg: '#80b8ff' },
      TEXT_HOT:    { bg: '#2a1008', border: '#ff6a1a', fg: '#ffaa60' },
      TEXT_MELT:   { bg: '#10202a', border: '#4ac4ff', fg: '#80daff' },
      TEXT_OPEN:   { bg: '#102010', border: '#40d080', fg: '#80ffc0' },
      TEXT_SHUT:   { bg: '#201010', border: '#d04040', fg: '#ff8080' }
    };
    return map[type] || { bg: '#1a1a2a', border: '#5a5a7a', fg: '#aaaacc' };
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** 绘制当前生效规则列表 */
  drawRules(ctx, rules) {
    const rect = this.canvas.getBoundingClientRect();
    const y = rect.height - 24;
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(160, 170, 200, 0.4)';

    const ruleStrs = [];
    for (const r of rules) {
      const s = DISPLAY_NAMES[r.subject] || r.subject;
      const p = DISPLAY_NAMES[r.predicate] || r.predicate;
      ruleStrs.push(`${s} 是 ${p}`);
    }
    if (ruleStrs.length > 0) {
      ctx.fillText('当前规则: ' + ruleStrs.join(' / '), rect.width - 16, y);
    }
  }

  /** 绘制操作提示 */
  drawHints(ctx) {
    const rect = this.canvas.getBoundingClientRect();
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(160, 170, 200, 0.3)';
    ctx.fillText('方向键/WASD移动 · Z撤销 · R重置', 16, rect.height - 24);
  }
}

window.Renderer = Renderer;
