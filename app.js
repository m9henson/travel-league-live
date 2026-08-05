import { firebaseConfig as fileConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore, collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const state = { db: null, tournamentId: null, tournament: null, players: [], scores: [], unsubscribe: [] };
const defaultPars = (holes) => Array.from({ length: holes }, (_, i) => [4,4,3,5,4,4,3,5,4][i % 9]);

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  setTimeout(() => $('toast').classList.add('hidden'), 2300);
}
function show(panel) {
  ['setupPanel','homePanel','tournamentPanel'].forEach(id => $(id).classList.toggle('hidden', id !== panel));
}
function formatDate(value) {
  if (!value) return '';
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function escapeHtml(value='') {
  return value.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

async function connect() {
  let config = fileConfig;
  if (!config) {
    try { config = JSON.parse(localStorage.getItem('travelLeagueFirebaseConfig')); } catch { config = null; }
  }
  if (!config?.projectId) { show('setupPanel'); return; }
  try {
    state.db = getFirestore(initializeApp(config));
    show('homePanel');
    await loadTournaments();
  } catch (error) {
    console.error(error);
    show('setupPanel');
    toast('Firebase connection failed');
  }
}

async function loadTournaments() {
  const list = $('tournamentList');
  list.innerHTML = '<div class="empty">Loading tournaments…</div>';
  try {
    const snap = await getDocs(query(collection(state.db, 'tournaments'), orderBy('date', 'desc')));
    if (snap.empty) { list.innerHTML = '<div class="empty">No tournaments yet. Create your first one.</div>'; return; }
    list.innerHTML = snap.docs.map(d => {
      const t = d.data();
      return `<button class="list-item tournament-link" data-id="${d.id}"><div><h4>${escapeHtml(t.name)}</h4><p>${escapeHtml(t.course)} • ${formatDate(t.date)} • ${t.holes} holes</p></div><span>›</span></button>`;
    }).join('');
    document.querySelectorAll('.tournament-link').forEach(btn => btn.addEventListener('click', () => openTournament(btn.dataset.id)));
  } catch (e) { console.error(e); list.innerHTML = '<div class="empty">Could not load tournaments. Check Firestore rules.</div>'; }
}

async function createTournament() {
  const name = $('newTournamentName').value.trim();
  const course = $('newCourseName').value.trim();
  const date = $('newTournamentDate').value;
  const holes = Number($('newHoles').value);
  if (!name || !course || !date) return;
  const ref = await addDoc(collection(state.db, 'tournaments'), { name, course, date, holes, pars: defaultPars(holes), createdAt: serverTimestamp() });
  $('newTournamentDialog').close();
  await loadTournaments();
  openTournament(ref.id);
}

function clearSubscriptions() { state.unsubscribe.forEach(fn => fn?.()); state.unsubscribe = []; }
async function openTournament(id) {
  clearSubscriptions();
  state.tournamentId = id;
  const ref = doc(state.db, 'tournaments', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return toast('Tournament not found');
  state.tournament = { id, ...snap.data() };
  show('tournamentPanel');
  renderTournamentHeader();
  renderSettings();
  renderHoleOptions();
  subscribeTournament();
}

function subscribeTournament() {
  const base = doc(state.db, 'tournaments', state.tournamentId);
  state.unsubscribe.push(onSnapshot(base, snap => {
    if (!snap.exists()) return;
    state.tournament = { id: snap.id, ...snap.data() };
    renderTournamentHeader(); renderSettings(); renderHoleOptions(); renderLeaderboard(); renderScoreHistory();
  }));
  state.unsubscribe.push(onSnapshot(collection(base, 'players'), snap => {
    state.players = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name));
    renderPlayers(); renderPlayerOptions(); renderLeaderboard(); renderScoreHistory();
  }));
  state.unsubscribe.push(onSnapshot(collection(base, 'scores'), snap => {
    state.scores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLeaderboard(); renderScoreHistory(); loadCurrentScore();
  }));
}

function renderTournamentHeader() {
  const t = state.tournament;
  $('tournamentName').textContent = t.name;
  $('tournamentMeta').textContent = `${t.course} • ${formatDate(t.date)} • ${t.holes} holes`;
}
function renderPlayers() {
  const list = $('playerList');
  if (!state.players.length) { list.innerHTML = '<div class="empty">Add players to begin scoring.</div>'; return; }
  list.innerHTML = state.players.map(p => `<div class="list-item"><div><h4>${escapeHtml(p.name)}</h4><p>Handicap ${Number(p.handicap || 0).toFixed(1)}</p></div><button class="icon-btn delete-player" data-id="${p.id}" aria-label="Delete player">✕</button></div>`).join('');
  document.querySelectorAll('.delete-player').forEach(btn => btn.addEventListener('click', () => deletePlayer(btn.dataset.id)));
}
function renderPlayerOptions() {
  const current = $('scorePlayer').value;
  $('scorePlayer').innerHTML = state.players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if (state.players.some(p => p.id === current)) $('scorePlayer').value = current;
  loadCurrentScore();
}
function renderHoleOptions() {
  const current = Number($('scoreHole').value || 1);
  $('scoreHole').innerHTML = Array.from({length: state.tournament.holes}, (_,i) => `<option value="${i+1}">Hole ${i+1}</option>`).join('');
  $('scoreHole').value = Math.min(current, state.tournament.holes);
  updateHoleInfo();
}
function renderLeaderboard() {
  const pars = state.tournament?.pars || [];
  const rows = state.players.map(player => {
    const ps = state.scores.filter(s => s.playerId === player.id);
    const total = ps.reduce((sum,s) => sum + Number(s.strokes), 0);
    const parPlayed = ps.reduce((sum,s) => sum + Number(pars[s.hole-1] || 4), 0);
    return { ...player, total, toPar: total - parPlayed, holesPlayed: ps.length };
  }).sort((a,b) => (a.holesPlayed ? a.toPar : 999) - (b.holesPlayed ? b.toPar : 999) || a.total - b.total || a.name.localeCompare(b.name));
  const board = $('leaderboard');
  if (!rows.length) { board.innerHTML = '<div class="empty">Add players to show the live leaderboard.</div>'; return; }
  board.innerHTML = rows.map((p,i) => {
    const parText = !p.holesPlayed ? '—' : p.toPar === 0 ? 'E' : p.toPar > 0 ? `+${p.toPar}` : p.toPar;
    const cls = p.toPar < 0 ? 'under' : p.toPar > 0 ? 'over' : '';
    return `<div class="leader-row"><div class="place">${i+1}</div><div><div class="player-name">${escapeHtml(p.name)}</div><div class="player-sub">Thru ${p.holesPlayed}</div></div><div class="total">${p.total || '—'}</div><div class="to-par ${cls}">${parText}</div></div>`;
  }).join('');
}
function renderScoreHistory() {
  const playerId = $('scorePlayer').value;
  const pars = state.tournament?.pars || [];
  $('scoreHistory').innerHTML = Array.from({length: state.tournament?.holes || 0}, (_,i) => {
    const score = state.scores.find(s => s.playerId === playerId && Number(s.hole) === i+1);
    return `<div class="score-chip">H${i+1}<strong>${score?.strokes ?? '—'}</strong><span>Par ${pars[i] || 4}</span></div>`;
  }).join('');
}
function renderSettings() {
  const t = state.tournament;
  $('editTournamentName').value = t.name || '';
  $('editCourseName').value = t.course || '';
  $('editTournamentDate').value = t.date || '';
  $('editHoles').value = String(t.holes || 18);
  $('parGrid').innerHTML = (t.pars || defaultPars(t.holes)).map((par,i) => `<div class="par-box"><label>H${i+1}</label><input class="par-input" type="number" min="3" max="6" value="${par}" /></div>`).join('');
}
function updateHoleInfo() {
  const hole = Number($('scoreHole').value || 1);
  const par = state.tournament?.pars?.[hole-1] || 4;
  $('holeInfo').textContent = `Hole ${hole} • Par ${par}`;
}
function loadCurrentScore() {
  const playerId = $('scorePlayer').value;
  const hole = Number($('scoreHole').value || 1);
  const existing = state.scores.find(s => s.playerId === playerId && Number(s.hole) === hole);
  $('scoreValue').value = existing?.strokes ?? state.tournament?.pars?.[hole-1] ?? 4;
  $('scoreValue').textContent = $('scoreValue').value;
  updateHoleInfo(); renderScoreHistory();
}

async function addPlayer() {
  const name = $('playerNameInput').value.trim();
  const handicap = Number($('playerHandicapInput').value || 0);
  if (!name) return toast('Enter a player name');
  await addDoc(collection(state.db, 'tournaments', state.tournamentId, 'players'), { name, handicap, createdAt: serverTimestamp() });
  $('playerNameInput').value = ''; $('playerHandicapInput').value = '0'; toast('Player added');
}
async function deletePlayer(id) {
  if (!confirm('Delete this player and all of their scores?')) return;
  const batch = writeBatch(state.db);
  batch.delete(doc(state.db, 'tournaments', state.tournamentId, 'players', id));
  state.scores.filter(s => s.playerId === id).forEach(s => batch.delete(doc(state.db, 'tournaments', state.tournamentId, 'scores', s.id)));
  await batch.commit();
}
async function saveScore() {
  const playerId = $('scorePlayer').value;
  const hole = Number($('scoreHole').value);
  const strokes = Number($('scoreValue').value);
  if (!playerId) return toast('Add or select a player');
  const scoreId = `${playerId}_${hole}`;
  await setDoc(doc(state.db, 'tournaments', state.tournamentId, 'scores', scoreId), { playerId, hole, strokes, updatedAt: serverTimestamp() });
  toast('Score saved');
  if (hole < state.tournament.holes) { $('scoreHole').value = String(hole + 1); loadCurrentScore(); }
}
async function saveSettings() {
  const holes = Number($('editHoles').value);
  let pars = [...document.querySelectorAll('.par-input')].map(i => Number(i.value));
  if (pars.length !== holes) pars = defaultPars(holes);
  await updateDoc(doc(state.db, 'tournaments', state.tournamentId), {
    name: $('editTournamentName').value.trim(), course: $('editCourseName').value.trim(),
    date: $('editTournamentDate').value, holes, pars
  });
  toast('Settings saved');
}
async function deleteTournament() {
  if (!confirm('Delete this entire tournament? This cannot be undone.')) return;
  const base = doc(state.db, 'tournaments', state.tournamentId);
  const batch = writeBatch(state.db);
  for (const p of state.players) batch.delete(doc(base, 'players', p.id));
  for (const s of state.scores) batch.delete(doc(base, 'scores', s.id));
  batch.delete(base); await batch.commit(); clearSubscriptions(); show('homePanel'); loadTournaments();
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['leaderboard','score','players','settings'].forEach(tab => $(`${tab}Tab`).classList.toggle('hidden', tab !== name));
}
function shareTournament() {
  const url = `${location.origin}${location.pathname}#tournament=${state.tournamentId}`;
  if (navigator.share) navigator.share({ title: state.tournament.name, text: 'Follow the live golf leaderboard', url });
  else navigator.clipboard.writeText(url).then(() => toast('Leaderboard link copied'));
}

$('saveConfigBtn').addEventListener('click', () => {
  try { const config = JSON.parse($('firebaseConfigInput').value); localStorage.setItem('travelLeagueFirebaseConfig', JSON.stringify(config)); location.reload(); }
  catch { toast('Configuration must be valid JSON'); }
});
$('clearConfigBtn').addEventListener('click', () => { localStorage.removeItem('travelLeagueFirebaseConfig'); $('firebaseConfigInput').value=''; });
$('newTournamentBtn').addEventListener('click', () => { $('newTournamentDate').value = new Date().toISOString().slice(0,10); $('newTournamentDialog').showModal(); });
$('createTournamentBtn').addEventListener('click', e => { e.preventDefault(); createTournament(); });
$('refreshBtn').addEventListener('click', loadTournaments);
$('backBtn').addEventListener('click', () => { clearSubscriptions(); location.hash=''; show('homePanel'); loadTournaments(); });
$('shareBtn').addEventListener('click', shareTournament);
$('addPlayerBtn').addEventListener('click', addPlayer);
$('saveScoreBtn').addEventListener('click', saveScore);
$('scorePlayer').addEventListener('change', loadCurrentScore);
$('scoreHole').addEventListener('change', loadCurrentScore);
$('scoreMinus').addEventListener('click', () => { $('scoreValue').value = Math.max(1, Number($('scoreValue').value)-1); $('scoreValue').textContent = $('scoreValue').value; });
$('scorePlus').addEventListener('click', () => { $('scoreValue').value = Math.min(20, Number($('scoreValue').value)+1); $('scoreValue').textContent = $('scoreValue').value; });
$('saveSettingsBtn').addEventListener('click', saveSettings);
$('deleteTournamentBtn').addEventListener('click', deleteTournament);
$('editHoles').addEventListener('change', () => {
  const holes = Number($('editHoles').value); const pars = defaultPars(holes);
  $('parGrid').innerHTML = pars.map((par,i) => `<div class="par-box"><label>H${i+1}</label><input class="par-input" type="number" min="3" max="6" value="${par}" /></div>`).join('');
});
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt=e; $('installBtn').classList.remove('hidden'); });
$('installBtn').addEventListener('click', async () => { if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('installBtn').classList.add('hidden'); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(console.error);

await connect();
const match = location.hash.match(/tournament=([^&]+)/);
if (match && state.db) openTournament(match[1]);
