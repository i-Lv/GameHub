import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

/* =============================================
   RollBall — 无限轨道弹跳球
   基于 three-sphere.html 参考代码适配
   
   三种轨道类型：
   (1) 长直轨道：一块长板居中，随机粉/黄/蓝 → 球变色
   (2) 两块方形：左/右各一块，二色各一 → 必须踩同色
   (3) 三块方形：左/中/右各一块，三色各一 → 必须踩同色
   + 类型4：加速轨道（白色发光，3倍重力加速）
   ============================================= */

// ===== 场景 =====
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 3, 10);
camera.lookAt(0, 0, -10);

const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(isMobile ? Math.min(devicePixelRatio, 2) : devicePixelRatio);
renderer.shadowMap.enabled = !isMobile;
if (!isMobile) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableRotate = false;
controls.enableZoom = false;
controls.enablePan = false;
controls.target.set(0, 0, -10);

// 星空背景
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(4000 * 3);
for (let i = 0; i < starPos.length; i++) starPos[i] = (Math.random() - 0.5) * 300;
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo,
  new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.7 })));

// ===== 加速背景粒子系统 =====
const BOOST_PARTICLE_COUNT = isMobile ? 3000 : 8000;
const boostParticleGeo = new THREE.BufferGeometry();
const boostPosArr = new Float32Array(BOOST_PARTICLE_COUNT * 3);
const boostSizeArr = new Float32Array(BOOST_PARTICLE_COUNT);
const boostParticleData = [];

for (let i = 0; i < BOOST_PARTICLE_COUNT; i++) {
  const angle = Math.random() * Math.PI * 2;
  const tunnelR = 3 + Math.random() * 25;
  const zOff = -60 + Math.random() * 120;
  const spiralPhase = Math.random() * Math.PI * 2;
  const spiralArm = Math.floor(Math.random() * 3);

  boostPosArr[i * 3]     = tunnelR * Math.cos(angle);
  boostPosArr[i * 3 + 1] = (Math.random() - 0.5) * 30;
  boostPosArr[i * 3 + 2] = zOff;

  const sizeRoll = Math.random();
  if (sizeRoll < 0.7) boostSizeArr[i] = 0.06 + Math.random() * 0.12;
  else if (sizeRoll < 0.92) boostSizeArr[i] = 0.2 + Math.random() * 0.4;
  else boostSizeArr[i] = 0.6 + Math.random() * 1.0;

  boostParticleData.push({
    angle, tunnelR, baseTunnelR: tunnelR, zOff, spiralPhase, spiralArm,
    speed: 1.5 + Math.random() * 3.0,
    zSpeed: 5 + Math.random() * 15,
    pulsePhase: Math.random() * Math.PI * 2,
    sizeBase: boostSizeArr[i],
  });
}

boostParticleGeo.setAttribute('position', new THREE.BufferAttribute(boostPosArr, 3));
boostParticleGeo.setAttribute('aSize', new THREE.BufferAttribute(boostSizeArr, 1));

let boostParticleColorTarget = new THREE.Color(0.4, 0.53, 1.0);
let boostParticleColorCurrent = new THREE.Color(0.4, 0.53, 1.0);
const BOOST_COLOR_LERP_SPEED = 3.0;

const boostParticleMat = new THREE.ShaderMaterial({
  uniforms: {
    uOpacity: { value: 0.0 },
    uColor: { value: new THREE.Color(0.4, 0.53, 1.0) },
  },
  vertexShader: `
    attribute float aSize;
    varying float vDist;
    void main() {
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      vDist = -mvPos.z;
      gl_PointSize = aSize * (250.0 / max(1.0, -mvPos.z));
      gl_Position = projectionMatrix * mvPos;
    }
  `,
  fragmentShader: `
    uniform float uOpacity;
    uniform vec3 uColor;
    varying float vDist;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float alpha = 1.0 - smoothstep(0.0, 1.0, d);
      float glow = exp(-d * 3.0) * 0.7;
      vec3 col = uColor * (1.0 + glow);
      float fog = smoothstep(100.0, 15.0, vDist);
      gl_FragColor = vec4(col, (alpha + glow * 0.6) * uOpacity * fog);
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const boostParticles = new THREE.Points(boostParticleGeo, boostParticleMat);
boostParticles.visible = false;
scene.add(boostParticles);

let boostParticleTime = 0;
let boostParticleVisible = false;
let boostFadeAlpha = 0;

function setBoostParticleColor(colorKey) {
  if (!colorKey || !COLORS[colorKey]) return;
  const rgb = COLORS[colorKey].rgb;
  boostParticleColorTarget.set(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
}

function updateBoostParticles(dt) {
  const isActive = boostTimer > 0;
  if (isActive && !boostParticleVisible) {
    boostParticleVisible = true;
    boostParticles.visible = true;
    setBoostParticleColor(ballColorKey);
    boostParticleColorCurrent.copy(boostParticleColorTarget);
  }
  if (isActive) {
    boostFadeAlpha = Math.min(1.0, boostFadeAlpha + dt * 2.5);
  } else {
    boostFadeAlpha = Math.max(0.0, boostFadeAlpha - dt * 1.2);
    if (boostFadeAlpha <= 0) {
      boostParticleVisible = false;
      boostParticles.visible = false;
    }
  }
  boostParticleMat.uniforms.uOpacity.value = boostFadeAlpha * 0.85;
  if (boostFadeAlpha <= 0) return;

  boostParticleColorCurrent.lerp(boostParticleColorTarget, 1 - Math.exp(-BOOST_COLOR_LERP_SPEED * dt));
  boostParticleMat.uniforms.uColor.value.copy(boostParticleColorCurrent);

  boostParticleTime += dt;
  const posAttr = boostParticleGeo.getAttribute('position');
  const sizeAttr = boostParticleGeo.getAttribute('aSize');

  for (let i = 0; i < BOOST_PARTICLE_COUNT; i++) {
    const pd = boostParticleData[i];
    pd.angle += pd.speed * dt;
    pd.zOff += pd.zSpeed * dt;
    if (pd.zOff > 60) pd.zOff -= 120;

    const spiralAngle = pd.angle + pd.spiralArm * (Math.PI * 2 / 3);
    const zNorm = (pd.zOff + 60) / 120;
    const tunnelConverge = 1.0 - Math.abs(zNorm - 0.5) * 0.6;
    const r = pd.baseTunnelR * tunnelConverge;

    const spiralX = Math.sin(pd.zOff * 0.08 + pd.spiralPhase) * r * 0.4;
    const spiralY = Math.cos(pd.zOff * 0.08 + pd.spiralPhase) * r * 0.3;

    posAttr.setXYZ(i,
      r * Math.cos(spiralAngle) + spiralX,
      r * Math.sin(spiralAngle) * 0.5 + spiralY + ballY * 0.25,
      pd.zOff
    );

    const sizePulse = 1.0 + Math.sin(boostParticleTime * 2.0 + pd.pulsePhase) * 0.2;
    sizeAttr.setX(i, pd.sizeBase * sizePulse);
  }
  posAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;
}

// ===== 光照 =====
scene.add(new THREE.AmbientLight(0x223355, 1.8));

const keyLight = new THREE.PointLight(0xffffff, 150, 50);
keyLight.position.set(5, 8, 5);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x6633ff, 70, 30);
fillLight.position.set(-5, -2, 3);
scene.add(fillLight);

const movingLight = new THREE.PointLight(0xff6600, 60, 25);
scene.add(movingLight);

const lightBall = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xff9933 })
);
scene.add(lightBall);

// ===== 物理常量 =====
const GROUND_Y      = -2.0;
const BALL_RADIUS   = 0.5;
const GRAVITY_Y     = -14.7;
const INIT_HEIGHT   = 3.0;
const VISIBLE_DEPTH = 120;

const _g = Math.abs(GRAVITY_Y);
const _t_down = Math.sqrt(2 * INIT_HEIGHT / _g);
const BOUNCE_PERIOD = 2 * _t_down;

// ===== 加速轨道系统 =====
const BOOST_DURATION = 10.0;
const BOOST_GRAVITY_MULT = 3.0;
let boostTimer = 0;
let currentGravityY = GRAVITY_Y;
let boostCharging = false;
let boostPendingDecel = false;

function getCurrentBouncePeriod() {
  const g = Math.abs(currentGravityY);
  const tDown = Math.sqrt(2 * INIT_HEIGHT / g);
  return 2 * tDown;
}

function recalcVelZ() {
  let nearestAheadZ = -Infinity;
  for (const z of groupZList) {
    if (z < -0.5 && z > nearestAheadZ) nearestAheadZ = z;
  }
  if (nearestAheadZ > -Infinity) {
    const period = getCurrentBouncePeriod();
    velZ = Math.abs(nearestAheadZ) / period;
  }
}

// 轨道组间距
const GAP_MIN = 3.75;
const GAP_MAX = 7.5;

// ===== 颜色定义 =====
const COLORS = {
  pink:  { hex: 0xff68fd, rgb: [255, 104, 253] },
  yellow:{ hex: 0xffe528, rgb: [255, 229,  40] },
  blue:  { hex: 0x15befc, rgb: [ 21, 190, 252] }
};
const COLOR_KEYS = ['pink', 'yellow', 'blue'];
function randColor() { return COLOR_KEYS[Math.floor(Math.random() * 3)]; }

// ===== 轨道组尺寸 =====
const PLATE_HEIGHT = 0.12;
const LONG_SIZE_X = 5.25;
const LONG_SIZE_Z = 1.2;
const SQ_SIZE     = 1.05;
const SQ_SPACING  = 1.35;

// ===== 几何体（共享） =====
const longGeo = new THREE.BoxGeometry(LONG_SIZE_X, PLATE_HEIGHT, LONG_SIZE_Z);
const sqGeo   = new THREE.BoxGeometry(SQ_SIZE, PLATE_HEIGHT, SQ_SIZE);

// 箭头纹理
function createArrowTextureForColor(colorKey) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS[colorKey].hex;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.15);
  ctx.lineTo(size * 0.72, size * 0.45);
  ctx.lineTo(size * 0.58, size * 0.45);
  ctx.lineTo(size * 0.58, size * 0.82);
  ctx.lineTo(size * 0.42, size * 0.82);
  ctx.lineTo(size * 0.42, size * 0.45);
  ctx.lineTo(size * 0.28, size * 0.45);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
const arrowTextures = {};
for (const ck of Object.keys(COLORS)) arrowTextures[ck] = createArrowTextureForColor(ck);

function makeMat(colorKey) {
  const rgb = COLORS[colorKey].rgb;
  return new THREE.MeshStandardMaterial({
    color: COLORS[colorKey].hex,
    metalness: 0.3, roughness: 0.35,
    emissive: new THREE.Color(rgb[0]*0.5/255, rgb[1]*0.5/255, rgb[2]*0.5/255),
    transparent: true, opacity: 1.0
  });
}

function makeBoostMat() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.1, roughness: 0.2,
    emissive: new THREE.Color(0.5, 0.5, 0.7),
    transparent: true, opacity: 0.95
  });
}

function makeSqMats(colorKey) {
  const side1 = makeMat(colorKey);
  const side2 = makeMat(colorKey);
  const topMat = makeMat(colorKey);
  topMat.map = arrowTextures[colorKey];
  topMat.color.set(0xffffff);
  const side3 = makeMat(colorKey);
  const side4 = makeMat(colorKey);
  const bottom = makeMat(colorKey);
  return [side1, side2, topMat, bottom, side3, side4];
}

// ===== 关卡系统 =====
const LEVELS = [
  { name: '永恒号', nameEn: 'Endurance', maxType: 1, winHits: 1, desc: '跳 1 次，进入黑洞' },
  { name: '水星', nameEn: 'Miller', maxType: 2, winHits: 10, desc: '跳 10 次，进入黑洞' },
  { name: '曼恩星球', nameEn: 'Mann', maxType: 3, winHits: 20, desc: '跳 20 次，进入黑洞' },
  { name: '土星', nameEn: 'Saturn', maxType: 3, winHits: 200, desc: '跳 200 次，进入黑洞' },
  { name: '卡冈图雅', nameEn: 'Gargantua', maxType: 3, winHits: 2000, desc: '跳 2000 次，进入黑洞' }
];
let currentLevel = 0;
function getLevel() { return LEVELS[currentLevel]; }

// 关卡解锁
const UNLOCK_KEY = 'bounceGame_maxUnlocked';
function getMaxUnlocked() { return parseInt(localStorage.getItem(UNLOCK_KEY) || '1', 10); }
function unlockNext() { const next = Math.min(LEVELS.length, getMaxUnlocked() + 1); localStorage.setItem(UNLOCK_KEY, String(next)); }

// ===== 关卡选择界面 =====
const levelSelectOverlay = document.getElementById('levelSelectOverlay');
const levelCardsContainer = document.getElementById('levelCards');
const inGameMenuBtn = document.getElementById('inGameMenuBtn');

LEVELS.forEach((lv, i) => {
  const card = document.createElement('div');
  card.className = 'level-card';
  card.dataset.index = i;
  card.innerHTML = `<div class="card-num">LEVEL ${i + 1}</div><div class="card-name">${lv.name}</div><div class="card-name-en">${lv.nameEn}</div>`;
  card.addEventListener('click', () => {
    if (i + 1 > getMaxUnlocked()) return;
    currentLevel = i;
    startGame();
  });
  levelCardsContainer.appendChild(card);
});

function updateCardStates() {
  const maxUnlocked = getMaxUnlocked();
  const cards = levelCardsContainer.querySelectorAll('.level-card');
  cards.forEach((card, i) => {
    card.classList.toggle('active', i === currentLevel && i + 1 <= maxUnlocked);
    card.classList.toggle('locked', i + 1 > maxUnlocked);
  });
}

function showLevelSelect() {
  updateCardStates();
  levelSelectOverlay.style.display = 'flex';
  inGameMenuBtn.style.display = 'none';
}
function hideLevelSelect() {
  levelSelectOverlay.style.display = 'none';
}

function startGame() {
  hideLevelSelect();
  inGameMenuBtn.style.display = 'block';
  resetGame();
}

inGameMenuBtn.addEventListener('click', () => showLevelSelect());
document.getElementById('backToMenuBtn').addEventListener('click', () => { window.location.href = '../'; });
showLevelSelect();

// ===== 轨道组系统 =====
const trackGroups = [];
const groupZList  = [];

// 类型1：长直轨道（单块长板，一种颜色）
function createType1(z, colorKey) {
  const mat = makeMat(colorKey);
  const mesh = new THREE.Mesh(longGeo, mat);
  mesh.position.set(0, GROUND_Y + PLATE_HEIGHT / 2, z);
  mesh.receiveShadow = true; mesh.castShadow = true;
  scene.add(mesh);
  return { type: 1, meshes: [mesh], mats: [mat], z, colorKey };
}

// 类型2：两块有间隔的方形轨道（二色各一）
function createType2(z, colors) {
  const result = { type: 2, meshes: [], mats: [], z, colorKeys: [] };
  const offset = SQ_SPACING * 0.65;
  for (let i = 0; i < 2; i++) {
    const mats = makeSqMats(colors[i]);
    const mesh = new THREE.Mesh(sqGeo, mats);
    mesh.position.set([-offset, offset][i], GROUND_Y + PLATE_HEIGHT / 2, z);
    mesh.receiveShadow = true; mesh.castShadow = true;
    scene.add(mesh);
    result.meshes.push(mesh);
    result.mats.push(...mats);
    result.colorKeys.push(colors[i]);
  }
  return result;
}

// 类型3：三块有间隔的方形轨道（三色各一）
function createType3(z, colors) {
  const result = { type: 3, meshes: [], mats: [], z, colorKeys: [] };
  const xPositions = [-SQ_SPACING, 0, SQ_SPACING];
  for (let i = 0; i < 3; i++) {
    const mats = makeSqMats(colors[i]);
    const mesh = new THREE.Mesh(sqGeo, mats);
    mesh.position.set(xPositions[i], GROUND_Y + PLATE_HEIGHT / 2, z);
    mesh.receiveShadow = true; mesh.castShadow = true;
    scene.add(mesh);
    result.meshes.push(mesh);
    result.mats.push(...mats);
    result.colorKeys.push(colors[i]);
  }
  return result;
}

// 类型4：加速长直轨道（白色发光）
function createType4(z) {
  const mat = makeBoostMat();
  const mesh = new THREE.Mesh(longGeo, mat);
  mesh.position.set(0, GROUND_Y + PLATE_HEIGHT / 2, z);
  mesh.receiveShadow = true; mesh.castShadow = true;
  scene.add(mesh);
  return { type: 4, meshes: [mesh], mats: [mat], z, colorKey: 'boost' };
}

function createRandomGroup(z, safeColor, maxType) {
  maxType = maxType || 3;
  if (Math.random() < 0.15) {
    const group = createType4(z);
    trackGroups.push(group);
    groupZList.push(z);
    return group;
  }
  const type = Math.floor(Math.random() * maxType) + 1;
  let group;
  if (type === 1) {
    group = createType1(z, randColor());
  } else if (type === 2) {
    const otherKeys = COLOR_KEYS.filter(k => k !== safeColor);
    const other = otherKeys[Math.floor(Math.random() * otherKeys.length)];
    const cols = [safeColor, other].sort(() => Math.random() - 0.5);
    group = createType2(z, cols);
  } else {
    const cols = [...COLOR_KEYS].sort(() => Math.random() - 0.5);
    group = createType3(z, cols);
  }
  trackGroups.push(group);
  groupZList.push(z);
  return group;
}

function disposeGroup(group) { for (const m of group.meshes) scene.remove(m); for (const mat of group.mats) mat.dispose(); }
function removeGroup(idx) { disposeGroup(trackGroups[idx]); trackGroups.splice(idx, 1); groupZList.splice(idx, 1); }
function randGap() { return GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN); }

let lastLongTrackColor = null;

function generateInitialGroups() {
  let z = 0;
  for (let i = 0; i < 5; i++) {
    const g = createType1(z, randColor());
    trackGroups.push(g); groupZList.push(z);
    z -= randGap();
  }
  lastLongTrackColor = trackGroups[trackGroups.length - 1].colorKey;
  while (z > -VISIBLE_DEPTH) {
    z -= randGap();
    createRandomGroup(z, lastLongTrackColor, getLevel().maxType);
    const newGroup = trackGroups[trackGroups.length - 1];
    if (newGroup.type === 1) lastLongTrackColor = newGroup.colorKey;
  }
}
generateInitialGroups();

const FADE_START = 3;
const FADE_END   = 12;

function updateTrack(deltaZ) {
  totalDistance += deltaZ;
  for (let i = 0; i < trackGroups.length; i++) {
    groupZList[i] += deltaZ;
    trackGroups[i].z = groupZList[i];
    for (const m of trackGroups[i].meshes) m.position.z = groupZList[i];
  }
  if (bhGroup) bhGroup.position.z += deltaZ;

  for (let i = trackGroups.length - 1; i >= 0; i--) {
    const z = groupZList[i];
    if (z > FADE_START) {
      const ratio = Math.min(1, (z - FADE_START) / (FADE_END - FADE_START));
      for (const mat of trackGroups[i].mats) mat.opacity = 1.0 - ratio;
    }
    if (z > FADE_END) removeGroup(i);
  }

  let minZ = groupZList.length > 0 ? Math.min(...groupZList) : 0;
  while (minZ > -VISIBLE_DEPTH) {
    minZ -= randGap();
    createRandomGroup(minZ, lastLongTrackColor, getLevel().maxType);
    const newGroup = trackGroups[trackGroups.length - 1];
    if (newGroup.type === 1) lastLongTrackColor = newGroup.colorKey;
  }
}

// ===== 球体 =====
const sphereGeo = new THREE.SphereGeometry(BALL_RADIUS, 64, 64);
const sphereMat = new THREE.MeshStandardMaterial({
  color: 0x4488ff, metalness: 0.3, roughness: 0.2, emissive: 0x112244
});
const sphere = new THREE.Mesh(sphereGeo, sphereMat);
sphere.castShadow = true;
scene.add(sphere);

const wireMesh = new THREE.Mesh(sphereGeo,
  new THREE.MeshBasicMaterial({ color: 0x88ccff, wireframe: true, transparent: true, opacity: 0.08 })
);
scene.add(wireMesh);

const ringCount = 120;
const ringPos   = new Float32Array(ringCount * 3);
for (let i = 0; i < ringCount; i++) {
  const a = (i / ringCount) * Math.PI * 2;
  const r = 0.8 + Math.random() * 0.1;
  ringPos[i * 3]     = Math.cos(a) * r;
  ringPos[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
  ringPos[i * 3 + 2] = Math.sin(a) * r;
}
const ringGeo = new THREE.BufferGeometry();
ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
const ring = new THREE.Points(ringGeo,
  new THREE.PointsMaterial({ color: 0x66aaff, size: 0.04, transparent: true, opacity: 0.7 }));
scene.add(ring);

// 球状态
const floorContact = GROUND_Y + BALL_RADIUS;
let ballX = 0;
let ballY = floorContact;
let velY  = Math.sqrt(2 * _g * INIT_HEIGHT);
let velZ  = 0;
let falling = false;

// ===== Pointer Lock + 暂停系统 =====
let isPaused = false;
let isPointerLocked = false;

// 点击 canvas 锁定鼠标
renderer.domElement.addEventListener('click', () => {
  if (!isPaused && levelSelectOverlay.style.display !== 'flex' &&
      gameOverOverlay.style.display !== 'flex' && victoryOverlay.style.display !== 'flex') {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === renderer.domElement;
  // ESC 退出 pointer lock 时自动暂停
  if (!isPointerLocked && !isPaused &&
      levelSelectOverlay.style.display !== 'flex' &&
      gameOverOverlay.style.display !== 'flex' &&
      victoryOverlay.style.display !== 'flex') {
    pauseGame();
  }
});

function pauseGame() {
  if (isPaused) return;
  isPaused = true;
  if (document.pointerLockElement) document.exitPointerLock();
  document.getElementById('pauseOverlay').style.display = 'flex';
}

function resumeGame() {
  isPaused = false;
  document.getElementById('pauseOverlay').style.display = 'none';
  lastTime = performance.now() / 1000; // 避免暂停后的大 dt
  renderer.domElement.requestPointerLock();
}

document.getElementById('pauseResumeBtn').addEventListener('click', resumeGame);
document.getElementById('pauseMenuBtn').addEventListener('click', () => {
  isPaused = false;
  document.getElementById('pauseOverlay').style.display = 'none';
  showLevelSelect();
});
document.getElementById('pauseBackBtn').addEventListener('click', () => {
  window.location.href = '../';
});

// 鼠标 X 轴缓动控制
const MOUSE_SENSITIVITY = 0.012;
const LERP_SMOOTHNESS  = 0.12;
let mouseDeltaX = 0;
let ballXTarget  = 0;
document.addEventListener('mousemove', (e) => { if (isPointerLocked && e.movementX !== undefined) mouseDeltaX += e.movementX; });

// 触摸控制
let touchStartX = null;
document.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; });
document.addEventListener('touchmove', (e) => {
  if (touchStartX !== null) {
    mouseDeltaX += e.touches[0].clientX - touchStartX;
    touchStartX = e.touches[0].clientX;
  }
});
document.addEventListener('touchend', () => { touchStartX = null; });



// 碰撞检测
function findCollisionWithAnyGroup() {
  const r = BALL_RADIUS;
  let bestGroup = null, bestColorKey = null, bestMesh = null;
  let bestDist = Infinity;
  for (let gi = 0; gi < trackGroups.length; gi++) {
    const group = trackGroups[gi];
    const gz = groupZList[gi];
    for (let mi = 0; mi < group.meshes.length; mi++) {
      const mesh = group.meshes[mi];
      const bx = mesh.position.x;
      const by = mesh.position.y;
      let hsx, hsz;
      if (group.type === 1 || group.type === 4) { hsx = LONG_SIZE_X / 2; hsz = LONG_SIZE_Z / 2; }
      else { hsx = SQ_SIZE / 2; hsz = SQ_SIZE / 2; }
      const hsy = PLATE_HEIGHT / 2;
      const closestX = Math.max(bx - hsx, Math.min(ballX, bx + hsx));
      const closestY = Math.max(by - hsy, Math.min(ballY, by + hsy));
      const closestZ = Math.max(gz - hsz, Math.min(0, gz + hsz));
      const dx = ballX - closestX;
      const dy = ballY - closestY;
      const dz = 0 - closestZ;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < r * r && dist < bestDist) {
        bestDist = dist;
        bestGroup = group;
        bestMesh = mesh;
        bestColorKey = group.colorKeys ? group.colorKeys[mi] : group.colorKey;
      }
    }
  }
  return bestGroup ? { group: bestGroup, colorKey: bestColorKey, mesh: bestMesh } : null;
}

let ballColorKey = null;

// 碎裂系统
const DEATH_DURATION = 1.0;
let dying = false;
let deathTimer = 0;
const deathFragments = [];
const deathParticles = [];

function triggerDeath(plateColorKey) {
  dying = true;
  deathTimer = 0;
  deathCount++;
  velZ = 0;
  hideCombo();
  sphere.visible = false; wireMesh.visible = false; ring.visible = false;

  const fragCount = isMobile ? 10 : 25;
  const fragGeo = new THREE.IcosahedronGeometry(BALL_RADIUS * 0.25, 1);
  for (let i = 0; i < fragCount; i++) {
    const fragMat = new THREE.MeshStandardMaterial({
      color: sphereMat.color.clone(), metalness: 0.3, roughness: 0.2,
      emissive: sphereMat.emissive.clone(), transparent: true, opacity: 1.0
    });
    const frag = new THREE.Mesh(fragGeo, fragMat);
    frag.position.set(ballX, ballY, 0);
    scene.add(frag);
    const speed = 3 + Math.random() * 5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    deathFragments.push({
      mesh: frag, mat: fragMat,
      vel: new THREE.Vector3(Math.sin(phi)*Math.cos(theta)*speed, Math.abs(Math.cos(phi))*speed*0.8+2, Math.sin(phi)*Math.sin(theta)*speed),
      angularVel: new THREE.Vector3((Math.random()-0.5)*10, (Math.random()-0.5)*10, (Math.random()-0.5)*10)
    });
  }

  const particleCount = isMobile ? 30 : 80;
  const particleGeo = new THREE.SphereGeometry(BALL_RADIUS * 0.06, 4, 4);
  for (let i = 0; i < particleCount; i++) {
    const pMat = new THREE.MeshBasicMaterial({
      color: [0xff68fd, 0xffe528, 0x15befc, 0xffffff][Math.floor(Math.random() * 4)],
      transparent: true, opacity: 1.0
    });
    const particle = new THREE.Mesh(particleGeo, pMat);
    particle.position.set(ballX, ballY, 0);
    scene.add(particle);
    const speed = 1.5 + Math.random() * 7;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    deathParticles.push({
      mesh: particle, mat: pMat,
      vel: new THREE.Vector3(Math.sin(phi)*Math.cos(theta)*speed, Math.abs(Math.cos(phi))*speed*0.6+1, Math.sin(phi)*Math.sin(theta)*speed),
      life: 0.6 + Math.random() * 0.4
    });
  }

  setTimeout(() => showGameOver(), DEATH_DURATION * 1000);
}

function updateDeath(dt) {
  if (!dying) return;
  deathTimer += dt;
  for (const f of deathFragments) {
    f.vel.y -= 9.8 * dt;
    f.mesh.position.addScaledVector(f.vel, dt);
    f.mesh.rotation.x += f.angularVel.x * dt;
    f.mesh.rotation.y += f.angularVel.y * dt;
    f.mesh.rotation.z += f.angularVel.z * dt;
    f.mat.opacity = Math.max(0, 1 - deathTimer / DEATH_DURATION);
  }
  for (const p of deathParticles) {
    p.vel.y -= 6 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    const lifeRatio = Math.max(0, p.life - deathTimer / DEATH_DURATION);
    p.mat.opacity = lifeRatio;
    p.mesh.scale.setScalar(Math.max(0.01, lifeRatio));
  }
}

function cleanupDeath() {
  for (const f of deathFragments) { scene.remove(f.mesh); f.mat.dispose(); }
  deathFragments.length = 0;
  for (const p of deathParticles) { scene.remove(p.mesh); p.mat.dispose(); }
  deathParticles.length = 0;
}

// 着陆速度更新
function onLandUpdateVelZ() {
  let landingIdx = -1, landingZ = Infinity;
  for (let i = 0; i < groupZList.length; i++) {
    if (Math.abs(groupZList[i]) < landingZ) { landingZ = Math.abs(groupZList[i]); landingIdx = i; }
  }
  if (landingIdx >= 0) {
    const group = trackGroups[landingIdx];
    if (group.type === 1 && group.colorKey && group.colorKey !== 'boost') {
      const cKey = group.colorKey;
      const rgb = COLORS[cKey].rgb;
      sphereMat.color.set(COLORS[cKey].hex);
      sphereMat.emissive.set(new THREE.Color(rgb[0]*0.3/255, rgb[1]*0.3/255, rgb[2]*0.3/255));
      ballColorKey = cKey;
      setBoostParticleColor(cKey);
    }
  }
  let nearestAheadZ = -Infinity;
  for (const z of groupZList) { if (z < -0.5 && z > nearestAheadZ) nearestAheadZ = z; }
  if (nearestAheadZ > -Infinity) {
    const period = getCurrentBouncePeriod();
    velZ = Math.abs(nearestAheadZ) / period;
  }
}

// ===== 着陆特效系统 =====
const landEffects = [];
const RIPPLE_DURATION = 1.0;
const PRESS_DURATION = 0.5;

const rippleVertexShader = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const rippleFragmentShader = `
  uniform vec3 uColor;
  uniform float uProgress;
  varying vec2 vUv;
  void main() {
    vec2 centered = abs(vUv - 0.5) * 2.0;
    float boxDist = max(centered.x, centered.y);
    float innerFill = 1.0 - smoothstep(0.0, 0.08, boxDist);
    float outerFade = 1.0 - smoothstep(0.0, 0.6, boxDist);
    float masterFade = 1.0 - smoothstep(0.3, 1.0, uProgress);
    float alpha = (innerFill * 0.7 + outerFade * 0.3) * masterFade;
    float glow = exp(-boxDist * 3.0) * masterFade * 0.5;
    vec3 col = uColor * (1.0 + glow * 0.5);
    gl_FragColor = vec4(col, alpha + glow * 0.4);
  }
`;

function triggerLandEffect(plateMesh, plateColorKey, plateGroup, plateW, plateD) {
  const baseY = GROUND_Y + PLATE_HEIGHT / 2;
  landEffects.push({ mesh: plateMesh, baseY, timer: 0, duration: PRESS_DURATION, type: 'press' });

  // 手机端跳过涟漪和粒子特效，只保留按压效果
  if (isMobile) return;

  let rgb;
  if (plateColorKey === 'boost') rgb = [220, 220, 255];
  else rgb = COLORS[plateColorKey].rgb;
  const color = new THREE.Color(rgb[0]/255, rgb[1]/255, rgb[2]/255);

  const rippleGeo = new THREE.PlaneGeometry(plateW, plateD);
  const rippleMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uProgress: { value: 0.0 } },
    vertexShader: rippleVertexShader,
    fragmentShader: rippleFragmentShader,
    transparent: true, side: THREE.DoubleSide, depthWrite: false
  });
  const ripple = new THREE.Mesh(rippleGeo, rippleMat);
  ripple.rotation.x = -Math.PI / 2;
  plateMesh.add(ripple);
  ripple.position.set(0, -PLATE_HEIGHT / 2 - 0.005, 0);
  landEffects.push({ mesh: ripple, parentMesh: plateMesh, timer: 0, duration: RIPPLE_DURATION, type: 'ripple', mat: rippleMat });

  const edgeCount = 40;
  const posArr = new Float32Array(edgeCount * 3);
  const edgePositions = [];
  for (let i = 0; i < edgeCount; i++) {
    const edge = Math.floor(Math.random() * 4);
    const t = (Math.random() - 0.5);
    let x, z;
    switch(edge) {
      case 0: x = plateW/2 * t; z = plateD/2; break;
      case 1: x = plateW/2 * t; z = -plateD/2; break;
      case 2: x = plateW/2; z = plateD/2 * t; break;
      case 3: x = -plateW/2; z = plateD/2 * t; break;
    }
    posArr[i*3] = x; posArr[i*3+1] = 0; posArr[i*3+2] = z;
    const len = Math.sqrt(x*x + z*z) || 1;
    edgePositions.push({ x, z, dx: x/len, dz: z/len });
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const particleMat = new THREE.PointsMaterial({
    color: color, size: 0.06, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  particles.rotation.x = -Math.PI / 2;
  plateMesh.add(particles);
  particles.position.set(0, -PLATE_HEIGHT / 2 - 0.005, 0);
  landEffects.push({
    mesh: particles, parentMesh: plateMesh, timer: 0, duration: RIPPLE_DURATION,
    type: 'particles', mat: particleMat, geo: particleGeo, edgePositions, origPositions: posArr.slice()
  });
}

function updateLandEffects(dt) {
  for (let i = landEffects.length - 1; i >= 0; i--) {
    const fx = landEffects[i];
    fx.timer += dt;
    const progress = Math.min(1, fx.timer / fx.duration);
    const eased = 1 - Math.pow(1 - progress, 2);

    if (fx.type === 'press') {
      const t = progress;
      const pressDepth = 0.18;
      if (t < 0.5) fx.mesh.position.y = fx.baseY - pressDepth * t * 2;
      else {
        const ease = (t - 0.5) * 2;
        fx.mesh.position.y = fx.baseY - pressDepth * (1 - ease) + Math.sin(ease * Math.PI) * 0.015;
      }
    } else if (fx.type === 'ripple') {
      fx.mesh.scale.setScalar(1 + eased * 8);
      fx.mat.uniforms.uProgress.value = progress;
    } else if (fx.type === 'particles') {
      const posAttr = fx.geo.getAttribute('position');
      for (let j = 0; j < fx.edgePositions.length; j++) {
        const ep = fx.edgePositions[j];
        const dist = eased * 1.5;
        posAttr.array[j*3]   = fx.origPositions[j*3]   + ep.dx * dist;
        posAttr.array[j*3+1] = Math.sin(progress * Math.PI) * 0.05;
        posAttr.array[j*3+2] = fx.origPositions[j*3+2] + ep.dz * dist;
      }
      posAttr.needsUpdate = true;
      fx.mat.opacity = (1 - progress) * 0.8;
    }

    if (fx.timer >= fx.duration) {
      if (fx.type === 'press') fx.mesh.position.y = fx.baseY;
      else { if (fx.parentMesh) fx.parentMesh.remove(fx.mesh); fx.mesh.geometry.dispose(); if (fx.mat.dispose) fx.mat.dispose(); }
      landEffects.splice(i, 1);
    }
  }
}

// ===== 连击系统 =====
const comboUI = document.getElementById('comboUI');
const comboWord = document.getElementById('comboWord');
const comboCountEl = document.getElementById('comboCount');
let comboCount_ = 0;
let comboVisible = false;
let comboTimeout = null;

function triggerCombo() {
  comboCount_++;
  comboWord.textContent = Math.random() > 0.2 ? 'PERFECT' : 'GREAT';
  comboUI.classList.add('visible');
  comboVisible = true;
  comboWord.classList.remove('pop'); void comboWord.offsetWidth; comboWord.classList.add('pop');
  comboCountEl.textContent = `x${comboCount_}`;
  comboCountEl.classList.remove('bump'); void comboCountEl.offsetWidth; comboCountEl.classList.add('bump');
  if (ballColorKey) {
    const rgb = COLORS[ballColorKey].rgb;
    const glowColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    comboWord.style.textShadow = `0 0 20px ${glowColor}, 0 0 40px ${glowColor}, 0 0 80px rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.4)`;
    comboCountEl.style.textShadow = `0 0 12px ${glowColor}, 0 0 24px rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.3)`;
  }
  if (comboTimeout) clearTimeout(comboTimeout);
  comboTimeout = setTimeout(() => { comboUI.classList.remove('visible'); comboVisible = false; comboCount_ = 0; }, 2000);
}

function hideCombo() {
  comboUI.classList.remove('visible'); comboVisible = false; comboCount_ = 0;
  if (comboTimeout) { clearTimeout(comboTimeout); comboTimeout = null; }
}

// GameOver / Victory UI
const gameOverOverlay = document.getElementById('gameOverOverlay');

function showGameOver() {
  gameOverOverlay.style.display = 'flex';
}
function hideGameOver() {
  gameOverOverlay.style.display = 'none';
}

document.getElementById('continueBtn').addEventListener('click', () => {
  // 免广告直接复活
  hideGameOver();
  sphere.visible = true; wireMesh.visible = true; ring.visible = true;
  sphere.scale.setScalar(1); wireMesh.scale.setScalar(1); ring.scale.setScalar(1);
  dying = false; falling = false;
  ballY = floorContact;
  velY = Math.sqrt(2 * Math.abs(currentGravityY) * INIT_HEIGHT);
  recalcVelZ();
});

document.getElementById('backBtn').addEventListener('click', () => { hideGameOver(); showLevelSelect(); });

// 黑洞系统
const BH_RADIUS = 2.5;
const BH_EVENT_HORIZON = 1.2;
let bhGroup = null, bhParticles = null, bhParticleData = [];
let bhRotation = 0, bhSpawnTimer = 0;
const BH_SPAWN_DURATION = 2.0;

function createBlackHole(z) {
  bhGroup = new THREE.Group();
  bhGroup.position.set(0, GROUND_Y, z);
  scene.add(bhGroup);

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  bhGroup.add(core);

  const accGeo = new THREE.RingGeometry(1.0, BH_RADIUS, 64);
  const accMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uInner: { value: 1.0 }, uOuter: { value: BH_RADIUS } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uInner; uniform float uOuter; varying vec2 vUv;
      void main() {
        vec2 center = vUv - 0.5; float dist = length(center); float angle = atan(center.y, center.x);
        float spiral = sin(angle * 3.0 - uTime * 4.0 + dist * 10.0) * 0.5 + 0.5;
        float radial = 1.0 - smoothstep(uInner / (uInner + uOuter), 1.0, dist * 2.0);
        vec3 col1 = vec3(0.4, 0.2, 1.0); vec3 col2 = vec3(0.2, 0.5, 1.0); vec3 col3 = vec3(1.0, 0.3, 0.8);
        vec3 col = mix(col1, col2, spiral); col = mix(col, col3, pow(spiral, 3.0));
        float alpha = radial * (0.4 + 0.6 * spiral);
        gl_FragColor = vec4(col, alpha * 0.8);
      }
    `,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  bhGroup.add(new THREE.Mesh(accGeo, accMat));

  const glowGeo = new THREE.RingGeometry(BH_RADIUS, BH_RADIUS + 1.5, 64);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      void main() {
        vec2 center = vUv - 0.5; float dist = length(center); float angle = atan(center.y, center.x);
        float spiral = sin(angle * 2.0 - uTime * 2.0 + dist * 8.0) * 0.5 + 0.5;
        float fade = 1.0 - smoothstep(0.0, 1.0, dist * 2.0);
        vec3 col = mix(vec3(0.2, 0.1, 0.6), vec3(0.1, 0.3, 0.8), spiral);
        gl_FragColor = vec4(col, fade * 0.25 * spiral);
      }
    `,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  bhGroup.add(new THREE.Mesh(glowGeo, glowMat));

  const pCount = 300;
  const pPositions = new Float32Array(pCount * 3);
  bhParticleData = [];
  for (let i = 0; i < pCount; i++) {
    bhParticleData.push({
      angle: Math.random() * Math.PI * 2, radius: BH_RADIUS * 0.5 + Math.random() * BH_RADIUS * 2,
      speed: 1.0 + Math.random() * 2.5, yOff: (Math.random() - 0.5) * 1.5,
      ySpeed: (Math.random() - 0.5) * 0.5, shrink: 0.003 + Math.random() * 0.008,
    });
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  bhParticles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xaa88ff, size: 0.06, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  bhGroup.add(bhParticles);
}

function updateBlackHole(dt) {
  if (!bhGroup || !bhParticles) return;
  bhRotation += dt * 0.8;
  if (bhSpawnTimer < BH_SPAWN_DURATION) {
    bhSpawnTimer += dt;
    bhGroup.scale.setScalar(1 - Math.pow(1 - Math.min(1, bhSpawnTimer / BH_SPAWN_DURATION), 3));
  }
  bhGroup.children.forEach(child => {
    if (child.material && child.material.uniforms && child.material.uniforms.uTime) child.material.uniforms.uTime.value += dt;
  });
  bhGroup.rotation.y += dt * 0.3;
  const posAttr = bhParticles.geometry.getAttribute('position');
  for (let i = 0; i < bhParticleData.length; i++) {
    const pd = bhParticleData[i];
    pd.angle += pd.speed * dt;
    pd.radius -= pd.shrink;
    pd.yOff *= 0.998;
    if (pd.radius < 0.3) { pd.radius = BH_RADIUS * 0.8 + Math.random() * BH_RADIUS * 1.5; pd.angle = Math.random() * Math.PI * 2; pd.yOff = (Math.random() - 0.5) * 1.5; }
    posAttr.setXYZ(i, Math.cos(pd.angle) * pd.radius, pd.yOff, Math.sin(pd.angle) * pd.radius);
  }
  posAttr.needsUpdate = true;
}

function cleanupBlackHole() {
  if (bhGroup) {
    bhGroup.traverse(child => { if (child.geometry) child.geometry.dispose(); if (child.material && child.material.dispose) child.material.dispose(); });
    scene.remove(bhGroup); bhGroup = null; bhParticles = null; bhParticleData = [];
  }
}

// 胜利弹窗
const victoryOverlay = document.getElementById('victoryOverlay');
const victoryNextBtn = document.getElementById('victoryNextBtn');
const victoryBackBtn = document.getElementById('victoryBackBtn');
const victoryTitle = document.getElementById('victoryTitle');
const victoryDesc = document.getElementById('victoryDesc');
const victoryStats = document.getElementById('victoryStats');
const victoryStars = document.getElementById('victoryStars');

function showVictory() {
  const lv = getLevel();
  victoryTitle.textContent = 'YOU WIN!';
  victoryDesc.textContent = `成功进入 ${lv.name} 黑洞`;
  victoryStats.textContent = `跳跃 ${hitCount} 次  |  行进 ${Math.floor(totalDistance)} m  |  失误 ${deathCount} 次`;
  const stars = victoryStars.querySelectorAll('.star');
  let starCount = deathCount === 0 ? 3 : deathCount <= 2 ? 2 : 1;
  stars.forEach((s, i) => {
    s.classList.remove('lit', 'pop');
    if (i < starCount) setTimeout(() => s.classList.add('lit', 'pop'), 300 + i * 200);
  });
  unlockNext();
  const hasNext = currentLevel + 1 < LEVELS.length;
  victoryNextBtn.classList.toggle('hidden', !hasNext);
  if (hasNext) victoryNextBtn.textContent = LEVELS[currentLevel + 1].name;
  victoryOverlay.style.display = 'flex';
}
function hideVictory() {
  victoryOverlay.style.display = 'none';
}

victoryNextBtn.addEventListener('click', () => { if (currentLevel + 1 < LEVELS.length) { currentLevel++; hideVictory(); startGame(); } });
victoryBackBtn.addEventListener('click', () => { hideVictory(); showLevelSelect(); });

// 关卡名称闪现
const levelAnnounce = document.getElementById('levelAnnounce');
let levelAnnounceTimer = null;

function showLevelAnnounce() {
  const lv = getLevel();
  document.getElementById('levelNum').textContent = `LEVEL ${currentLevel + 1}`;
  document.getElementById('levelTitle').textContent = lv.name;
  document.getElementById('levelSub').textContent = `进入黑洞 — ${lv.nameEn}`;
  levelAnnounce.classList.remove('show'); void levelAnnounce.offsetWidth; levelAnnounce.classList.add('show');
  if (levelAnnounceTimer) clearTimeout(levelAnnounceTimer);
  levelAnnounceTimer = setTimeout(() => levelAnnounce.classList.remove('show'), 2600);
}

function spawnBlackHole() {
  blackHoleActive = true; bhSpawnTimer = 0;
  const z = -VISIBLE_DEPTH / 5 * 3 - 5;
  createBlackHole(z);
  bhGroup.scale.setScalar(0);
  targetDistance = totalDistance + Math.abs(z);
}

function checkBlackHoleCollision() {
  if (!bhGroup || winning || dying || falling) return;
  const bhPos = bhGroup.position;
  const dist = Math.sqrt((ballX-bhPos.x)**2 + (ballY-bhPos.y)**2 + (0-bhPos.z)**2);
  if (dist < BH_EVENT_HORIZON) {
    winning = true; winTimer = 0; velZ = 0; falling = false;
    hideCombo(); targetDistance = totalDistance;
  }
}

function updateWin(dt) {
  if (!winning) return;
  winTimer += dt;
  if (bhGroup && sphere.visible) {
    const bhPos = bhGroup.position;
    const speed = 3 + winTimer * 5;
    ballX += (bhPos.x - ballX) * dt * speed;
    ballY += (bhPos.y - ballY) * dt * speed;
    const scale = Math.max(0.01, 1 - winTimer * 1.5);
    sphere.scale.setScalar(scale); wireMesh.scale.setScalar(scale); ring.scale.setScalar(scale);
    if (scale <= 0.05) { sphere.visible = false; wireMesh.visible = false; ring.visible = false; }
  }
  updateBlackHole(dt);
  if (winTimer > 1.5) { winning = false; showVictory(); }
}

// 距离 UI
const distCurrent = document.getElementById('distCurrent');
const distTarget  = document.getElementById('distTarget');
const levelNameEl = document.getElementById('levelName');

function updateDistanceUI() {
  const d = Math.floor(totalDistance);
  distCurrent.innerHTML = `${d}<span class="unit">m</span>`;
  if (targetDistance !== null) {
    distTarget.textContent = `目标: ${Math.floor(targetDistance)} m`;
    if (!distTarget.classList.contains('revealed')) distTarget.classList.add('revealed');
  }
}

function resetDistanceUI() {
  totalDistance = 0; targetDistance = null;
  distTarget.textContent = '目标: ??? m';
  distTarget.classList.remove('revealed');
  levelNameEl.textContent = getLevel().name;
  updateDistanceUI();
}

const FALL_RESET_Y = -30;
let hitCount = 0;
let deathCount = 0;
let totalDistance = 0;
let blackHoleActive = false;
let winning = false;
let winTimer = 0;
let targetDistance = null;

function resetGame() {
  hideCombo(); hideVictory(); showLevelAnnounce(); resetDistanceUI();
  cleanupBlackHole();
  hitCount = 0; deathCount = 0;
  blackHoleActive = false; winning = false; winTimer = 0;
  boostTimer = 0; currentGravityY = GRAVITY_Y;
  boostCharging = false; boostPendingDecel = false;
  boostParticleVisible = false; boostParticles.visible = false; boostFadeAlpha = 0;
  while (trackGroups.length > 0) removeGroup(0);
  generateInitialGroups();
  ballX = 0; ballXTarget = 0; ballY = floorContact;
  velY = Math.sqrt(2 * _g * INIT_HEIGHT);
  falling = false; dying = false; ballColorKey = null;
  sphere.scale.setScalar(1); wireMesh.scale.setScalar(1); ring.scale.setScalar(1);

  if (trackGroups.length > 0 && trackGroups[0].type === 1 && trackGroups[0].colorKey) {
    const cKey = trackGroups[0].colorKey;
    const rgb = COLORS[cKey].rgb;
    sphereMat.color.set(COLORS[cKey].hex);
    sphereMat.emissive.set(new THREE.Color(rgb[0]*0.3/255, rgb[1]*0.3/255, rgb[2]*0.3/255));
    ballColorKey = cKey; setBoostParticleColor(cKey);
  } else {
    sphereMat.color.set(0x4488ff); sphereMat.emissive.set(0x112244); ballColorKey = null; setBoostParticleColor(null);
  }

  sphere.visible = true; wireMesh.visible = true; ring.visible = true;
  cleanupDeath(); hideGameOver();

  lastLongTrackColor = null;
  for (const g of trackGroups) { if (g.type === 1) lastLongTrackColor = g.colorKey; }

  if (groupZList.length > 1) velZ = Math.abs(groupZList[1]) / BOUNCE_PERIOD;
  else velZ = 2.0;
}

// 初始化
if (groupZList.length > 1) velZ = Math.abs(groupZList[1]) / BOUNCE_PERIOD;
else velZ = 2.0;

if (trackGroups.length > 0 && trackGroups[0].type === 1 && trackGroups[0].colorKey) {
  const initColor = trackGroups[0].colorKey;
  const initRgb = COLORS[initColor].rgb;
  sphereMat.color.set(COLORS[initColor].hex);
  sphereMat.emissive.set(new THREE.Color(initRgb[0]*0.3/255, initRgb[1]*0.3/255, initRgb[2]*0.3/255));
  ballColorKey = initColor;
  setBoostParticleColor(initColor);
}

let lastTime = performance.now() / 1000;
let t = 0;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now() / 1000;
  let dt = now - lastTime;
  lastTime = now;
  dt = Math.min(dt, 0.05);
  t += dt;

  if (isPaused || levelSelectOverlay.style.display === 'flex' || victoryOverlay.style.display === 'flex' || gameOverOverlay.style.display === 'flex') {
    renderer.render(scene, camera);
    return;
  }

  // X 轴鼠标/触摸控制
  if (!dying) {
    ballXTarget += mouseDeltaX * MOUSE_SENSITIVITY;
    ballXTarget = Math.max(-15, Math.min(15, ballXTarget));
    const factor = 1 - Math.pow(1 - LERP_SMOOTHNESS, dt * 60);
    ballX += (ballXTarget - ballX) * factor;
  }
  mouseDeltaX = 0;

  // Y 轴弹跳
  if (!dying) {
    velY += currentGravityY * dt;
    ballY += velY * dt;
  }

  // 加速计时
  if (boostTimer > 0) {
    boostTimer -= dt;
    if (boostTimer <= 0) { boostTimer = 0; boostPendingDecel = true; }
  }

  if (!falling && !dying) {
    if (ballY <= floorContact && velY < 0) {
      const hit = findCollisionWithAnyGroup();
      if (hit) {
        const { group, colorKey } = hit;
        if (group.type === 4) {
          ballY = floorContact;
          boostPendingDecel = false;
          velY = Math.sqrt(2 * Math.abs(currentGravityY) * INIT_HEIGHT);
          currentGravityY = GRAVITY_Y * BOOST_GRAVITY_MULT;
          boostTimer = BOOST_DURATION;
          if (!boostCharging) { boostCharging = true; velZ = 0; }
          else { boostCharging = false; onLandUpdateVelZ(); }
          if (hit.mesh) triggerLandEffect(hit.mesh, 'boost', hit.group, LONG_SIZE_X, LONG_SIZE_Z);
          triggerCombo(); hitCount++;
          if (hitCount >= getLevel().winHits && !blackHoleActive) spawnBlackHole();
        } else if (group.type !== 1 && ballColorKey && colorKey && ballColorKey !== colorKey) {
          triggerDeath(colorKey);
        } else {
          ballY = floorContact;
          if (boostPendingDecel) {
            boostPendingDecel = false;
            currentGravityY = GRAVITY_Y;
            velY = Math.sqrt(2 * Math.abs(currentGravityY) * INIT_HEIGHT);
            boostCharging = true; velZ = 0;
          } else if (boostCharging) {
            boostCharging = false;
            velY = Math.abs(velY);
            onLandUpdateVelZ();
          } else {
            velY = Math.abs(velY);
            onLandUpdateVelZ();
          }
          if (hit.mesh && hit.colorKey) {
            const pw = hit.group.type === 1 ? LONG_SIZE_X : SQ_SIZE;
            const pd = hit.group.type === 1 ? LONG_SIZE_Z : SQ_SIZE;
            triggerLandEffect(hit.mesh, hit.colorKey, hit.group, pw, pd);
          }
          triggerCombo(); hitCount++;
          if (hitCount >= getLevel().winHits && !blackHoleActive) spawnBlackHole();
        }
      } else {
        velY = -Math.abs(velY);
        falling = true; velZ = 0;
        if (boostPendingDecel) { boostPendingDecel = false; currentGravityY = GRAVITY_Y; }
      }
    }
    // 最高点修正
    if (velY <= 0 && (velY - currentGravityY * dt) > 0) {
      if (ballY - floorContact < INIT_HEIGHT * 0.99) { ballY = floorContact + INIT_HEIGHT; velY = 0; }
    }
  } else if (falling) {
    if (ballY < FALL_RESET_Y) { deathCount++; resetGame(); }
  } else if (dying) {
    updateDeath(dt);
  }

  if (winning) { updateWin(dt); }
  else {
    if (blackHoleActive) {
      updateBlackHole(dt);
      checkBlackHoleCollision();
      if (!winning && targetDistance !== null && totalDistance >= targetDistance) {
        winning = true; winTimer = 0; velZ = 0; falling = false;
        hideCombo(); targetDistance = totalDistance;
      }
    }
  }

  updateTrack(velZ * dt);

  if (!dying) {
    sphere.position.set(ballX, ballY, 0);
    wireMesh.position.set(ballX, ballY, 0);
    ring.position.set(ballX, ballY, 0);
    sphere.rotation.y += 0.25 * dt;
    sphere.rotation.x  = Math.sin(t * 0.4) * 0.1;
    wireMesh.rotation.y = sphere.rotation.y;
    wireMesh.rotation.x = sphere.rotation.x;
    ring.rotation.y += 0.35 * dt;
    ring.rotation.x  = Math.sin(t * 0.3) * 0.15;
  }

  movingLight.position.set(Math.cos(t * 0.7) * 2.8, ballY + Math.sin(t * 0.5) * 1.0, Math.sin(t * 0.7) * 2.8);
  lightBall.position.copy(movingLight.position);

  controls.update();
  updateLandEffects(dt);
  updateBoostParticles(dt);
  updateDistanceUI();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
