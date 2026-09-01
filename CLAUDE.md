# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A classic Tetris implementation in vanilla JavaScript with HTML5 Canvas. No dependencies, no build step, no package.json.

## Running the game

There is no build/lint/test tooling in this repo. To run it:

```bash
start index.html        # Windows: open directly in the browser
# or serve it locally (recommended, avoids any file:// quirks)
python3 -m http.server 8000
npx serve .
```

Then open the page (or `http://localhost:8000`) in a browser. Verify changes manually by playing the game — there is no automated test suite.

## Architecture

Three files, no modules/bundler:

- `index.html` — DOM structure: the `#board` canvas (300×600, i.e. `COLS×BLOCK` by `ROWS×BLOCK`), the `#next-canvas` preview, the `#queue-canvas` (hidden 5-piece lookahead used by the Peek skill), the score/lines/level panel, the SKILLS panel (`#charges` plus one `<li class="skill-row" data-skill="...">` per skill), the always-visible TOP 5 sidebar panel (`#sidebar-highscores-list`, `#clear-highscores-btn`), the `#theme-toggle` button, and the pause/game-over overlay (which also holds `#highscore-form` and `#overlay-highscores-list` for the Game Over case).
- `style.css` — a two-theme system built on CSS custom properties: all colors are declared as `var(--…)` tokens on `:root` (dark, default) and overridden on `body.light-mode` (light). Also defines the `.skill-row` `active`/`disabled` states, `.queue-preview.hidden`, and the `.highscore-row`/`.highscore-new` styles for the records tables.
- `game.js` — all game logic, organized around a small set of global state variables (`board`, `current`, `queue`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, `theme`, `skills`, etc.) and functions operating on them:
  - **Board model**: a `ROWS × COLS` matrix; each cell is `0` (empty) or a piece-color index (1–7).
  - **Pieces**: the 7 tetrominoes are defined as square matrices in `PIECES`. Rotation (`rotateCW`) is done via transpose + row reversal, not stored per-orientation.
  - **Piece queue**: `queue` holds `QUEUE_SIZE` (5) upcoming pieces; `refillQueue()` tops it back up and `spawn()` does `queue.shift()` then refills. `drawNext()` renders `queue[0]` in the small preview; `drawQueuePreview()` renders all five into `#queue-canvas` (used by the Peek skill). `randomPiece(excludeType)` takes an optional type to exclude, used by the Swap skill so it doesn't hand back the same piece.
  - **Collision** (`collide`): checks board bounds and existing fixed blocks.
  - **Wall kicks** (`tryRotate`): after rotating, tries offsets `[0, -1, 1, -2, 2]` columns until a non-colliding position is found. The Swap skill reuses the same offsets to place the replacement piece.
  - **Locking** (`lockPiece`): the single lock path used by `hardDrop()`, `softDrop()`, and the gravity branch of `loop()`. Calls `skills.saveSnapshot()` **before** `merge()` — that ordering is what makes Undo possible.
  - **Game loop** (`loop`): driven by `requestAnimationFrame`; accumulates elapsed time (`dropAccum`) and advances the piece one row once `effectiveDropInterval(ts)` is exceeded. It also detects the frame a timed skill effect (peek/slow) expires and does one-shot cleanup (hide `#queue-canvas`, re-render the skills HUD).
  - **Line clearing** (`clearLines`): scans bottom-up, splices full rows out and unshifts empty rows at the top.
  - **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` multiplied by `level`; hard drop adds 2 pts/row dropped, soft drop adds 1 pt/row.
  - **Leveling/speed**: level = `floor(lines / 10) + 1`; `dropInterval = max(100, 1000 - (level - 1) * 90)` ms. This is the level's source of truth and is never mutated by a skill. The loop instead reads `effectiveDropInterval(ts)`, which doubles `dropInterval` while the Slow skill is active.
  - **Ghost piece** (`ghostY`): projects the current piece straight down to its landing row, drawn at `globalAlpha = 0.2`.

Control flow: `init()` restores the saved theme, builds the board, constructs the `SkillManager`, seeds the piece queue, and starts the `requestAnimationFrame` loop. `spawn()` shifts the next piece off `queue` and refills it; if the newly spawned piece immediately collides, `endGame()` fires and the Game Over overlay is shown. Keyboard input (`keydown` listener) handles movement/rotation/soft-drop/hard-drop/pause/skills, then calls `updateHUD()`; `P` toggles pause independent of `gameOver` state; digits `1`–`4` call `skills.activate(id)`.

Tunable constants live at the top of `game.js`: `COLS`, `ROWS`, `BLOCK`, `COLORS`, `LINE_SCORES`, initial `dropInterval`, and the skills constants (`QUEUE_SIZE`, `MAX_CHARGES`, `CHARGE_PER_LINES`, `CHARGE_PER_SCORE`, `PEEK_DURATION_MS`, `SLOW_DURATION_MS`). If `COLS`, `ROWS`, or `BLOCK` change, update the `#board` canvas `width`/`height` in `index.html` to match (`COLS × BLOCK` and `ROWS × BLOCK`).

Conventions: `'use strict'`, plain globals, no modules/bundler, no build step. In-code comments and all user-facing UI strings are in **Spanish** — match that when editing `game.js` or `index.html`.

README.md is in Spanish and contains architecture notes for the base game in more detail — consult it for prose explanations, but note it predates the theme toggle and skills system described below and hasn't been updated for them yet.

### Theme system

Two layers, and both must be kept in sync when changing a color:

- CSS-driven UI reads the custom-property tokens in `style.css` (`:root` for dark, `body.light-mode` for light).
- The board **canvas** can't read CSS variables, so its grid-line color lives separately in the JS map `GRID_COLORS` (`game.js`) and is applied to `gridLineColor` inside `drawGrid()`.

`applyTheme(name)` toggles the `body.light-mode` class, updates `gridLineColor`, swaps the toggle button's emoji, and persists the choice to `localStorage['theme']`; `init()` reads it back on load. **Recipe**: to change a themed color, edit the token in both `:root` and `body.light-mode`; if it affects the board canvas, also update the matching `GRID_COLORS` entry.

### Skills system

A shared charge economy that unlocks four active abilities (keys `1`–`4`), implemented mostly in the `SkillManager` class and the `SKILLS` registry:

- **Charges**: one shared pool, capped at `MAX_CHARGES`. `SkillManager.syncCharges()` (called every `updateHUD()`) grants 1 charge per `CHARGE_PER_LINES` lines cleared and per `CHARGE_PER_SCORE` points, tracked via cumulative `grantedFromLines`/`grantedFromScore` high-water marks that never decrease. This is deliberate: it stops Undo — which rolls `score`/`lines` back — from being farmed by repeatedly locking and undoing the same play. Preserve this property if you touch charge accounting.
- **`SKILLS` registry**: each entry is `{ key, label, run() }`; `run()` returns `true` only if the skill actually applied. `SkillManager.activate(id)` decrements a charge **only when `run()` returns `true`**, so a skill that can't apply (Swap finds no valid placement, Undo has no snapshot) costs nothing.
- **The four skills**: `peek` — reveals the 5-piece queue in `#queue-canvas` for `PEEK_DURATION_MS`. `swap` — replaces the falling piece with a different random type, reusing `tryRotate`'s kick offsets to find a valid spot. `slow` — sets `slowUntil` for `SLOW_DURATION_MS`, halving effective fall speed via `effectiveDropInterval()`. `undo` — restores the last lock snapshot.
- **Undo snapshot**: `saveSnapshot()` (called from `lockPiece()`, before `merge()`) packs the board into a flat `Uint8Array` via `packBoard()`/`unpackBoard()` and deep-copies the current piece, queue, score, lines, level, and dropInterval. `restoreSnapshot()` restores all of it and clears the snapshot — undo is single-step, not chainable.
- **Timed effects**: `peekUntil`/`slowUntil` are `performance.now()` deadlines, not `setTimeout` timers; `loop()` compares before/after each frame to detect expiry and do one-shot cleanup.
- **HUD**: `renderSkillsHUD()` drives the `active`/`disabled` classes on the `.skill-row[data-skill]` elements (looked up once into `skillRowEls`) and updates the `#charges` counter.

**Adding a new skill** touches all three files:
1. `game.js` — add an entry to `SKILLS` with a `run()` that returns a boolean.
2. `game.js` — add a `case` in the `keydown` switch calling `skills.activate('<id>')`.
3. `index.html` — add `<li class="skill-row" data-skill="<id>"><kbd>N</kbd> Label</li>`.
4. `game.js` — add the matching entry to `skillRowEls` and to the `active` map in `renderSkillsHUD()`.

### High scores system

A local Top 5 leaderboard plus two historical stats (best combo, max lines), persisted to `localStorage['tetris.highscores']` and implemented in the `HighScores` object plus a small amount of state in `game.js`:

- **Storage shape**: `{ scores: [{name, score, lines, level, date}, ...], bestCombo, maxLines }`, `scores` capped at `MAX_HIGHSCORES` (5) and kept sorted descending by `score`. `HighScores.load()`/`save()`/`clear()` are the only code that touches the key; `load()` never throws — missing data or corrupt/unexpected-shape JSON both fall back to `HighScores.empty()`, following the same defensive-read pattern as `applyTheme`'s `localStorage['theme']`.
- **Combo tracking**: `combo` (current streak) and `comboBestThisRun` (this game's peak) are plain globals reset in `init()`. `lockPiece()` increments `combo` when `clearLines()` reports `cleared > 0`, resets it to `0` otherwise, and both fields ride along in the Undo snapshot (`saveSnapshot()`/`restoreSnapshot()`) so Undo reverts combo state too — this is independent of the skills charge economy and must not feed it.
- **Game Over flow**: `endGame()` loads the persisted data, folds in this run's `lines`/`comboBestThisRun` via `Math.max`, and always saves — win or not. If `HighScores.qualifies(data, score)` (fewer than 5 entries, or beats the 5th), it shows `#highscore-form` (a plain `<input>` in the overlay, no `prompt()`) instead of the table; saving the name calls `HighScores.add()` and re-renders with the new row highlighted (`.highscore-new`).
- **Rendering**: `HighScores.render(els, data, highlightIndex)` is the single render path, called for both the always-visible sidebar panel (`sidebarHsEls`, via `renderSidebarHighScores()`) and the Game Over overlay (`overlayHsEls`). `#clear-highscores-btn` wipes the key after a native `confirm()` and refreshes whichever tables are visible.

## GitHub Actions

Three Claude-powered workflows live in `.github/workflows/`:

- `claude.yml` — runs when someone mentions `@claude` in an issue/PR comment, review, or when an
  issue is opened/assigned with `@claude` in the title or body. Does whatever the mention asks
  (implement a fix, answer a question, etc.).
- `claude-code-review.yml` — runs automatically on every PR (opened/synchronize/reopened) and posts
  an automated code review via the `code-review` plugin.
- `claude-issue-triage.yml` — runs automatically when an issue is opened or edited (and does **not**
  mention `@claude`, to avoid double-firing with `claude.yml`). Ensures a fixed set of project
  labels exists (type, `area:*`, `priority:*`, `complexity:*`, `needs-info`, `triaged`), has Claude
  read the issue plus the relevant source, assigns labels from that fixed set, and posts a Spanish
  diagnostic comment (probable cause, code involved, proposed fix, acceptance criteria). That
  comment is meant to be the input for a follow-up `@claude` mention that implements the fix.
