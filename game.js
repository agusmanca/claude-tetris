'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const GRID_COLORS = { dark: '#22222e', light: '#d6d6e2' };

// ---- Sistema de habilidades: constantes ----
const QUEUE_SIZE = 5;        // cantidad de piezas futuras que se mantienen generadas
const MAX_CHARGES = 3;       // tope de cargas acumulables en el pool compartido
const CHARGE_PER_LINES = 8;  // 1 carga cada 8 líneas completadas
const CHARGE_PER_SCORE = 1000; // 1 carga cada 1000 puntos
const PEEK_DURATION_MS = 6000;  // cuánto se muestra la cola extendida
const SLOW_DURATION_MS = 10000; // duración del efecto de ralentización

// ---- Récords locales: constantes ----
const HIGHSCORES_KEY = 'tetris.highscores'; // namespace en localStorage
const MAX_HIGHSCORES = 5;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const queueCanvas = document.getElementById('queue-canvas');
const queueCtx = queueCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const chargesEl = document.getElementById('charges');
const skillRowEls = {
  peek: document.querySelector('.skill-row[data-skill="peek"]'),
  swap: document.querySelector('.skill-row[data-skill="swap"]'),
  slow: document.querySelector('.skill-row[data-skill="slow"]'),
  undo: document.querySelector('.skill-row[data-skill="undo"]'),
};

// ---- Récords locales: referencias DOM ----
const sidebarHsEls = {
  list: document.getElementById('sidebar-highscores-list'),
  bestCombo: document.getElementById('sidebar-best-combo'),
  maxLines: document.getElementById('sidebar-max-lines'),
};
const overlayHsEls = {
  list: document.getElementById('overlay-highscores-list'),
  bestCombo: document.getElementById('overlay-best-combo'),
  maxLines: document.getElementById('overlay-max-lines'),
};
const clearHsBtn = document.getElementById('clear-highscores-btn');
const hsFormSection = document.getElementById('highscore-form');
const hsNameInput = document.getElementById('highscore-name-input');
const hsSaveBtn = document.getElementById('highscore-save-btn');

let board, current, queue, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let theme, gridLineColor;
let skills;
let combo, comboBestThisRun; // combo actual y mejor combo alcanzado en la partida en curso

function applyTheme(name) {
  theme = name === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('light-mode', theme === 'light');
  gridLineColor = GRID_COLORS[theme];
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  localStorage.setItem('theme', theme);
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece(excludeType) {
  let type;
  do {
    type = Math.floor(Math.random() * 7) + 1;
  } while (type === excludeType);
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function refillQueue() {
  while (queue.length < QUEUE_SIZE) queue.push(randomPiece());
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  skills.saveSnapshot();
  merge();
  const cleared = clearLines();
  // Combo: sube mientras se sigan limpiando líneas en fijadas sucesivas,
  // se resetea apenas una pieza fija sin limpiar ninguna.
  if (cleared > 0) {
    combo++;
    comboBestThisRun = Math.max(comboBestThisRun, combo);
  } else {
    combo = 0;
  }
  spawn();
}

function spawn() {
  current = queue.shift();
  refillQueue();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  skills.syncCharges(lines, score);
  renderSkillsHUD();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridLineColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = queue[0].shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// Dibuja las QUEUE_SIZE piezas siguientes apiladas verticalmente (habilidad "Ver siguientes 5").
function drawQueuePreview() {
  const QB = 22;
  const slotH = 52;
  queueCtx.clearRect(0, 0, queueCanvas.width, queueCanvas.height);
  queue.forEach((piece, i) => {
    const shape = piece.shape;
    const offX = Math.floor((4 - shape[0].length) / 2);
    const offY = Math.floor((4 - shape.length) / 2);
    const baseY = i * slotH / QB;
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        drawBlock(queueCtx, offX + c, baseY + offY + r, shape[r][c], QB);
  });
}

// ==========================================================================
// Récords locales: Top 5 + estadísticas históricas (localStorage)
// ==========================================================================
const HighScores = {
  // Estructura vacía, usada como fallback ante ausencia o corrupción de datos.
  empty() {
    return { scores: [], bestCombo: 0, maxLines: 0 };
  },

  // Lee y valida los datos guardados; nunca lanza: ante localStorage vacío o
  // JSON corrupto/con forma inesperada, devuelve empty() sin romper el juego.
  load() {
    try {
      const raw = localStorage.getItem(HIGHSCORES_KEY);
      if (!raw) return this.empty();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scores)) return this.empty();
      const scores = parsed.scores
        .filter(e => e && typeof e.score === 'number')
        .map(e => ({
          name: typeof e.name === 'string' && e.name ? e.name.slice(0, 12) : '???',
          score: e.score,
          lines: typeof e.lines === 'number' ? e.lines : 0,
          level: typeof e.level === 'number' ? e.level : 1,
          date: typeof e.date === 'string' ? e.date : '',
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_HIGHSCORES);
      return {
        scores,
        bestCombo: typeof parsed.bestCombo === 'number' ? parsed.bestCombo : 0,
        maxLines: typeof parsed.maxLines === 'number' ? parsed.maxLines : 0,
      };
    } catch {
      return this.empty();
    }
  },

  save(data) {
    try {
      localStorage.setItem(HIGHSCORES_KEY, JSON.stringify(data));
    } catch {
      // localStorage puede fallar (modo privado, cuota excedida, etc.): el
      // juego sigue funcionando, simplemente no persiste el récord.
    }
  },

  clear() {
    try { localStorage.removeItem(HIGHSCORES_KEY); } catch {}
    return this.empty();
  },

  // ¿Esta puntuación entra al Top 5?
  qualifies(data, score) {
    return data.scores.length < MAX_HIGHSCORES || score > data.scores[data.scores.length - 1].score;
  },

  // Inserta la entrada, reordena desc por score y recorta a MAX_HIGHSCORES.
  // Devuelve el índice de la entrada insertada (para resaltarla al renderizar),
  // o -1 si terminó quedando fuera del Top 5 (empates en el límite).
  add(data, entry) {
    data.scores.push(entry);
    data.scores.sort((a, b) => b.score - a.score);
    data.scores = data.scores.slice(0, MAX_HIGHSCORES);
    return data.scores.indexOf(entry);
  },

  // Renderiza la tabla Top 5 + estadísticas en los elementos DOM indicados.
  // `highlightIndex` (opcional) resalta la fila recién ingresada.
  render(els, data, highlightIndex) {
    if (els.list) {
      els.list.innerHTML = '';
      if (data.scores.length === 0) {
        const li = document.createElement('li');
        li.className = 'highscore-empty';
        li.textContent = 'Sin récords todavía';
        els.list.appendChild(li);
      } else {
        data.scores.forEach((entry, i) => {
          const li = document.createElement('li');
          li.className = 'highscore-row' + (i === highlightIndex ? ' highscore-new' : '');
          li.title = `Nivel ${entry.level} · ${entry.lines} líneas`;
          const name = document.createElement('span');
          name.className = 'highscore-name';
          name.textContent = entry.name;
          const val = document.createElement('span');
          val.className = 'highscore-value';
          val.textContent = entry.score.toLocaleString();
          li.appendChild(name);
          li.appendChild(val);
          els.list.appendChild(li);
        });
      }
    }
    if (els.bestCombo) els.bestCombo.textContent = data.bestCombo;
    if (els.maxLines) els.maxLines.textContent = data.maxLines;
  },
};

function renderSidebarHighScores() {
  HighScores.render(sidebarHsEls, HighScores.load(), -1);
}

// Muestra el formulario para ingresar el nombre cuando la partida entra al
// Top 5, y engancha el guardado (botón + Enter en el input).
function showHighScoreForm(data) {
  hsFormSection.classList.remove('hidden');
  hsNameInput.value = '';
  HighScores.render(overlayHsEls, data, -1);
  hsNameInput.focus();

  hsSaveBtn.onclick = () => {
    const name = (hsNameInput.value || '').trim().slice(0, 12) || 'JUGADOR';
    const entry = { name, score, lines, level, date: new Date().toISOString() };
    const fresh = HighScores.load();
    fresh.maxLines = Math.max(fresh.maxLines, lines);
    fresh.bestCombo = Math.max(fresh.bestCombo, comboBestThisRun);
    const idx = HighScores.add(fresh, entry);
    HighScores.save(fresh);
    hsFormSection.classList.add('hidden');
    HighScores.render(overlayHsEls, fresh, idx);
    renderSidebarHighScores();
  };
}

hsNameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') hsSaveBtn.click();
});

clearHsBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar todos los récords y estadísticas guardadas? Esta acción no se puede deshacer.')) return;
  const data = HighScores.clear();
  renderSidebarHighScores();
  // Si el overlay de Game Over está visible, refrescamos también su tabla.
  if (gameOver && !overlay.classList.contains('hidden')) {
    HighScores.render(overlayHsEls, data, -1);
  }
});

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  const data = HighScores.load();
  data.maxLines = Math.max(data.maxLines, lines);
  data.bestCombo = Math.max(data.bestCombo, comboBestThisRun);

  if (HighScores.qualifies(data, score)) {
    HighScores.save(data); // persistimos combo/líneas ya, el nombre se agrega al guardar el formulario
    showHighScoreForm(data);
  } else {
    HighScores.save(data);
    hsFormSection.classList.add('hidden');
    HighScores.render(overlayHsEls, data, -1);
  }
  renderSidebarHighScores();

  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  const wasPeeking = performance.now() < skills.peekUntil;
  const wasSlowing = performance.now() < skills.slowUntil;
  if (dropAccum >= effectiveDropInterval(ts)) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if(gameOver) return;
  // Si un efecto temporal (peek/slow) acaba de expirar, refrescamos el HUD/panel una sola vez.
  const now = performance.now();
  if (wasPeeking && now >= skills.peekUntil) {
    queueCanvas.classList.add('hidden');
  }
  if (wasSlowing && now >= skills.slowUntil) {
    renderSkillsHUD();
  }
  draw();
  animId = requestAnimationFrame(loop);
}

// ==========================================================================
// Sistema de habilidades cargables
// ==========================================================================

// El tablero (matriz de arrays) se empaqueta en un Uint8Array plano para que
// el snapshot de Undo sea compacto (ROWS*COLS bytes) y su copia sea O(n) trivial.
function packBoard(b) {
  const flat = new Uint8Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      flat[r * COLS + c] = b[r][c];
  return flat;
}

function unpackBoard(flat) {
  const b = createBoard();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      b[r][c] = flat[r * COLS + c];
  return b;
}

// Devuelve el dropInterval "efectivo" en este instante, aplicando el efecto
// de ralentización si está activo, sin tocar el dropInterval real (que sigue
// siendo la fuente de verdad del nivel, recalculado en clearLines()).
function effectiveDropInterval(now) {
  return now < skills.slowUntil ? dropInterval * 2 : dropInterval;
}

// Definición de las 4 habilidades: cada una es una función desacoplada que
// devuelve `true` si pudo aplicarse (consume 1 carga) o `false` si no
// (la carga no se descuenta).
const SKILLS = {
  peek: {
    key: 'Digit1',
    label: 'Ver 5',
    run() {
      skills.peekUntil = performance.now() + PEEK_DURATION_MS;
      drawQueuePreview();
      queueCanvas.classList.remove('hidden');
      return true;
    },
  },
  swap: {
    key: 'Digit2',
    label: 'Swap',
    run() {
      const candidate = randomPiece(current.type);
      const kicks = [0, -1, 1, -2, 2];
      for (const kick of kicks) {
        const x = current.x + kick;
        const y = collide(candidate.shape, x, current.y) ? 0 : current.y;
        if (!collide(candidate.shape, x, y)) {
          current.type = candidate.type;
          current.shape = candidate.shape;
          current.x = x;
          current.y = y;
          return true;
        }
      }
      return false; // no hay ninguna posición válida para la nueva pieza
    },
  },
  slow: {
    key: 'Digit3',
    label: 'Slow 10s',
    run() {
      skills.slowUntil = performance.now() + SLOW_DURATION_MS;
      return true;
    },
  },
  undo: {
    key: 'Digit4',
    label: 'Undo',
    run() {
      return skills.restoreSnapshot();
    },
  },
};

class SkillManager {
  constructor({ maxCharges, chargePerLines, chargePerScore }) {
    this.maxCharges = maxCharges;
    this.chargePerLines = chargePerLines;
    this.chargePerScore = chargePerScore;
    this.reset();
  }

  reset() {
    this.charges = 0;
    this.grantedFromLines = 0;
    this.grantedFromScore = 0;
    this.peekUntil = 0;
    this.slowUntil = 0;
    this.snapshot = null;
  }

  // Otorga cargas nuevas de forma idempotente: usa contadores acumulativos
  // (nunca retrocede con Math.max) para que un Undo -que baja score/lines-
  // no permita "farmear" cargas repitiendo fijar+deshacer la misma jugada.
  syncCharges(currentLines, currentScore) {
    const earnedFromLines = Math.floor(currentLines / this.chargePerLines);
    const earnedFromScore = Math.floor(currentScore / this.chargePerScore);
    const gain = (earnedFromLines - this.grantedFromLines) + (earnedFromScore - this.grantedFromScore);
    if (gain > 0) this.charges = Math.min(this.maxCharges, this.charges + gain);
    this.grantedFromLines = Math.max(this.grantedFromLines, earnedFromLines);
    this.grantedFromScore = Math.max(this.grantedFromScore, earnedFromScore);
  }

  activate(id) {
    if (paused || gameOver) return false;
    const skill = SKILLS[id];
    if (!skill || this.charges < 1) return false;
    const applied = skill.run();
    if (applied) {
      this.charges--;
      updateHUD();
    }
    return applied;
  }

  // Guarda un snapshot compacto justo antes de fijar la pieza actual, con la
  // pieza en la posición previa al lock (no re-spawneada) para poder devolverla al juego.
  saveSnapshot() {
    this.snapshot = {
      board: packBoard(board),
      piece: { type: current.type, shape: current.shape.map(row => [...row]), x: current.x, y: current.y },
      queue: queue.map(p => ({ type: p.type, shape: p.shape.map(row => [...row]), x: p.x, y: p.y })),
      score, lines, level, dropInterval, combo, comboBestThisRun,
    };
  }

  restoreSnapshot() {
    const snap = this.snapshot;
    if (!snap) return false;
    board = unpackBoard(snap.board);
    current = { type: snap.piece.type, shape: snap.piece.shape.map(row => [...row]), x: snap.piece.x, y: snap.piece.y };
    queue = snap.queue.map(p => ({ type: p.type, shape: p.shape.map(row => [...row]), x: p.x, y: p.y }));
    score = snap.score;
    lines = snap.lines;
    level = snap.level;
    dropInterval = snap.dropInterval;
    combo = snap.combo;
    comboBestThisRun = snap.comboBestThisRun;
    this.snapshot = null; // no encadenable: solo revierte la última jugada
    drawNext();
    return true;
  }
}

// Refleja cargas y estado de cada habilidad en el panel lateral.
function renderSkillsHUD() {
  chargesEl.textContent = `${skills.charges}/${skills.maxCharges}`;
  const now = performance.now();
  const active = {
    peek: now < skills.peekUntil,
    swap: false,
    slow: now < skills.slowUntil,
    undo: !!skills.snapshot,
  };
  for (const id in skillRowEls) {
    const el = skillRowEls[id];
    if (!el) continue;
    el.classList.toggle('active', active[id]);
    el.classList.toggle('disabled', skills.charges < 1 && !active[id]);
  }
}

function init() {
  applyTheme(localStorage.getItem('theme') || 'dark');
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  combo = 0;
  comboBestThisRun = 0;
  skills = new SkillManager({
    maxCharges: MAX_CHARGES,
    chargePerLines: CHARGE_PER_LINES,
    chargePerScore: CHARGE_PER_SCORE,
  });
  queueCanvas.classList.add('hidden');
  queue = [];
  refillQueue();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  hsFormSection.classList.add('hidden');
  renderSidebarHighScores();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
    case 'Digit1':
      skills.activate('peek');
      break;
    case 'Digit2':
      skills.activate('swap');
      break;
    case 'Digit3':
      skills.activate('slow');
      break;
    case 'Digit4':
      skills.activate('undo');
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);
themeToggleBtn.addEventListener('click', () => applyTheme(theme === 'light' ? 'dark' : 'light'));

init();
