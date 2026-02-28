/* ============================================================
   MLB Pitch Analyzer — app.js
   No dependencies. Vanilla JS. Requires a modern browser.
   ============================================================ */

'use strict';

/* ============================================================
   1. CONSTANTS
   ============================================================ */

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const POLL_INTERVAL_MS = 5000;
const MAX_TOKENS = 600;
const MAX_HISTORY_MESSAGES = 10; // 5 exchanges

const TEAM_COLORS = {
  'ARI': '#A71930', 'ATL': '#CE1141', 'BAL': '#DF4601', 'BOS': '#BD3039',
  'CHC': '#0E3386', 'CWS': '#C4CED4', 'CIN': '#C6011F', 'CLE': '#E31937',
  'COL': '#33006F', 'DET': '#FA4616', 'HOU': '#EB6E1F', 'KC':  '#004687',
  'LAA': '#BA0021', 'LAD': '#005A9C', 'MIA': '#00A3E0', 'MIL': '#FFC52F',
  'MIN': '#D31145', 'NYM': '#FF5910', 'NYY': '#C4CED4', 'OAK': '#EFB21E',
  'PHI': '#E81828', 'PIT': '#FDB827', 'SD':  '#FFC425', 'SF':  '#FD5A1E',
  'SEA': '#005C5C', 'STL': '#C41E3A', 'TB':  '#8FBCE6', 'TEX': '#003278',
  'TOR': '#134A8E', 'WSH': '#AB0003',
};

const ZONE_DESCRIPTIONS = {
  1: 'up and in',    2: 'up and middle',    3: 'up and away',
  4: 'middle in',   5: 'heart of plate',   6: 'middle away',
  7: 'low and in',  8: 'low and middle',   9: 'low and away',
  11: 'inside off plate', 12: 'high out of zone', 13: 'outside off plate', 14: 'low out of zone',
};

// Zone cell layout in the 5x5 grid (row, col), 1-indexed
// Zones 1–9 are the 3x3 strike zone in the middle, 11–14 are outer borders
const ZONE_LAYOUT = [
  // [zone, gridRow, gridCol]
  [12,  1, 1], [12,  1, 2], [12,  1, 3], [12,  1, 4], [12,  1, 5],
  [11,  2, 1], [ 1,  2, 2], [ 2,  2, 3], [ 3,  2, 4], [13,  2, 5],
  [11,  3, 1], [ 4,  3, 2], [ 5,  3, 3], [ 6,  3, 4], [13,  3, 5],
  [11,  4, 1], [ 7,  4, 2], [ 8,  4, 3], [ 9,  4, 4], [13,  4, 5],
  [14,  5, 1], [14,  5, 2], [14,  5, 3], [14,  5, 4], [14,  5, 5],
];

/* ============================================================
   2. STATE
   ============================================================ */

const STATE = {
  apiKey: localStorage.getItem('mlb_analyzer_apikey') || '',

  selectedGame: null,
  analysisMode: 'per-at-bat',
  conversationHistory: [],

  lastAtBatIndex: -1,
  lastPitchCount: 0,
  lastTimestamp: null,

  pitcherStatsCache: {},
  currentPitcherId: null,
  currentPitcherName: '',
  currentPitcherHand: '',

  pollingInterval: null,
  isStreaming: false,

  replayPlays: [],
  replayIndex: 0,
  isReplay: false,

  autoScroll: true,
};

/* ============================================================
   3. ROUTER
   ============================================================ */

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screenId}`).classList.add('active');
}

/* ============================================================
   4. DATE HELPERS
   ============================================================ */

function getTodayDateString() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function formatGameTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch {
    return '';
  }
}

function formatDateDisplay(dateStr) {
  // dateStr is MM/DD/YYYY
  const [mm, dd, yyyy] = dateStr.split('/');
  const d = new Date(`${yyyy}-${mm}-${dd}`);
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/* ============================================================
   5. MLB API LAYER
   ============================================================ */

async function fetchTodayGames() {
  const date = getTodayDateString();
  const url = `${MLB_API_BASE}/schedule?sportId=1&date=${date}&hydrate=team,linescore,game(content(summary))`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);
  const data = await res.json();
  const dates = data.dates || [];
  if (!dates.length) return [];
  return dates[0].games || [];
}

async function fetchLiveFeed(gamePk) {
  const url = `${MLB_API_BASE}.1/game/${gamePk}/feed/live`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB live feed error: ${res.status}`);
  return res.json();
}

async function fetchLinescore(gamePk) {
  const url = `${MLB_API_BASE}/game/${gamePk}/linescore`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB linescore error: ${res.status}`);
  return res.json();
}

async function fetchPitcherStats(personId, season) {
  if (STATE.pitcherStatsCache[personId]) return STATE.pitcherStatsCache[personId];
  try {
    const url = `${MLB_API_BASE}/people/${personId}/stats?stats=season&group=pitching&season=${season}&sportId=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const splits = data?.stats?.[0]?.splits;
    if (!splits?.length) return null;
    const stats = splits[0].stat;
    STATE.pitcherStatsCache[personId] = stats;
    return stats;
  } catch {
    return null;
  }
}

/* ============================================================
   6. GRADIENT BACKGROUND
   ============================================================ */

function setGradientBackground(teamAbbr) {
  const color = TEAM_COLORS[teamAbbr] || '#58a6ff';
  const el = document.getElementById('gradient-bg');
  el.style.background = `radial-gradient(ellipse at top, ${color}18 0%, transparent 65%)`;
}

function clearGradientBackground() {
  document.getElementById('gradient-bg').style.background = '';
}

/* ============================================================
   7. SCREEN 1: API KEY
   ============================================================ */

function initApiKeyScreen() {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('save-key-btn');
  const errorEl = document.getElementById('apikey-error');

  // Pre-fill if key exists (e.g. user navigated back)
  if (STATE.apiKey) input.value = STATE.apiKey;

  function handleSave() {
    const key = input.value.trim();
    if (!key.startsWith('sk-ant-')) {
      showError(errorEl, 'Key must start with "sk-ant-". Check your Anthropic console.');
      return;
    }
    STATE.apiKey = key;
    localStorage.setItem('mlb_analyzer_apikey', key);
    hideError(errorEl);
    initGamesScreen();
    showScreen('games');
  }

  btn.addEventListener('click', handleSave);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleSave(); });
}

/* ============================================================
   8. SCREEN 2: GAME SELECTION
   ============================================================ */

async function initGamesScreen() {
  const grid = document.getElementById('games-grid');
  const loadingEl = document.getElementById('games-loading');
  const emptyEl = document.getElementById('games-empty');
  const dateEl = document.getElementById('games-date');

  dateEl.textContent = formatDateDisplay(getTodayDateString());
  grid.innerHTML = '';
  showEl(loadingEl);
  hideEl(emptyEl);

  document.getElementById('change-key-btn').onclick = () => {
    showScreen('apikey');
  };

  let games;
  try {
    games = await fetchTodayGames();
  } catch (err) {
    hideEl(loadingEl);
    grid.innerHTML = `<div class="empty-state"><p class="empty-icon">⚠️</p><p class="empty-title">Could not load games</p><p class="empty-desc">${err.message}</p></div>`;
    return;
  }

  hideEl(loadingEl);

  if (!games.length) {
    showEl(emptyEl);
    return;
  }

  // Sort: Live first, then pre/warmup, then scheduled, then final/postponed
  const statusOrder = { 'In Progress': 0, 'Warmup': 1, 'Pre-Game': 1, 'Scheduled': 2, 'Final': 3, 'Game Over': 3, 'Postponed': 4, 'Cancelled': 4 };
  games.sort((a, b) => {
    const sa = statusOrder[a.status?.detailedState] ?? 3;
    const sb = statusOrder[b.status?.detailedState] ?? 3;
    if (sa !== sb) return sa - sb;
    return new Date(a.gameDate) - new Date(b.gameDate);
  });

  games.forEach(game => {
    const card = buildGameCard(game);
    grid.appendChild(card);
  });
}

function getGameStatus(game) {
  const state = game.status?.detailedState || '';
  const abstract = game.status?.abstractGameState || '';
  if (abstract === 'Live' || state === 'In Progress' || state === 'Warmup') return 'live';
  if (abstract === 'Final' || state === 'Final' || state === 'Game Over') return 'final';
  if (state === 'Postponed' || state === 'Cancelled') return 'postponed';
  return 'pre';
}

function buildGameCard(game) {
  const away = game.teams?.away?.team;
  const home = game.teams?.home?.team;
  const awayScore = game.teams?.away?.score ?? '';
  const homeScore = game.teams?.home?.score ?? '';
  const status = getGameStatus(game);
  const detailedState = game.status?.detailedState || '';

  const card = document.createElement('div');
  card.className = 'game-card';

  if (status === 'postponed') card.classList.add('disabled');

  const awayAbbr = away?.abbreviation || away?.teamCode || '???';
  const homeAbbr = home?.abbreviation || home?.teamCode || '???';

  let badgeHtml = '';
  if (status === 'live') {
    badgeHtml = `<span class="badge badge--live"><span class="live-dot"></span>Live</span>`;
  } else if (status === 'final') {
    badgeHtml = `<span class="badge badge--final">Final</span>`;
  } else if (status === 'postponed') {
    badgeHtml = `<span class="badge badge--postponed">${detailedState}</span>`;
  } else {
    badgeHtml = `<span class="badge badge--pre">${formatGameTime(game.gameDate) || 'Scheduled'}</span>`;
  }

  let scoreHtml = '';
  if (status === 'live' || status === 'final') {
    scoreHtml = `<span class="game-score">${awayScore} – ${homeScore}</span>`;
  }

  card.innerHTML = `
    <div class="game-matchup">
      <div>
        <div class="game-teams">${awayAbbr} @ ${homeAbbr}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${away?.name || ''} at ${home?.name || ''}</div>
        ${scoreHtml}
      </div>
    </div>
    <div class="game-meta">
      ${badgeHtml}
    </div>
  `;

  if (status !== 'postponed') {
    card.addEventListener('click', () => selectGame(game));
  }

  return card;
}

function selectGame(game) {
  STATE.selectedGame = game;
  const homeAbbr = game.teams?.home?.team?.abbreviation || game.teams?.home?.team?.teamCode;
  setGradientBackground(homeAbbr);
  initModeScreen();
  showScreen('mode');
}

/* ============================================================
   9. SCREEN 3: MODE SELECTION
   ============================================================ */

function initModeScreen() {
  const game = STATE.selectedGame;
  const away = game.teams?.away?.team?.abbreviation || '???';
  const home = game.teams?.home?.team?.abbreviation || '???';
  const awayScore = game.teams?.away?.score ?? '';
  const homeScore = game.teams?.home?.score ?? '';
  const status = getGameStatus(game);

  const displayEl = document.getElementById('mode-game-display');
  let scoreStr = '';
  if (status === 'live' || status === 'final') {
    scoreStr = `<div class="mode-game-score">${awayScore} – ${homeScore} · ${status === 'live' ? 'Live' : 'Final'}</div>`;
  }
  displayEl.innerHTML = `<div class="mode-game-teams">${away} @ ${home}</div>${scoreStr}`;

  // Mode card selection
  STATE.analysisMode = 'per-at-bat';
  document.querySelectorAll('.mode-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.mode === STATE.analysisMode);
    card.addEventListener('click', () => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      STATE.analysisMode = card.dataset.mode;
    });
  });

  document.getElementById('mode-back-btn').onclick = () => {
    showScreen('games');
  };

  const errorEl = document.getElementById('mode-error');
  hideError(errorEl);

  document.getElementById('start-analysis-btn').onclick = async () => {
    const btn = document.getElementById('start-analysis-btn');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    hideError(errorEl);
    try {
      await startAnalysis();
    } catch (err) {
      showError(errorEl, `Failed to start: ${err.message}`);
      btn.disabled = false;
      btn.textContent = 'Start Analysis';
    }
  };
}

async function startAnalysis() {
  const game = STATE.selectedGame;
  const liveFeed = await fetchLiveFeed(game.gamePk);
  const gameStatus = liveFeed?.gameData?.status?.abstractGameState || 'Preview';

  // Reset session state
  STATE.conversationHistory = [];
  STATE.lastAtBatIndex = -1;
  STATE.lastPitchCount = 0;
  STATE.lastTimestamp = null;
  STATE.currentPitcherId = null;
  STATE.isStreaming = false;
  STATE.autoScroll = true;
  STATE.pitcherStatsCache = {};

  if (gameStatus === 'Final' || gameStatus === 'Game Over') {
    STATE.isReplay = true;
    initFeedScreen(liveFeed, true);
  } else {
    STATE.isReplay = false;
    initFeedScreen(liveFeed, false);
  }
  showScreen('feed');
}

/* ============================================================
   10. SCREEN 4: FEED + SCOREBOARD
   ============================================================ */

function initFeedScreen(liveFeed, isReplay) {
  const game = STATE.selectedGame;
  const away = game.teams?.away?.team?.abbreviation || '???';
  const home = game.teams?.home?.team?.abbreviation || '???';
  const gameStatus = liveFeed?.gameData?.status?.abstractGameState || 'Preview';

  // Header
  const titleEl = document.getElementById('feed-game-title');
  titleEl.textContent = `${away} @ ${home}`;

  const badgeEl = document.getElementById('feed-badge');
  if (isReplay) {
    badgeEl.innerHTML = `<span class="badge badge--final">Final</span>`;
  } else if (gameStatus === 'Live' || gameStatus === 'Warmup') {
    badgeEl.innerHTML = `<span class="badge badge--live"><span class="live-dot"></span>Live</span>`;
  } else {
    badgeEl.innerHTML = `<span class="badge badge--pre">Preview</span>`;
  }

  // Feed
  const feedEl = document.getElementById('analysis-feed');
  feedEl.innerHTML = '';

  // Auto-scroll tracking
  const feedContainer = document.getElementById('screen-feed');
  feedContainer.addEventListener('scroll', () => {
    const atBottom = feedContainer.scrollHeight - feedContainer.scrollTop - feedContainer.clientHeight < 60;
    STATE.autoScroll = atBottom;
  }, { passive: true });

  // Back button
  document.getElementById('feed-back-btn').onclick = () => {
    stopPolling();
    STATE.isStreaming = false;
    clearGradientBackground();
    document.getElementById('scoreboard').hidden = true;
    document.getElementById('pitcher-stats-btn-wrap').hidden = true;
    document.getElementById('replay-controls').hidden = true;
    document.getElementById('feed-status').textContent = '';
    document.getElementById('analysis-feed').innerHTML = '';
    const btn = document.getElementById('start-analysis-btn');
    btn.disabled = false;
    btn.textContent = 'Start Analysis';
    showScreen('games');
  };

  // Pitcher stats sheet
  initPitcherStatsSheet();

  if (isReplay) {
    initReplay(liveFeed);
  } else {
    // Update scoreboard now, then start polling
    updateScoreboardFromFeed(liveFeed);
    updatePitcherLineFromFeed(liveFeed);
    setFeedStatus('polling', 'Connected — watching for pitches…');
    startPolling();
  }
}

/* ============================================================
   11. SCOREBOARD
   ============================================================ */

function updateScoreboard(linescore, gameData) {
  const sb = document.getElementById('scoreboard');
  sb.hidden = false;

  const away = gameData?.teams?.away;
  const home = gameData?.teams?.home;

  document.getElementById('sb-away-name').textContent = away?.abbreviation || away?.teamCode || '';
  document.getElementById('sb-home-name').textContent = home?.abbreviation || home?.teamCode || '';
  document.getElementById('sb-away-score').textContent = linescore?.teams?.away?.runs ?? 0;
  document.getElementById('sb-home-score').textContent = linescore?.teams?.home?.runs ?? 0;

  const inningNum = linescore?.currentInning || 0;
  const inningHalf = linescore?.isTopInning ? 'Top' : 'Bot';
  document.getElementById('sb-inning').textContent = inningNum ? `${inningHalf} ${inningNum}` : '—';

  const outs = linescore?.outs ?? 0;
  document.getElementById('sb-outs').textContent = `${outs} out${outs !== 1 ? 's' : ''}`;

  const balls = linescore?.balls ?? 0;
  const strikes = linescore?.strikes ?? 0;
  document.getElementById('sb-count').textContent = `${balls}-${strikes}`;

  // Runners
  const runnersEl = document.getElementById('sb-runners');
  const offense = linescore?.offense || {};
  const bases = [
    offense.first ? true : false,
    offense.second ? true : false,
    offense.third ? true : false,
  ];
  runnersEl.innerHTML = bases.map((occupied, i) =>
    `<div class="runner-base${occupied ? ' occupied' : ''}" title="${['1st','2nd','3rd'][i]}"></div>`
  ).join('');
}

function updateScoreboardFromFeed(liveFeed) {
  const linescore = liveFeed?.liveData?.linescore;
  const gameData = liveFeed?.gameData;
  if (linescore && gameData) {
    updateScoreboard(linescore, gameData);
  }
}

function updatePitcherLineFromFeed(liveFeed) {
  const pitcher = liveFeed?.liveData?.linescore?.defense?.pitcher;
  const pitcherEl = document.getElementById('feed-pitcher-line');
  if (!pitcher) { pitcherEl.textContent = ''; return; }

  const name = pitcher.fullName || pitcher.lastName || 'Pitcher';
  const id = pitcher.id;
  const hand = liveFeed?.gameData?.players?.[`ID${id}`]?.pitchHand?.code || '';
  const handLabel = hand ? ` (${hand}HP)` : '';

  pitcherEl.textContent = `Pitching: ${name}${handLabel}`;

  if (id && id !== STATE.currentPitcherId) {
    STATE.currentPitcherId = id;
    STATE.currentPitcherName = name;
    STATE.currentPitcherHand = hand;
    // Fetch stats asynchronously — don't block UI
    fetchPitcherStats(id, getCurrentYear());
    // Update stats sheet button
    document.getElementById('pitcher-stats-btn-wrap').hidden = false;
    document.getElementById('stats-sheet-name').textContent = `${name} — Season Stats`;
  }
}

/* ============================================================
   12. PITCHER STATS SHEET
   ============================================================ */

function initPitcherStatsSheet() {
  const overlay = document.getElementById('stats-sheet-overlay');
  const sheet = document.getElementById('stats-sheet');
  const btn = document.getElementById('pitcher-stats-btn');
  const closeBtn = document.getElementById('stats-sheet-close');

  function openSheet() {
    const stats = STATE.pitcherStatsCache[STATE.currentPitcherId];
    renderStatsSheet(stats);
    overlay.hidden = false;
    sheet.hidden = false;
  }
  function closeSheet() {
    overlay.hidden = true;
    sheet.hidden = true;
  }

  btn.onclick = openSheet;
  closeBtn.onclick = closeSheet;
  overlay.onclick = closeSheet;
}

function renderStatsSheet(stats) {
  const grid = document.getElementById('stats-sheet-grid');
  if (!stats) {
    grid.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No season stats available.</p>';
    return;
  }

  const tiles = [
    { label: 'ERA',   value: stats.era ?? '—' },
    { label: 'WHIP',  value: stats.whip ?? '—' },
    { label: 'IP',    value: stats.inningsPitched ?? '—' },
    { label: 'K',     value: stats.strikeOuts ?? '—' },
    { label: 'BB',    value: stats.baseOnBalls ?? '—' },
    { label: 'H',     value: stats.hits ?? '—' },
    { label: 'HR',    value: stats.homeRuns ?? '—' },
    { label: 'W-L',   value: `${stats.wins ?? 0}-${stats.losses ?? 0}` },
    { label: 'SO/9',  value: stats.strikeoutsPer9Inn ?? '—' },
  ];

  grid.innerHTML = tiles.map(t =>
    `<div class="stat-tile">
      <div class="stat-tile-label">${t.label}</div>
      <div class="stat-tile-value">${t.value}</div>
    </div>`
  ).join('');
}

/* ============================================================
   13. FEED STATUS
   ============================================================ */

function setFeedStatus(type, text) {
  const el = document.getElementById('feed-status');
  el.className = `feed-status ${type}`;
  el.textContent = text;
}

/* ============================================================
   14. POLLING
   ============================================================ */

function startPolling() {
  if (STATE.pollingInterval) clearInterval(STATE.pollingInterval);
  STATE.pollingInterval = setInterval(pollGameState, POLL_INTERVAL_MS);
  // Immediate first poll
  pollGameState();
}

function stopPolling() {
  if (STATE.pollingInterval) {
    clearInterval(STATE.pollingInterval);
    STATE.pollingInterval = null;
  }
}

async function pollGameState() {
  if (STATE.isStreaming) return;

  let liveFeed, linescore;
  try {
    [liveFeed, linescore] = await Promise.all([
      fetchLiveFeed(STATE.selectedGame.gamePk),
      fetchLinescore(STATE.selectedGame.gamePk),
    ]);
  } catch {
    // Network error — silently skip this tick
    return;
  }

  // Check if data changed since last poll
  const newTimestamp = liveFeed?.metaData?.timeStamp;
  if (newTimestamp && newTimestamp === STATE.lastTimestamp) return;
  STATE.lastTimestamp = newTimestamp;

  // Update UI
  updateScoreboard(linescore, liveFeed?.gameData);
  updatePitcherLineFromFeed(liveFeed);

  // Check game over
  const abstract = liveFeed?.gameData?.status?.abstractGameState;
  if (abstract === 'Final' || abstract === 'Game Over') {
    stopPolling();
    setFeedStatus('', 'Game over');
    showFinalScoreCard(liveFeed);
    return;
  }

  // Check game not started yet
  if (abstract === 'Preview') {
    setFeedStatus('waiting', 'Waiting for first pitch…');
    return;
  }

  setFeedStatus('polling', 'Live');

  // Get new plays/pitches to analyze
  const allPlays = liveFeed?.liveData?.plays?.allPlays || [];
  if (!allPlays.length) return;

  if (STATE.analysisMode === 'per-at-bat') {
    await processNewAtBats(allPlays, liveFeed);
  } else {
    await processNewPitches(allPlays, liveFeed);
  }
}

/* ============================================================
   15. GAME STATE DIFFING
   ============================================================ */

async function processNewAtBats(allPlays, liveFeed) {
  // Find completed at-bats with index > lastAtBatIndex
  const newCompleted = allPlays.filter(play =>
    play.about?.atBatIndex > STATE.lastAtBatIndex &&
    play.about?.isComplete === true
  );

  if (!newCompleted.length) return;

  for (const play of newCompleted) {
    if (STATE.isStreaming) break;
    const ctx = buildAtBatContext(play, liveFeed);
    await analyzeWithClaude(ctx, 'per-at-bat');
    STATE.lastAtBatIndex = play.about.atBatIndex;
    STATE.lastPitchCount = 0;
  }
}

async function processNewPitches(allPlays, liveFeed) {
  if (!allPlays.length) return;

  // Process all newly completed at-bats' pitches, and the current in-progress at-bat
  const completedNew = allPlays.filter(play =>
    play.about?.atBatIndex > STATE.lastAtBatIndex &&
    play.about?.isComplete === true
  );

  // Handle completed plays we haven't seen yet
  for (const play of completedNew) {
    if (STATE.isStreaming) return;
    const pitches = getPitchEvents(play);
    // Determine starting pitch index (we may have seen some if atBatIndex was current)
    const startIdx = (play.about.atBatIndex === STATE.lastAtBatIndex) ? STATE.lastPitchCount : 0;
    for (let i = startIdx; i < pitches.length; i++) {
      if (STATE.isStreaming) return;
      const ctx = buildPitchContext(play, pitches[i], liveFeed, i);
      await analyzeWithClaude(ctx, 'every-pitch');
      await delay(150);
    }
    STATE.lastAtBatIndex = play.about.atBatIndex;
    STATE.lastPitchCount = 0;
  }

  // Handle in-progress at-bat (last in allPlays, isComplete === false)
  const currentPlay = allPlays[allPlays.length - 1];
  if (currentPlay?.about?.isComplete === false) {
    const atBatIdx = currentPlay.about.atBatIndex;
    const pitches = getPitchEvents(currentPlay);

    // If this is a new at-bat compared to last known
    const startIdx = atBatIdx > STATE.lastAtBatIndex ? 0 : STATE.lastPitchCount;

    const newPitches = pitches.slice(startIdx);
    for (const pitch of newPitches) {
      if (STATE.isStreaming) return;
      const pitchIdx = pitches.indexOf(pitch);
      const ctx = buildPitchContext(currentPlay, pitch, liveFeed, pitchIdx);
      await analyzeWithClaude(ctx, 'every-pitch');
      await delay(150);
    }

    if (atBatIdx > STATE.lastAtBatIndex) STATE.lastAtBatIndex = atBatIdx;
    STATE.lastPitchCount = pitches.length;
  }
}

function getPitchEvents(play) {
  return (play.playEvents || []).filter(e => e.type === 'pitch');
}

function getPitcherInfo(liveFeed) {
  const defense = liveFeed?.liveData?.linescore?.defense;
  const pitcher = defense?.pitcher;
  if (!pitcher) return { name: '', id: null, hand: '' };
  const id = pitcher.id;
  const name = pitcher.fullName || pitcher.lastName || '';
  const hand = liveFeed?.gameData?.players?.[`ID${id}`]?.pitchHand?.code || '';
  return { name, id, hand };
}

function getBatterInfo(play, liveFeed) {
  const batterId = play?.matchup?.batter?.id;
  if (!batterId) return { name: '', hand: '' };
  const name = play?.matchup?.batter?.fullName || play?.matchup?.batter?.lastName || '';
  const hand = liveFeed?.gameData?.players?.[`ID${batterId}`]?.batSide?.code || '';
  return { name, hand };
}

function getRunnerDescriptions(play) {
  const runners = play?.runners || [];
  const occupied = runners
    .filter(r => r.movement?.end && r.movement.end !== 'score' && r.movement.end !== 'Score')
    .map(r => r.movement.end);
  if (!occupied.length) return 'Bases empty';
  const labels = { '1B': '1st', '2B': '2nd', '3B': '3rd' };
  return occupied.map(b => labels[b] || b).join(', ') + ' occupied';
}

/* ============================================================
   16. CONTEXT BUILDERS
   ============================================================ */

function buildPitchContext(play, pitchEvent, liveFeed, pitchIndex) {
  const pitcher = getPitcherInfo(liveFeed);
  const batter = getBatterInfo(play, liveFeed);
  const stats = STATE.pitcherStatsCache[pitcher.id] || null;
  const linescore = liveFeed?.liveData?.linescore || {};
  const gameData = liveFeed?.gameData || {};

  const awayName = gameData?.teams?.away?.abbreviation || 'Away';
  const homeName = gameData?.teams?.home?.abbreviation || 'Home';
  const awayScore = linescore?.teams?.away?.runs ?? 0;
  const homeScore = linescore?.teams?.home?.runs ?? 0;
  const inning = linescore?.currentInning || 0;
  const inningHalf = linescore?.isTopInning ? 'Top' : 'Bot';
  const outs = play?.count?.outs ?? linescore?.outs ?? 0;
  const runners = getRunnerDescriptions(play);

  const pitchData = pitchEvent?.pitchData || {};
  const details = pitchEvent?.details || {};
  const pitchType = details?.type?.description || details?.description || 'Unknown pitch';
  const speed = pitchData?.startSpeed ? `${Math.round(pitchData.startSpeed)}` : null;
  const zone = pitchData?.zone || null;
  const spin = pitchData?.breaks?.spinRate ? Math.round(pitchData.breaks.spinRate) : null;
  const hBreak = pitchData?.breaks?.breakHorizontal != null ? pitchData.breaks.breakHorizontal.toFixed(1) : null;
  const vBreak = pitchData?.breaks?.breakVertical != null ? pitchData.breaks.breakVertical.toFixed(1) : null;
  const result = details?.description || '';
  const balls = pitchEvent?.count?.balls ?? 0;
  const strikes = pitchEvent?.count?.strikes ?? 0;
  const pitchNum = pitchIndex + 1;

  // Prior sequence
  const allPitches = getPitchEvents(play).slice(0, pitchIndex);
  const seqLines = allPitches.map((p, i) => {
    const pd = p?.pitchData || {};
    const d = p?.details || {};
    const spd = pd?.startSpeed ? `${Math.round(pd.startSpeed)} mph` : '';
    const cnt = p?.count ? `${p.count.balls}-${p.count.strikes}` : '';
    return `#${i+1}: ${d?.type?.description || 'pitch'}${spd ? ' @ ' + spd : ''} -> ${d?.description || ''} (${cnt})`;
  });

  let lines = [];
  lines.push('=== GAME SITUATION ===');
  lines.push(`${inningHalf} ${inning} | ${awayName} ${awayScore} - ${homeName} ${homeScore} | ${outs} out(s) | ${runners}`);
  lines.push('');
  lines.push('=== MATCHUP ===');
  const handLabel = pitcher.hand ? `${pitcher.hand}HP` : '';
  const batterHand = batter.hand ? `${batter.hand}HB` : '';
  lines.push(`Pitching: ${pitcher.name}${handLabel ? ' (' + handLabel + ')' : ''} vs ${batter.name}${batterHand ? ' (' + batterHand + ')' : ''}`);
  if (stats) {
    lines.push(`Season stats: ERA ${stats.era ?? '—'}, WHIP ${stats.whip ?? '—'}`);
  }
  if (seqLines.length) {
    lines.push('');
    lines.push('=== AT-BAT SEQUENCE SO FAR ===');
    seqLines.forEach(l => lines.push(l));
  }
  lines.push('');
  lines.push('=== NEW PITCH (analyze this) ===');
  lines.push(`#${pitchNum}: ${pitchType}${speed ? ' @ ' + speed + ' mph' : ''}`);
  if (zone) lines.push(`Location: zone ${zone} — ${ZONE_DESCRIPTIONS[zone] || ''}`);
  lines.push(`Result: ${result} -> Count: ${balls}-${strikes}`);
  if (spin) {
    let extras = `Spin: ${spin} rpm`;
    if (hBreak) extras += ` | H-break: ${hBreak}"`;
    if (vBreak) extras += ` | V-break: ${vBreak}"`;
    lines.push(extras);
  }

  return {
    raw: lines.join('\n'),
    headline: buildPitchHeadline(pitchType, speed, spin, result),
    balls: play?.count?.balls ?? 0,
    strikes: play?.count?.strikes ?? 0,
    zone,
    pitchType,
    speed,
  };
}

function buildAtBatContext(play, liveFeed) {
  const pitcher = getPitcherInfo(liveFeed);
  const batter = getBatterInfo(play, liveFeed);
  const stats = STATE.pitcherStatsCache[pitcher.id] || null;
  const linescore = liveFeed?.liveData?.linescore || {};
  const gameData = liveFeed?.gameData || {};

  const awayName = gameData?.teams?.away?.abbreviation || 'Away';
  const homeName = gameData?.teams?.home?.abbreviation || 'Home';
  const awayScore = linescore?.teams?.away?.runs ?? 0;
  const homeScore = linescore?.teams?.home?.runs ?? 0;
  const inning = play?.about?.inning || linescore?.currentInning || 0;
  const inningHalf = play?.about?.isTopInning ? 'Top' : 'Bot';
  const outs = play?.count?.outs ?? 0;
  const runners = getRunnerDescriptions(play);

  const allPitches = getPitchEvents(play);
  const result = play?.result?.description || play?.result?.event || '';
  const finalBalls = play?.count?.balls ?? 0;
  const finalStrikes = play?.count?.strikes ?? 0;

  const pitchLines = allPitches.map((p, i) => {
    const pd = p?.pitchData || {};
    const d = p?.details || {};
    const spd = pd?.startSpeed ? `${Math.round(pd.startSpeed)} mph` : '';
    const cnt = p?.count ? `${p.count.balls}-${p.count.strikes}` : '';
    return `#${i+1}: ${d?.type?.description || 'pitch'}${spd ? ' @ ' + spd : ''} -> ${d?.description || ''} (${cnt})`;
  });

  let lines = [];
  lines.push('=== GAME SITUATION ===');
  lines.push(`${inningHalf} ${inning} | ${awayName} ${awayScore} - ${homeName} ${homeScore} | ${outs} out(s) | ${runners}`);
  lines.push('');
  lines.push('=== MATCHUP ===');
  const handLabel = pitcher.hand ? `${pitcher.hand}HP` : '';
  const batterHand = batter.hand ? `${batter.hand}HB` : '';
  lines.push(`Pitching: ${pitcher.name}${handLabel ? ' (' + handLabel + ')' : ''} vs ${batter.name}${batterHand ? ' (' + batterHand + ')' : ''}`);
  if (stats) {
    lines.push(`Season stats: ERA ${stats.era ?? '—'}, WHIP ${stats.whip ?? '—'}`);
  }
  lines.push('');
  lines.push('=== PITCH SEQUENCE ===');
  pitchLines.forEach(l => lines.push(l));
  lines.push('');
  lines.push('=== RESULT ===');
  lines.push(`${result} (${finalBalls}-${finalStrikes} count, ${outs} out(s))`);

  const headline = `${batter.name || 'Batter'} — ${result || 'At-Bat Complete'}`;

  return {
    raw: lines.join('\n'),
    headline,
    balls: finalBalls,
    strikes: finalStrikes,
    zone: null,
    pitchType: null,
    speed: null,
  };
}

function buildPitchHeadline(pitchType, speed, spin, result) {
  let parts = [pitchType];
  if (speed) parts.push(`${speed} mph`);
  if (spin) parts.push(`${spin} rpm`);
  if (result) parts.push(result);
  return parts.join(' · ');
}

/* ============================================================
   17. CLAUDE AI INTEGRATION
   ============================================================ */

function buildSystemPrompt() {
  return `You are an expert baseball analyst specializing in pitching strategy and mechanics. Your role is to provide insightful, technically precise commentary on pitching decisions for an enthusiastic fan who wants real depth — not play-by-play narration.

When analyzing a pitch or at-bat:
- Focus on WHY the pitcher made this choice given the count, situation, and batter tendencies
- Discuss pitch sequencing, location strategy, and how it sets up future pitches
- Reference movement profiles, velocity trends, and how they affect batters
- Be specific and analytical — avoid generic statements
- Keep responses concise: 3–5 sentences for individual pitches, 4–7 for full at-bats
- Use baseball terminology naturally (tunneling, extension, pitch shape, command, etc.)
- Do NOT just describe what happened — explain the strategic and mechanical reasoning`;
}

function buildUserMessage(ctx) {
  return ctx.raw;
}

async function analyzeWithClaude(ctx, mode) {
  STATE.isStreaming = true;
  const entryEl = renderStreamingEntry(ctx);

  // Add user message to history
  const userMsg = { role: 'user', content: buildUserMessage(ctx) };

  // Trim history before building messages
  const recentHistory = STATE.conversationHistory.slice(-MAX_HISTORY_MESSAGES);

  const messages = [...recentHistory, userMsg];

  let assistantText = '';

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': STATE.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-calls': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        system: buildSystemPrompt(),
        messages,
      }),
    });

    if (res.status === 401) {
      setFeedStatus('', '');
      finalizeEntry(entryEl, '⚠️ Invalid API key — check your key in Settings.');
      stopPolling();
      return;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      finalizeEntry(entryEl, `API error ${res.status}${errText ? ': ' + errText.slice(0, 100) : ''}`);
      // Don't append failed exchange to history
      return;
    }

    assistantText = await streamClaudeResponse(res, entryEl);

    // Append successful exchange to history
    STATE.conversationHistory.push(userMsg);
    STATE.conversationHistory.push({ role: 'assistant', content: assistantText });

  } catch (err) {
    finalizeEntry(entryEl, `Connection error: ${err.message}`);
  } finally {
    STATE.isStreaming = false;
  }
}

async function streamClaudeResponse(response, entryEl) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  const bodyEl = entryEl.querySelector('.feed-entry-body');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Hold potentially incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            fullText += parsed.delta.text;
            bodyEl.innerHTML = renderMarkdown(fullText);
            bodyEl.classList.add('streaming-cursor');
            scrollFeedToBottom();
          } else if (parsed.type === 'message_stop') {
            break;
          }
        } catch {
          // Malformed JSON chunk — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

function renderMarkdown(text) {
  // Minimal markdown: bold (**text**) and italic (*text*)
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

/* ============================================================
   18. FEED ENTRY RENDERING
   ============================================================ */

function renderStreamingEntry(ctx) {
  const feedEl = document.getElementById('analysis-feed');

  const entry = document.createElement('div');
  entry.className = 'feed-entry feed-entry--streaming';

  // Header
  const header = document.createElement('div');
  header.className = 'feed-entry-header';

  const headline = document.createElement('div');
  headline.className = 'feed-entry-headline';
  headline.textContent = ctx.headline || '';

  // Count dots
  const countRow = buildCountRow(ctx.balls || 0, ctx.strikes || 0);

  header.appendChild(headline);
  header.appendChild(countRow);
  entry.appendChild(header);

  // Toggles (zone + context)
  const togglesRow = document.createElement('div');
  togglesRow.className = 'feed-entry-toggles';

  let zoneWrap = null;
  if (ctx.zone != null) {
    const zoneBtn = document.createElement('button');
    zoneBtn.className = 'toggle-btn';
    zoneBtn.textContent = '▦ Show Zone';
    zoneWrap = buildZoneGrid(ctx.zone);
    zoneWrap.className = 'zone-wrap';
    zoneWrap.hidden = true;

    zoneBtn.addEventListener('click', () => {
      zoneWrap.hidden = !zoneWrap.hidden;
      zoneBtn.textContent = zoneWrap.hidden ? '▦ Show Zone' : '▦ Hide Zone';
    });
    togglesRow.appendChild(zoneBtn);
  }

  const ctxBtn = document.createElement('button');
  ctxBtn.className = 'toggle-btn';
  ctxBtn.textContent = '▸ Context';
  const ctxWrap = document.createElement('div');
  ctxWrap.className = 'context-wrap';
  ctxWrap.hidden = true;
  const ctxBlock = document.createElement('pre');
  ctxBlock.className = 'context-block';
  ctxBlock.textContent = ctx.raw || '';
  ctxWrap.appendChild(ctxBlock);

  ctxBtn.addEventListener('click', () => {
    ctxWrap.hidden = !ctxWrap.hidden;
    ctxBtn.textContent = ctxWrap.hidden ? '▸ Context' : '▾ Context';
  });
  togglesRow.appendChild(ctxBtn);

  entry.appendChild(togglesRow);
  if (zoneWrap) entry.appendChild(zoneWrap);
  entry.appendChild(ctxWrap);

  // Analysis body
  const body = document.createElement('div');
  body.className = 'feed-entry-body streaming-cursor';
  entry.appendChild(body);

  feedEl.appendChild(entry);
  scrollFeedToBottom();

  return entry;
}

function finalizeEntry(entryEl, fallbackText) {
  entryEl.classList.remove('feed-entry--streaming');
  const body = entryEl.querySelector('.feed-entry-body');
  body.classList.remove('streaming-cursor');
  if (fallbackText && !body.textContent.trim()) {
    body.textContent = fallbackText;
  }
}

function buildCountRow(balls, strikes) {
  const row = document.createElement('div');
  row.className = 'feed-count-row';

  const ballsLabel = document.createElement('span');
  ballsLabel.className = 'count-label';
  ballsLabel.textContent = 'B';

  const ballDots = document.createElement('span');
  ballDots.className = 'count-dots';
  for (let i = 0; i < 4; i++) {
    const dot = document.createElement('span');
    dot.className = `count-dot${i < balls ? ' filled-ball' : ''}`;
    ballDots.appendChild(dot);
  }

  const strikesLabel = document.createElement('span');
  strikesLabel.className = 'count-label';
  strikesLabel.style.marginLeft = '10px';
  strikesLabel.textContent = 'S';

  const strikeDots = document.createElement('span');
  strikeDots.className = 'count-dots';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = `count-dot${i < strikes ? ' filled-strike' : ''}`;
    strikeDots.appendChild(dot);
  }

  row.appendChild(ballsLabel);
  row.appendChild(ballDots);
  row.appendChild(strikesLabel);
  row.appendChild(strikeDots);
  return row;
}

function buildZoneGrid(activeZone) {
  const wrap = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'zone-grid';

  // Track which positions are used
  const usedPositions = new Set();
  const cells = {};

  ZONE_LAYOUT.forEach(([zone, row, col]) => {
    const key = `${row}-${col}`;
    if (!usedPositions.has(key)) {
      usedPositions.add(key);
      const cell = document.createElement('div');
      cell.className = 'zone-cell';
      cell.style.gridRow = row;
      cell.style.gridColumn = col;

      const isActive = zone === activeZone;
      if (isActive) {
        cell.classList.add(zone >= 11 ? 'active-ball' : 'active-strike');
        cell.textContent = zone;
      } else {
        cell.textContent = zone <= 9 ? zone : '';
        cell.style.color = 'var(--text-muted)';
      }
      cells[key] = cell;
      grid.appendChild(cell);
    }
  });

  wrap.appendChild(grid);
  return wrap;
}

function scrollFeedToBottom() {
  if (!STATE.autoScroll) return;
  const feedEl = document.getElementById('analysis-feed');
  feedEl.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

/* ============================================================
   19. FINAL SCORE CARD
   ============================================================ */

function showFinalScoreCard(liveFeed) {
  const game = STATE.selectedGame;
  const away = game.teams?.away?.team?.abbreviation || 'Away';
  const home = game.teams?.home?.team?.abbreviation || 'Home';
  const awayScore = liveFeed?.liveData?.linescore?.teams?.away?.runs ?? game.teams?.away?.score ?? '?';
  const homeScore = liveFeed?.liveData?.linescore?.teams?.home?.runs ?? game.teams?.home?.score ?? '?';

  const feedEl = document.getElementById('analysis-feed');
  const card = document.createElement('div');
  card.className = 'final-card';
  card.innerHTML = `
    <div class="final-card-label">Final Score</div>
    <div class="final-card-score">${awayScore} – ${homeScore}</div>
    <div class="final-card-teams">${away} vs ${home}</div>
  `;
  feedEl.appendChild(card);
  scrollFeedToBottom();
}

/* ============================================================
   20. REPLAY MODE
   ============================================================ */

function initReplay(liveFeed) {
  const allPlays = liveFeed?.liveData?.plays?.allPlays || [];
  // Only completed plays
  STATE.replayPlays = allPlays.filter(p => p.about?.isComplete === true);
  STATE.replayIndex = 0;

  document.getElementById('replay-controls').hidden = false;
  document.getElementById('pitcher-stats-btn-wrap').hidden = false;

  updateReplayProgress();
  updateScoreboardFromFeed(liveFeed);

  // Try to seed pitcher info from the last known pitcher
  const pitcher = getPitcherInfo(liveFeed);
  if (pitcher.id) {
    STATE.currentPitcherId = pitcher.id;
    STATE.currentPitcherName = pitcher.name;
    document.getElementById('feed-pitcher-line').textContent = `Pitching: ${pitcher.name}`;
    document.getElementById('stats-sheet-name').textContent = `${pitcher.name} — Season Stats`;
    fetchPitcherStats(pitcher.id, getCurrentYear());
  }

  setFeedStatus('', `${STATE.replayPlays.length} plays available — press Next to begin`);

  const nextBtn = document.getElementById('next-play-btn');
  nextBtn.onclick = handleNextPlay;

  // Keyboard: spacebar or right arrow
  document.addEventListener('keydown', handleReplayKey);
}

function handleReplayKey(e) {
  if (!STATE.isReplay) return;
  if (e.key === ' ' || e.key === 'ArrowRight') {
    e.preventDefault();
    handleNextPlay();
  }
}

async function handleNextPlay() {
  if (STATE.isStreaming) return;
  if (STATE.replayIndex >= STATE.replayPlays.length) return;

  const nextBtn = document.getElementById('next-play-btn');
  nextBtn.disabled = true;

  const play = STATE.replayPlays[STATE.replayIndex];
  STATE.replayIndex++;

  // Build a minimal liveFeed-like object for context builders
  const game = STATE.selectedGame;
  const miniLiveFeed = {
    gameData: {
      teams: { away: game.teams.away.team, home: game.teams.home.team },
      players: {},
    },
    liveData: { linescore: {} },
  };

  let ctx;
  if (STATE.analysisMode === 'per-at-bat') {
    ctx = buildAtBatContext(play, miniLiveFeed);
    await analyzeWithClaude(ctx, 'per-at-bat');
  } else {
    const pitches = getPitchEvents(play);
    for (let i = 0; i < pitches.length; i++) {
      ctx = buildPitchContext(play, pitches[i], miniLiveFeed, i);
      await analyzeWithClaude(ctx, 'every-pitch');
      if (i < pitches.length - 1) await delay(200);
    }
  }

  updateReplayProgress();

  if (STATE.replayIndex >= STATE.replayPlays.length) {
    nextBtn.textContent = 'Done';
    nextBtn.disabled = true;
    setFeedStatus('', 'Replay complete');

    // Remove keyboard listener
    document.removeEventListener('keydown', handleReplayKey);
  } else {
    nextBtn.disabled = false;
  }
}

function updateReplayProgress() {
  const el = document.getElementById('replay-progress');
  const total = STATE.replayPlays.length;
  const current = STATE.replayIndex;
  el.textContent = current === 0 ? `${total} plays` : `Play ${current} of ${total}`;
}

/* ============================================================
   21. UTILITIES
   ============================================================ */

function showEl(el) { if (el) el.hidden = false; }
function hideEl(el) { if (el) el.hidden = true; }

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}
function hideError(el) {
  if (!el) return;
  el.hidden = true;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
   22. INITIALIZATION
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  if (STATE.apiKey) {
    initGamesScreen();
    showScreen('games');
  } else {
    initApiKeyScreen();
    showScreen('apikey');
  }
});
