/**
 * AudioFX — Web Audio API 合成音效
 * =====================================================
 * 零依赖，纯合成，短促清脆。
 * 用法：在 HTML 中 <script src="audiofx.js"></script> 引入（棋盘游戏目录的上一级），
 *       或在 gomoku/chinese-chess 的 HTML 中用 ../audiofx.js 引用。
 *
 * API：
 *   AudioFX.play('place')    — 落子（清脆木质敲击）
 *   AudioFX.play('capture')  — 吃子（略沉闷）
 *   AudioFX.play('select')   — 选中棋子
 *   AudioFX.play('check')    — 将军（警示短音）
 *   AudioFX.play('win')      — 胜利（上升和弦）
 *   AudioFX.play('lose')     — 失败（下降音）
 *   AudioFX.play('draw')     — 平局（中性双音）
 *   AudioFX.play('undo')     — 悔棋（反向滑动感）
 *   AudioFX.play('click')    — 按钮点击
 *   AudioFX.muted            — 静音开关（默认 false）
 */
'use strict';

const AudioFX = (() => {
  let ctx = null;
  let muted = false;

  function _ctx() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    // iOS 需要 resume
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* 工具函数 */
  function _osc(type, freq, start, dur, vol, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g); g.connect(dest);
    o.start(start); o.stop(start + dur + 0.01);
  }

  function _noise(start, dur, vol, dest) {
    const len = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    const flt = ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = 2000; flt.Q.value = 1;
    src.connect(flt); flt.connect(g); g.connect(dest);
    src.start(start); src.stop(start + dur + 0.01);
  }

  /* 音效定义 */
  const FX = {
    /* 落子 — 清脆木质敲击 */
    place() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.6; d.connect(c.destination);
      _osc('sine', 800, t, 0.06, 0.5, d);
      _osc('triangle', 1200, t, 0.04, 0.3, d);
      _noise(t, 0.05, 0.15, d);
    },

    /* 吃子 — 略沉闷的碰撞 */
    capture() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.6; d.connect(c.destination);
      _osc('sine', 400, t, 0.08, 0.5, d);
      _osc('triangle', 600, t, 0.06, 0.3, d);
      _noise(t, 0.08, 0.25, d);
    },

    /* 选中棋子 — 轻短高音 */
    select() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.4; d.connect(c.destination);
      _osc('sine', 1000, t, 0.04, 0.3, d);
    },

    /* 将军 — 警示双短音 */
    check() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.6; d.connect(c.destination);
      _osc('square', 600, t, 0.08, 0.2, d);
      _osc('square', 800, t + 0.1, 0.12, 0.25, d);
    },

    /* 胜利 — 上行三和弦 */
    win() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.5; d.connect(c.destination);
      _osc('sine', 523, t, 0.2, 0.3, d);
      _osc('sine', 659, t + 0.1, 0.2, 0.3, d);
      _osc('sine', 784, t + 0.2, 0.35, 0.35, d);
    },

    /* 失败 — 下行音 */
    lose() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.5; d.connect(c.destination);
      _osc('sine', 440, t, 0.2, 0.3, d);
      _osc('sine', 370, t + 0.15, 0.2, 0.3, d);
      _osc('sine', 311, t + 0.3, 0.35, 0.25, d);
    },

    /* 平局 — 中性双音 */
    draw() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.5; d.connect(c.destination);
      _osc('sine', 440, t, 0.15, 0.25, d);
      _osc('sine', 440, t + 0.2, 0.15, 0.25, d);
    },

    /* 悔棋 — 反向滑动感 */
    undo() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.4; d.connect(c.destination);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(600, t);
      o.frequency.exponentialRampToValueAtTime(300, t + 0.12);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(d);
      o.start(t); o.stop(t + 0.13);
    },

    /* 按钮点击 — 短促轻点 */
    click() {
      const c = _ctx(); if (!c) return;
      const t = c.currentTime;
      const d = c.createGain(); d.gain.value = 0.35; d.connect(c.destination);
      _osc('sine', 900, t, 0.03, 0.2, d);
    }
  };

  return {
    play(name) {
      if (muted) return;
      if (FX[name]) FX[name]();
    },
    get muted() { return muted; },
    set muted(v) { muted = !!v; }
  };
})();
