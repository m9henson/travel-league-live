(function () {
  'use strict';

  const APP_VERSION = '9.0.0';
  const POLL_INTERVAL_MS = 3500;
  const $ = (id) => document.getElementById(id);

  const state = {
    store: null,
    config: null,
    tournaments: [],
    tournament: null,
    tournamentId: null,
    players: [],
    scores: [],
    pollTimer: null,
    refreshing: false,
    currentScore: 4,
    activeTab: 'leaderboard',
    savingScore: false,
    auth: null,
    access: { role: 'spectator', group: null },
    linkToken: null,
    spectatorMode: false
  };

  const PAR_PATTERN = [4, 4, 3, 5, 4, 4, 3, 5, 4];
  const DEFAULT_SI_9 = [1, 5, 7, 3, 9, 2, 8, 4, 6];
  const DEFAULT_SI_18 = [1, 10, 17, 5, 13, 3, 15, 7, 11, 2, 12, 18, 6, 14, 4, 16, 8, 9];

  function defaultPars(holes) {
    return Array.from({ length: holes }, (_, index) => PAR_PATTERN[index % 9]);
  }

  function defaultStrokeIndexes(holes) {
    return holes === 9 ? [...DEFAULT_SI_9] : [...DEFAULT_SI_18];
  }

  function makeId(prefix) {
    const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now()}${Math.random().toString(16).slice(2)}`;
    return `${prefix}_${random}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  function scoringModeName(mode) {
    return mode === 'net' ? 'Individual net stroke play' : 'Individual gross stroke play';
  }

  function showOnly(panelId) {
    ['homePanel', 'setupPanel', 'tournamentPanel', 'fatalErrorPanel'].forEach((id) => {
      $(id).classList.toggle('hidden', id !== panelId);
    });
  }

  function setBanner(message, type) {
    const banner = $('connectionBanner');
    banner.textContent = message;
    banner.classList.remove('connected', 'error');
    if (type) banner.classList.add(type);
  }

  let toastTimer;
  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.add('hidden'), 2500);
  }

  function showFatal(error, introduction) {
    console.error(error);
    const detail = error?.message ? ` ${error.message}` : '';
    $('fatalErrorMessage').textContent = `${introduction || 'The app could not complete that request.'}${detail}`;
    setBanner('Connection problem — details are shown below.', 'error');
    showOnly('fatalErrorPanel');
  }

  function parseConfig() {
    const params = new URLSearchParams(location.search);
    if (params.has('setup')) return null;

    const fileConfig = window.TRAVEL_LEAGUE_FIREBASE_CONFIG;
    if (fileConfig?.projectId && fileConfig?.apiKey) return fileConfig;

    try {
      const saved = JSON.parse(localStorage.getItem('travelLeagueFirebaseConfig') || 'null');
      return saved?.projectId && saved?.apiKey ? saved : null;
    } catch {
      return null;
    }
  }

  function normalizeTournament(raw) {
    const holes = Number(raw?.holes) === 9 ? 9 : 18;
    const originalMode = raw?.scoringMode || 'gross';
    const scoringMode = originalMode === 'handicap' ? 'net' : (originalMode === 'net' ? 'net' : 'gross');
    const pars = Array.isArray(raw?.pars) && raw.pars.length === holes
      ? raw.pars.map((value) => Number(value) || 4)
      : defaultPars(holes);
    const strokeIndexes = Array.isArray(raw?.strokeIndexes) && raw.strokeIndexes.length === holes
      ? raw.strokeIndexes.map((value) => Number(value) || 1)
      : defaultStrokeIndexes(holes);

    return {
      ...raw,
      holes,
      scoringMode,
      handicapAllowance: Number(raw?.handicapAllowance ?? 1),
      pars,
      strokeIndexes,
      handicapSkinHoles: Array.isArray(raw?.handicapSkinHoles)
        ? raw.handicapSkinHoles.map(Number).filter((hole) => hole >= 1 && hole <= holes)
        : [],
      blindSkinHoles: Array.isArray(raw?.blindSkinHoles)
        ? raw.blindSkinHoles.map(Number).filter((hole) => hole >= 1 && hole <= holes)
        : []
    };
  }

  function normalizePlayer(raw) {
    return {
      ...raw,
      courseHandicap: Math.round(Number(raw?.courseHandicap ?? raw?.handicap ?? 0)),
      group: Math.max(1, Math.min(6, Math.round(Number(raw?.group || 1))))
    };
  }

  function normalizeScore(raw) {
    return {
      ...raw,
      hole: Number(raw?.hole),
      gross: Number(raw?.gross ?? raw?.strokes)
    };
  }

  function encodeFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return { nullValue: null };
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'object') return { mapValue: { fields: encodeFirestoreFields(value) } };
    return { stringValue: String(value) };
  }

  function encodeFirestoreFields(object) {
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  }

  function decodeFirestoreValue(value) {
    if (!value || 'nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
    if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {});
    return null;
  }

  function decodeFirestoreFields(fields) {
    return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]));
  }

  class RestStore {
    constructor(config, getToken) {
      this.getToken = getToken;
      this.projectId = config.projectId;
      this.apiKey = config.apiKey;
      this.baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents`;
    }

    buildUrl(path) {
      const safePath = String(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
      return `${this.baseUrl}/${safePath}?key=${encodeURIComponent(this.apiKey)}`;
    }

    async request(path, options = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(this.buildUrl(path), {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...(this.getToken?.() ? { Authorization: `Bearer ${this.getToken()}` } : {}),
            ...(options.headers || {})
          },
          signal: controller.signal,
          cache: 'no-store'
        });

        if (response.status === 404 && options.allowNotFound) return null;

        let payload = null;
        const text = await response.text();
        if (text) {
          try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
        }

        if (!response.ok) {
          const message = payload?.error?.message || payload?.raw || `Firebase returned ${response.status}`;
          throw new Error(message);
        }
        return payload;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('Firebase took too long to respond. Check your connection.');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    async list(collectionPath) {
      const payload = await this.request(collectionPath);
      return (payload?.documents || []).map((document) => ({
        id: document.name.split('/').pop(),
        ...decodeFirestoreFields(document.fields)
      }));
    }

    async get(documentPath) {
      const document = await this.request(documentPath, { allowNotFound: true });
      if (!document) return null;
      return { id: document.name.split('/').pop(), ...decodeFirestoreFields(document.fields) };
    }

    async set(documentPath, data) {
      const document = await this.request(documentPath, {
        method: 'PATCH',
        body: JSON.stringify({ fields: encodeFirestoreFields(data) })
      });
      return { id: document.name.split('/').pop(), ...decodeFirestoreFields(document.fields) };
    }

    async delete(documentPath) {
      await this.request(documentPath, { method: 'DELETE', allowNotFound: true });
    }
  }

  class DemoStore {
    constructor() {
      this.key = 'travelLeagueDemoDatabaseV3';
      this.data = this.load();
      if (!Object.keys(this.data).length) this.seed();
    }

    load() {
      try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch { return {}; }
    }

    persist() { localStorage.setItem(this.key, JSON.stringify(this.data)); }

    seed() {
      const tournamentId = 't_demo_event';
      this.data[`tournaments/${tournamentId}`] = {
        name: 'Demo Travel League Event', course: 'Silo Ridge', date: new Date().toISOString().slice(0, 10),
        holes: 18, scoringMode: 'net', handicapAllowance: 1,
        pars: defaultPars(18), strokeIndexes: defaultStrokeIndexes(18), createdAt: Date.now()
      };
      this.data[`tournaments/${tournamentId}/players/p_matt`] = { name: 'Matt', courseHandicap: 12, createdAt: Date.now() };
      this.data[`tournaments/${tournamentId}/players/p_player2`] = { name: 'Player 2', courseHandicap: 8, createdAt: Date.now() };
      this.persist();
    }

    async list(collectionPath) {
      const prefix = `${collectionPath}/`;
      return Object.entries(this.data)
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, value]) => ({ id: path.split('/').pop(), ...structuredClone(value) }));
    }

    async get(documentPath) {
      return this.data[documentPath] ? { id: documentPath.split('/').pop(), ...structuredClone(this.data[documentPath]) } : null;
    }

    async set(documentPath, data) {
      this.data[documentPath] = structuredClone(data);
      this.persist();
      return { id: documentPath.split('/').pop(), ...structuredClone(data) };
    }

    async delete(documentPath) {
      Object.keys(this.data).forEach((path) => {
        if (path === documentPath || path.startsWith(`${documentPath}/`)) delete this.data[path];
      });
      this.persist();
    }
  }

  function authStorageKey() { return `travelLeagueAuth:${state.config?.projectId || 'demo'}`; }

  async function ensureAnonymousAuth() {
    if (!state.config?.apiKey) return null;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(authStorageKey()) || 'null'); } catch {}
    if (saved?.refreshToken) {
      try {
        const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(state.config.apiKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken })
        });
        if (response.ok) {
          const data = await response.json();
          state.auth = { uid: data.user_id, idToken: data.id_token, refreshToken: data.refresh_token };
          localStorage.setItem(authStorageKey(), JSON.stringify(state.auth));
          return state.auth;
        }
      } catch (error) { console.warn('Token refresh failed', error); }
    }
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(state.config.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Anonymous sign-in failed');
    state.auth = { uid: data.localId, idToken: data.idToken, refreshToken: data.refreshToken };
    localStorage.setItem(authStorageKey(), JSON.stringify(state.auth));
    return state.auth;
  }

  function baseUrl() { return `${location.origin}${location.pathname}`; }
  function isAdmin() { return state.access.role === 'admin'; }
  function isGroupScorer() { return state.access.role === 'group'; }
  function canEditGroup(group) { return isAdmin() || (isGroupScorer() && Number(state.access.group) === Number(group)); }

  async function redeemAccessLink(token) {
    const link = await state.store.get(`accessLinks/${token}`);
    if (!link || link.active === false) throw new Error('This private scoring link is invalid or has been replaced.');
    await state.store.set(`accessClaims/${state.auth.uid}`, {
      uid: state.auth.uid, token, tournamentId: link.tournamentId,
      role: link.role, group: link.group || null, claimedAt: Date.now()
    });
    state.access = { role: link.role, group: link.group || null };
    state.linkToken = token;
    return link;
  }

  async function resolveAccess(tournamentId) {
    if (state.spectatorMode) { state.access = { role: 'spectator', group: null }; return; }
    if (state.tournament?.ownerUid && state.tournament.ownerUid === state.auth?.uid) {
      state.access = { role: 'admin', group: null }; return;
    }
    const claim = state.auth ? await state.store.get(`accessClaims/${state.auth.uid}`) : null;
    if (claim?.tournamentId === tournamentId) state.access = { role: claim.role, group: claim.group || null };
    else state.access = { role: 'spectator', group: null };
  }

  function applyAccessUI() {
    const admin = isAdmin();
    const group = isGroupScorer();
    const badge = $('accessBadge');
    badge.textContent = admin ? 'ADMIN' : group ? `GROUP ${state.access.group}` : 'SPECTATOR';
    badge.className = `access-badge ${admin ? 'admin' : group ? 'group' : ''}`;
    document.querySelectorAll('.tab[data-tab="players"], .tab[data-tab="settings"]').forEach((button) => button.classList.toggle('hidden', !admin));
    const scoreButton = document.querySelector('.tab[data-tab="score"]');
    scoreButton.classList.toggle('hidden', !(admin || group));
    $('backToHome').classList.toggle('hidden', state.spectatorMode || group);
    $('secureLinksPanel')?.classList.toggle('hidden', !admin);
    if (group) {
      $('scoreGroup').value = String(state.access.group);
      $('scoreGroup').disabled = true;
    } else $('scoreGroup').disabled = !admin;
  }

  async function claimExistingTournamentOwnership() {
    if (!state.auth || state.tournament.ownerUid) return;
    await state.store.set(`tournaments/${state.tournamentId}`, { ...state.tournament, ownerUid: state.auth.uid, updatedAt: Date.now() });
    state.tournament.ownerUid = state.auth.uid;
    state.access = { role: 'admin', group: null };
  }

  function secureToken() {
    const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function generateSecureLinks() {
    if (!isAdmin()) return toast('Administrator access required');
    const button = $('generateSecureLinks'); button.disabled = true;
    try {
      const roles = [{ key: 'admin', role: 'admin', label: 'Administrator' }, ...Array.from({length:6}, (_,i)=>({key:`group${i+1}`,role:'group',group:i+1,label:`Group ${i+1}`}))];
      const saved = {};
      for (const item of roles) {
        const old = await state.store.get(`tournaments/${state.tournamentId}/privateLinks/${item.key}`);
        if (old?.token) await state.store.set(`accessLinks/${old.token}`, { ...old, active: false, replacedAt: Date.now() });
        const token = secureToken();
        const linkData = { tournamentId: state.tournamentId, role: item.role, group: item.group || null, label: item.label, active: true, createdAt: Date.now(), token };
        await state.store.set(`accessLinks/${token}`, linkData);
        await state.store.set(`tournaments/${state.tournamentId}/privateLinks/${item.key}`, linkData);
        saved[item.key] = linkData;
      }
      await renderSecureLinks(); toast('New secure links generated');
    } catch (error) { showFatal(error, 'Secure links could not be generated.'); }
    finally { button.disabled = false; }
  }

  async function makeActiveTournament() {
    if (!isAdmin()) return toast('Administrator access required');
    await state.store.set('publicConfig/active', { tournamentId: state.tournamentId, updatedAt: Date.now() });
    toast('This tournament is now on the permanent spectator link');
  }

  async function renderSecureLinks() {
    if (!isAdmin()) return;
    const items = [];
    for (const key of ['admin','group1','group2','group3','group4','group5','group6']) {
      const link = await state.store.get(`tournaments/${state.tournamentId}/privateLinks/${key}`);
      if (link?.token) items.push(link);
    }
    const spectator = `${baseUrl()}?spectator=1`;
    $('secureLinksList').innerHTML = `<div class="secure-link-row"><div><strong>Permanent Spectator</strong><small>${escapeHtml(spectator)}</small></div><button data-copy-link="${escapeHtml(spectator)}">Copy</button></div>` +
      (items.length ? items.map(item => { const url=`${baseUrl()}?t=${encodeURIComponent(state.tournamentId)}&access=${encodeURIComponent(item.token)}`; return `<div class="secure-link-row"><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(url)}</small></div><button data-copy-link="${escapeHtml(url)}">Copy</button></div>`; }).join('') : '<div class="empty-state">Generate links to begin.</div>');
  }

  async function clearOldOfflineCache() {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.warn('Old cache cleanup was not completed:', error);
    }
  }

  async function init() {
    bindEvents();
    await clearOldOfflineCache();

    window.addEventListener('error', (event) => {
      setBanner(`App error: ${event.message || 'unknown error'}`, 'error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      setBanner(`App error: ${event.reason?.message || 'request failed'}`, 'error');
    });

    const params = new URLSearchParams(location.search);
    if (params.has('demo')) {
      state.store = new DemoStore();
      setBanner(`Demo mode connected • Travel League Live ${APP_VERSION}`, 'connected');
    } else {
      state.config = parseConfig();
      if (!state.config) {
        setBanner('Firebase configuration is needed.', 'error');
        showOnly('setupPanel');
        return;
      }
      await ensureAnonymousAuth();
      state.store = new RestStore(state.config, () => state.auth?.idToken);
      setBanner('Connecting securely to Firebase…');
    }

    try {
      const accessToken = params.get('access');
      state.spectatorMode = params.has('spectator');
      if (accessToken) {
        const link = await redeemAccessLink(accessToken);
        await openTournament(link.tournamentId, link.role === 'group' ? 'score' : 'leaderboard', false);
      } else if (state.spectatorMode) {
        const active = await state.store.get('publicConfig/active');
        if (!active?.tournamentId) throw new Error('No active tournament has been selected for spectators.');
        await openTournament(active.tournamentId, 'leaderboard', false);
      } else {
        await loadHome();
        const route = readRoute();
        if (route.tournamentId) await openTournament(route.tournamentId, route.tab || 'leaderboard', false);
        else showOnly('homePanel');
      }
      if (!params.has('demo')) setBanner(`Connected to Firebase • Travel League Live ${APP_VERSION}`, 'connected');
    } catch (error) {
      showFatal(error, 'Firebase could not load your tournaments. Check Firestore Database and Security Rules.');
    }
  }

  function bindEvents() {
    $('brandButton').addEventListener('click', goHome);
    $('refreshHome').addEventListener('click', () => loadHome(true));
    $('openCreateTournament').addEventListener('click', openCreateDialog);
    $('closeCreateTournament').addEventListener('click', closeCreateDialog);
    $('createTournamentForm').addEventListener('submit', createTournament);
    $('backToHome').addEventListener('click', goHome);
    $('shareTournament').addEventListener('click', shareTournament);

    document.querySelectorAll('.tab').forEach((button) => {
      button.addEventListener('click', () => switchTab(button.dataset.tab, true));
    });

    $('scoreGroup').addEventListener('change', renderGroupScore);
    $('scoreHole').addEventListener('change', renderGroupScore);
    $('previousGroupHole').addEventListener('click', () => moveGroupHole(-1));
    $('nextGroupHole').addEventListener('click', () => moveGroupHole(1));
    $('groupScoreGrid').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-player-id][data-score]');
      if (!button || state.savingScore) return;
      await saveGroupPlayerScore(button.dataset.playerId, Number(button.dataset.score));
    });
    $('addPlayer').addEventListener('click', addPlayer);
    $('newPlayerName').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addPlayer();
    });
    $('editHoles').addEventListener('change', () => renderHoleSettings(Number($('editHoles').value)));
    $('editScoringMode').addEventListener('change', updateSettingsAllowanceState);
    $('saveTournamentSettings').addEventListener('click', saveTournamentSettings);
    $('deleteTournament').addEventListener('click', deleteTournament);
    $('generateSecureLinks').addEventListener('click', generateSecureLinks);
    $('makeActiveTournament').addEventListener('click', makeActiveTournament);
    $('secureLinksList').addEventListener('click', async (event) => { const button=event.target.closest('[data-copy-link]'); if(!button)return; await navigator.clipboard.writeText(button.dataset.copyLink); toast('Link copied'); });

    $('saveFirebaseConfig').addEventListener('click', saveFirebaseConfig);
    $('clearFirebaseConfig').addEventListener('click', () => {
      localStorage.removeItem('travelLeagueFirebaseConfig');
      $('firebaseConfigInput').value = '';
      toast('Saved browser configuration cleared');
    });
    $('retryApp').addEventListener('click', () => location.reload());
    $('showSetup').addEventListener('click', () => showOnly('setupPanel'));

    window.addEventListener('hashchange', async () => {
      const route = readRoute();
      if (route.tournamentId && route.tournamentId !== state.tournamentId) {
        await openTournament(route.tournamentId, route.tab || 'leaderboard', false);
      } else if (!route.tournamentId && state.tournamentId) {
        goHome(false);
      } else if (route.tab && state.tournamentId) {
        switchTab(route.tab, false);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.tournamentId) refreshTournamentData(false);
    });
  }

  function readRoute() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { tournamentId: params.get('tournament'), tab: params.get('tab') };
  }

  function writeRoute(tournamentId, tab) {
    if (!tournamentId) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      return;
    }
    const params = new URLSearchParams({ tournament: tournamentId, tab: tab || 'leaderboard' });
    history.replaceState(null, '', `${location.pathname}${location.search}#${params.toString()}`);
  }

  async function loadHome(showMessage) {
    if (showMessage) setBanner('Refreshing tournaments…');
    const tournaments = await state.store.list('tournaments');
    state.tournaments = tournaments.map(normalizeTournament).sort((a, b) => {
      return String(b.date || '').localeCompare(String(a.date || '')) || Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
    renderTournamentList();
    if (showMessage) {
      setBanner('Tournament list refreshed.', 'connected');
      toast('Tournaments refreshed');
    }
  }

  function renderTournamentList() {
    const list = $('tournamentList');
    if (!state.tournaments.length) {
      list.innerHTML = '<div class="empty-state"><strong>No tournaments yet.</strong><br>Create your first event to begin live scoring.</div>';
      return;
    }

    list.innerHTML = state.tournaments.map((tournament) => {
      const label = tournament.scoringMode === 'net'
        ? `Net • ${Math.round(tournament.handicapAllowance * 100)}% allowance`
        : 'Gross';
      return `
        <button class="list-item tournament-link" type="button" data-id="${escapeHtml(tournament.id)}">
          <div>
            <h3>${escapeHtml(tournament.name || 'Unnamed Tournament')}</h3>
            <p>${escapeHtml(tournament.course || 'Course not set')} • ${escapeHtml(formatDate(tournament.date))} • ${tournament.holes} holes</p>
            <span class="pill">${label}</span>
          </div>
          <span class="chevron" aria-hidden="true">›</span>
        </button>`;
    }).join('');

    list.querySelectorAll('.tournament-link').forEach((button) => {
      button.addEventListener('click', () => openTournament(button.dataset.id, 'leaderboard', true));
    });
  }

  function openCreateDialog() {
    $('newTournamentDate').value = new Date().toISOString().slice(0, 10);
    const dialog = $('createTournamentDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeCreateDialog() {
    const dialog = $('createTournamentDialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  async function createTournament(event) {
    event.preventDefault();
    const name = $('newTournamentName').value.trim();
    const course = $('newCourseName').value.trim();
    const date = $('newTournamentDate').value;
    const holes = Number($('newHoles').value) === 9 ? 9 : 18;
    const scoringMode = $('newScoringMode').value === 'net' ? 'net' : 'gross';
    const handicapAllowance = Number($('newHandicapAllowance').value || 1);

    if (!name || !course || !date) {
      toast('Enter the tournament name, course, and date');
      return;
    }

    const button = event.submitter;
    if (button) button.disabled = true;
    try {
      const id = makeId('t');
      await state.store.set(`tournaments/${id}`, {
        name, course, date, holes, scoringMode, handicapAllowance,
        pars: defaultPars(holes), strokeIndexes: defaultStrokeIndexes(holes), ownerUid: state.auth?.uid || null, createdAt: Date.now()
      });
      closeCreateDialog();
      event.target.reset();
      await loadHome();
      await openTournament(id, 'players', true);
      toast('Tournament created — add your players');
    } catch (error) {
      showFatal(error, 'The tournament could not be created.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function openTournament(id, tab = 'leaderboard', updateRoute = true) {
    stopPolling();
    setBanner('Opening tournament…');
    try {
      const [tournament, players, scores] = await Promise.all([
        state.store.get(`tournaments/${id}`),
        state.store.list(`tournaments/${id}/players`),
        state.store.list(`tournaments/${id}/scores`)
      ]);
      if (!tournament) throw new Error('Tournament not found. It may have been deleted.');

      state.tournamentId = id;
      state.tournament = normalizeTournament({ id, ...tournament });
      state.players = players.map(normalizePlayer).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      state.scores = scores.map(normalizeScore).filter((score) => Number.isFinite(score.hole) && Number.isFinite(score.gross));
      await resolveAccess(id);
      if (!state.spectatorMode && !state.linkToken && !state.tournament.ownerUid) await claimExistingTournamentOwnership();
      renderTournament();
      applyAccessUI();
      if (isAdmin()) await renderSecureLinks();
      showOnly('tournamentPanel');
      switchTab(tab, false);
      if (updateRoute) writeRoute(id, tab);
      setBanner('Live leaderboard connected.', 'connected');
      startPolling();
    } catch (error) {
      showFatal(error, 'The tournament could not be opened.');
    }
  }

  function renderTournament() {
    const tournament = state.tournament;
    $('tournamentName').textContent = tournament.name || 'Tournament';
    $('tournamentMeta').textContent = `${tournament.course || ''} • ${formatDate(tournament.date)} • ${tournament.holes} holes`;
    $('tournamentScoringSummary').textContent = tournament.scoringMode === 'net'
      ? `${scoringModeName('net')} • ${Math.round(tournament.handicapAllowance * 100)}% handicap allowance`
      : scoringModeName('gross');
    $('leaderboardMode').textContent = tournament.scoringMode === 'net'
      ? 'Ranked by net score relative to par.'
      : 'Ranked by gross score relative to par.';

    renderPlayers();
    renderGroupOptions();
    renderHoleOptions();
    renderLeaderboard();
    renderSkins();
    renderSettings();
  }

  function renderPlayers() {
    const list = $('playerList');
    if (!state.players.length) {
      list.innerHTML = '<div class="empty-state">No players yet. Add everyone playing in this event.</div>';
      return;
    }

    list.innerHTML = state.players.map((player) => `
      <div class="list-item player-list-item">
        <div>
          <h3>${escapeHtml(player.name)}</h3>
          <p>Course handicap: ${player.courseHandicap}</p>
        </div>
        <div class="player-row-actions">
          <select class="player-group-select" data-id="${escapeHtml(player.id)}" aria-label="Group for ${escapeHtml(player.name)}">
            ${Array.from({length:6}, (_,i) => `<option value="${i+1}" ${player.group === i+1 ? 'selected' : ''}>Group ${i+1}</option>`).join('')}
          </select>
          <button class="delete-small delete-player" type="button" data-id="${escapeHtml(player.id)}" aria-label="Delete ${escapeHtml(player.name)}">✕</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('.delete-player').forEach((button) => {
      button.addEventListener('click', () => deletePlayer(button.dataset.id));
    });
    list.querySelectorAll('.player-group-select').forEach((select) => {
      select.addEventListener('change', () => updatePlayerGroup(select.dataset.id, Number(select.value)));
    });
  }

  async function updatePlayerGroup(playerId, group) {
    if (!isAdmin()) { toast('Administrator access required'); return; }
    const player = state.players.find((item) => item.id === playerId);
    if (!player) return;
    if (!canEditGroup(player.group)) { toast('This link cannot edit that group'); return; }
    try {
      await state.store.set(`tournaments/${state.tournamentId}/players/${playerId}`, {
        name: player.name,
        courseHandicap: player.courseHandicap,
        group: Math.max(1, Math.min(6, group)),
        createdAt: player.createdAt || Date.now()
      });
      await refreshTournamentData(false);
      toast(`${player.name} moved to Group ${group}`);
    } catch (error) {
      showFatal(error, 'The player group could not be updated.');
    }
  }

  function renderGroupOptions() {
    const select = $('scoreGroup');
    const previous = Number(select.value || 1);
    select.innerHTML = Array.from({length:6}, (_, index) => {
      const group = index + 1;
      const count = state.players.filter((player) => player.group === group).length;
      return `<option value="${group}">Group ${group} (${count})</option>`;
    }).join('');
    select.value = String(Math.max(1, Math.min(6, previous)));
    renderGroupScore();
  }

  function renderHoleOptions() {
    const select = $('scoreHole');
    const previous = Math.min(Number(select.value || 1), state.tournament.holes);
    select.innerHTML = Array.from({ length: state.tournament.holes }, (_, index) => `<option value="${index + 1}">Hole ${index + 1}</option>`).join('');
    select.value = String(previous || 1);
    renderGroupScore();
  }

  function playingHandicap(player) {
    return Math.round(Number(player?.courseHandicap || 0) * Number(state.tournament?.handicapAllowance ?? 1));
  }

  function strokesOnHole(player, hole) {
    const handicap = playingHandicap(player);
    if (!handicap) return 0;
    const holes = state.tournament.holes;
    const strokeIndex = Number(state.tournament.strokeIndexes[hole - 1] || hole);
    const sign = handicap < 0 ? -1 : 1;
    const absolute = Math.abs(handicap);
    const fullStrokes = Math.floor(absolute / holes);
    const remaining = absolute % holes;
    return sign * (fullStrokes + (strokeIndex <= remaining ? 1 : 0));
  }

  function playerStats(player) {
    const byHole = new Map();
    state.scores
      .filter((score) => score.playerId === player.id && score.hole >= 1 && score.hole <= state.tournament.holes)
      .forEach((score) => byHole.set(score.hole, score));

    let gross = 0;
    let net = 0;
    let par = 0;
    const completedHoles = [...byHole.keys()].sort((a, b) => a - b);
    completedHoles.forEach((hole) => {
      const grossScore = Number(byHole.get(hole).gross);
      gross += grossScore;
      net += grossScore - strokesOnHole(player, hole);
      par += Number(state.tournament.pars[hole - 1] || 4);
    });

    const displayTotal = state.tournament.scoringMode === 'net' ? net : gross;
    return {
      player,
      gross,
      net,
      par,
      displayTotal,
      toPar: displayTotal - par,
      holesPlayed: completedHoles.length
    };
  }

  function renderLeaderboard() {
    const leaderboard = $('leaderboard');
    if (!state.players.length) {
      leaderboard.innerHTML = '<div class="empty-state">Add players to begin the leaderboard.</div>';
      return;
    }

    const rows = state.players.map(playerStats).sort((a, b) => {
      const aStarted = a.holesPlayed > 0 ? 0 : 1;
      const bStarted = b.holesPlayed > 0 ? 0 : 1;
      return aStarted - bStarted || a.toPar - b.toPar || b.holesPlayed - a.holesPlayed || a.displayTotal - b.displayTotal || String(a.player.name).localeCompare(String(b.player.name));
    });

    let previousKey = null;
    let previousPosition = 0;
    leaderboard.innerHTML = rows.map((row, index) => {
      const scoreText = !row.holesPlayed ? '—' : row.toPar === 0 ? 'E' : row.toPar > 0 ? `+${row.toPar}` : String(row.toPar);
      const scoreClass = row.toPar < 0 ? 'under' : row.toPar > 0 ? 'over' : '';
      const key = row.holesPlayed ? `${row.toPar}|${row.holesPlayed}` : `not-started-${index}`;
      const position = key === previousKey ? previousPosition : index + 1;
      previousKey = key;
      previousPosition = position;
      const detail = !row.holesPlayed
        ? `CH ${row.player.courseHandicap} • Not started`
        : state.tournament.scoringMode === 'net'
          ? `Gross ${row.gross} • Net ${row.net} • CH ${row.player.courseHandicap}`
          : `Gross ${row.gross} • CH ${row.player.courseHandicap}`;

      return `
        <div class="leaderboard-row">
          <div class="place">${position}</div>
          <div>
            <div class="player-name">${escapeHtml(row.player.name)}</div>
            <div class="player-detail">${detail}</div>
          </div>
          <div class="thru">${row.holesPlayed || '—'}</div>
          <div class="score-to-par ${scoreClass}">${scoreText}</div>
        </div>`;
    }).join('');
  }

  function renderGroupScore() {
    if (!state.tournament) return;
    const group = isGroupScorer() ? Number(state.access.group) : Number($('scoreGroup').value || 1);
    const hole = Math.max(1, Math.min(state.tournament.holes, Number($('scoreHole').value || 1)));
    const par = Number(state.tournament.pars[hole - 1] || 4);
    const strokeIndex = Number(state.tournament.strokeIndexes[hole - 1] || hole);
    $('holeInfo').textContent = `Group ${group} • Hole ${hole} • Par ${par} • Stroke index ${strokeIndex}`;

    const players = state.players.filter((player) => player.group === group);
    const grid = $('groupScoreGrid');
    if (!players.length) {
      grid.innerHTML = `<div class="empty-state">No players are assigned to Group ${group}. Assign players from the Players tab.</div>`;
      $('scoreSaveStatus').textContent = `Group ${group} has no players`;
      return;
    }

    grid.innerHTML = players.map((player) => {
      const existing = state.scores.find((score) => score.playerId === player.id && score.hole === hole);
      const received = strokesOnHole(player, hole);
      const net = existing ? existing.gross - received : null;
      const detail = state.tournament.scoringMode === 'net'
        ? `CH ${player.courseHandicap} • ${received ? `${received > 0 ? 'Gets' : 'Gives'} ${Math.abs(received)}` : 'No stroke'}${existing ? ` • Net ${net}` : ''}`
        : `Course handicap ${player.courseHandicap}`;
      return `<section class="group-player-card" data-player-card="${escapeHtml(player.id)}">
        <div class="group-player-head">
          <div><h3>${escapeHtml(player.name)}</h3><p>${detail}</p></div>
          <output>${existing ? existing.gross : '—'}</output>
        </div>
        <div class="player-score-pad" aria-label="Score for ${escapeHtml(player.name)}">
          ${Array.from({length:12}, (_, index) => {
            const score = index + 1;
            return `<button type="button" data-player-id="${escapeHtml(player.id)}" data-score="${score}" class="${existing?.gross === score ? 'selected' : ''}">${score}</button>`;
          }).join('')}
        </div>
      </section>`;
    }).join('');

    const completed = players.filter((player) => state.scores.some((score) => score.playerId === player.id && score.hole === hole)).length;
    $('scoreSaveStatus').textContent = `${completed} of ${players.length} players scored on Hole ${hole}`;
  }

  async function saveGroupPlayerScore(playerId, score) {
    const hole = Number($('scoreHole').value || 1);
    const player = state.players.find((item) => item.id === playerId);
    if (!player) return;
    state.savingScore = true;
    const grid = $('groupScoreGrid');
    grid.classList.add('saving');
    try {
      await state.store.set(`tournaments/${state.tournamentId}/scores/${playerId}_${hole}`, {
        playerId,
        hole,
        gross: Math.max(1, Math.min(12, score)),
        updatedAt: Date.now()
      });
      const existingIndex = state.scores.findIndex((item) => item.playerId === playerId && item.hole === hole);
      const saved = { id: `${playerId}_${hole}`, playerId, hole, gross: score, updatedAt: Date.now() };
      if (existingIndex >= 0) state.scores[existingIndex] = saved; else state.scores.push(saved);
      renderGroupScore();
      renderLeaderboard();
      toast(`${player.name}: ${score} saved`);
    } catch (error) {
      showFatal(error, 'The score could not be saved.');
    } finally {
      state.savingScore = false;
      grid.classList.remove('saving');
    }
  }

  function moveGroupHole(change) {
    const current = Number($('scoreHole').value || 1);
    const next = Math.max(1, Math.min(state.tournament.holes, current + change));
    $('scoreHole').value = String(next);
    renderGroupScore();
    document.getElementById('scoreTab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function addPlayer() {
    if (!isAdmin()) { toast('Administrator access required'); return; }
    const name = $('newPlayerName').value.trim();
    const courseHandicap = Math.round(Number($('newPlayerHandicap').value || 0));
    const group = Math.max(1, Math.min(6, Number($('newPlayerGroup').value || 1)));
    if (!name) {
      toast('Enter the player name');
      return;
    }
    if (courseHandicap < -10 || courseHandicap > 54) {
      toast('Course handicap must be between -10 and 54');
      return;
    }

    const button = $('addPlayer');
    button.disabled = true;
    try {
      const id = makeId('p');
      await state.store.set(`tournaments/${state.tournamentId}/players/${id}`, {
        name, courseHandicap, group, createdAt: Date.now()
      });
      $('newPlayerName').value = '';
      $('newPlayerHandicap').value = '0';
      await refreshTournamentData(false);
      toast('Player added');
    } catch (error) {
      showFatal(error, 'The player could not be added.');
    } finally {
      button.disabled = false;
    }
  }

  async function deletePlayer(playerId) {
    if (!isAdmin()) { toast('Administrator access required'); return; }
    const player = state.players.find((item) => item.id === playerId);
    if (!confirm(`Delete ${player?.name || 'this player'} and all of their scores?`)) return;
    try {
      const scoreDeletes = state.scores
        .filter((score) => score.playerId === playerId)
        .map((score) => state.store.delete(`tournaments/${state.tournamentId}/scores/${score.id}`));
      await Promise.all([
        ...scoreDeletes,
        state.store.delete(`tournaments/${state.tournamentId}/players/${playerId}`)
      ]);
      await refreshTournamentData(false);
      toast('Player deleted');
    } catch (error) {
      showFatal(error, 'The player could not be deleted.');
    }
  }

  function renderSettings() {
    const tournament = state.tournament;
    $('editTournamentName').value = tournament.name || '';
    $('editCourseName').value = tournament.course || '';
    $('editTournamentDate').value = tournament.date || '';
    $('editHoles').value = String(tournament.holes);
    $('editScoringMode').value = tournament.scoringMode;
    $('editHandicapAllowance').value = String(tournament.handicapAllowance);
    renderHoleSettings(tournament.holes, tournament.pars, tournament.strokeIndexes);
    updateSettingsAllowanceState();
  }

  function updateSettingsAllowanceState() {
    $('editHandicapAllowance').disabled = $('editScoringMode').value !== 'net';
  }

  function renderHoleSettings(holes, suppliedPars, suppliedIndexes) {
    const useCurrent = holes === state.tournament?.holes;
    const pars = suppliedPars || (useCurrent ? state.tournament.pars : defaultPars(holes));
    const indexes = suppliedIndexes || (useCurrent ? state.tournament.strokeIndexes : defaultStrokeIndexes(holes));
    const handicapSkinHoles = new Set(useCurrent ? state.tournament.handicapSkinHoles : []);
    const blindSkinHoles = new Set(useCurrent ? state.tournament.blindSkinHoles : []);
    $('holeSettings').innerHTML = Array.from({ length: holes }, (_, index) => `
      <div class="hole-setting">
        <strong>Hole ${index + 1}</strong>
        <label>Par
          <input class="hole-par" type="number" min="3" max="6" value="${Number(pars[index] || 4)}" inputmode="numeric" />
        </label>
        <label>Stroke index
          <input class="hole-si" type="number" min="1" max="${holes}" value="${Number(indexes[index] || index + 1)}" inputmode="numeric" />
        </label>
        <label class="skin-check"><input class="hole-handicap-skin" type="checkbox" ${handicapSkinHoles.has(index + 1) ? 'checked' : ''} /> Handicap Skin</label>
        <label class="skin-check"><input class="hole-blind-skin" type="checkbox" ${blindSkinHoles.has(index + 1) ? 'checked' : ''} /> Blind Skin</label>
      </div>`).join('');
  }

  async function saveTournamentSettings() {
    if (!isAdmin()) { toast('Administrator access required'); return; }
    const name = $('editTournamentName').value.trim();
    const course = $('editCourseName').value.trim();
    const date = $('editTournamentDate').value;
    const holes = Number($('editHoles').value) === 9 ? 9 : 18;
    const scoringMode = $('editScoringMode').value === 'net' ? 'net' : 'gross';
    const handicapAllowance = Number($('editHandicapAllowance').value || 1);
    const pars = [...document.querySelectorAll('.hole-par')].map((input) => Number(input.value));
    const strokeIndexes = [...document.querySelectorAll('.hole-si')].map((input) => Number(input.value));
    const handicapSkinHoles = [...document.querySelectorAll('.hole-handicap-skin')].map((input, index) => input.checked ? index + 1 : null).filter(Boolean);
    const blindSkinHoles = [...document.querySelectorAll('.hole-blind-skin')].map((input, index) => input.checked ? index + 1 : null).filter(Boolean);

    if (!name || !course || !date) {
      toast('Tournament name, course, and date are required');
      return;
    }
    if (pars.length !== holes || pars.some((par) => par < 3 || par > 6)) {
      toast('Each hole must have a par from 3 through 6');
      return;
    }
    const uniqueIndexes = new Set(strokeIndexes);
    if (strokeIndexes.length !== holes || uniqueIndexes.size !== holes || strokeIndexes.some((index) => index < 1 || index > holes)) {
      toast(`Stroke indexes must use each number 1 through ${holes} once`);
      return;
    }

    const button = $('saveTournamentSettings');
    button.disabled = true;
    try {
      await state.store.set(`tournaments/${state.tournamentId}`, {
        name, course, date, holes, scoringMode, handicapAllowance,
        pars, strokeIndexes, handicapSkinHoles, blindSkinHoles, createdAt: state.tournament.createdAt || Date.now(), updatedAt: Date.now()
      });

      const outOfRangeScores = state.scores.filter((score) => score.hole > holes);
      await Promise.all(outOfRangeScores.map((score) => state.store.delete(`tournaments/${state.tournamentId}/scores/${score.id}`)));
      await refreshTournamentData(true);
      toast('Tournament setup saved');
    } catch (error) {
      showFatal(error, 'The tournament setup could not be saved.');
    } finally {
      button.disabled = false;
    }
  }

  async function deleteTournament() {
    if (!isAdmin()) { toast('Administrator access required'); return; }
    if (!confirm('Delete this tournament, its players, and all scores? This cannot be undone.')) return;
    const button = $('deleteTournament');
    button.disabled = true;
    try {
      await Promise.all([
        ...state.players.map((player) => state.store.delete(`tournaments/${state.tournamentId}/players/${player.id}`)),
        ...state.scores.map((score) => state.store.delete(`tournaments/${state.tournamentId}/scores/${score.id}`))
      ]);
      await state.store.delete(`tournaments/${state.tournamentId}`);
      toast('Tournament deleted');
      await goHome();
    } catch (error) {
      showFatal(error, 'The tournament could not be deleted.');
    } finally {
      button.disabled = false;
    }
  }

  function calculateSkinContest(selectedHoles, useNet) {
    const results = [];
    const totals = new Map();
    selectedHoles.forEach((hole) => {
      const entries = state.players.map((player) => {
        const score = state.scores.find((item) => item.playerId === player.id && item.hole === hole);
        if (!score || !Number.isFinite(score.gross)) return null;
        const value = useNet ? score.gross - strokesOnHole(player, hole) : score.gross;
        return { player, value, gross: score.gross };
      }).filter(Boolean);
      if (entries.length < state.players.length) {
        results.push({ hole, status: 'waiting', missing: state.players.length - entries.length });
        return;
      }
      const low = Math.min(...entries.map((entry) => entry.value));
      const leaders = entries.filter((entry) => entry.value === low);
      if (leaders.length === 1) {
        const winner = leaders[0];
        totals.set(winner.player.id, (totals.get(winner.player.id) || 0) + 1);
        results.push({ hole, status: 'winner', winner, low });
      } else {
        results.push({ hole, status: 'tie', leaders, low });
      }
    });
    return { results, totals };
  }

  function renderSkinContest(targetId, holes, useNet) {
    const target = $(targetId);
    if (!holes.length) {
      target.innerHTML = '<div class="empty-state compact-empty">No holes selected by the administrator.</div>';
      return;
    }
    const contest = calculateSkinContest(holes, useNet);
    const totalRows = [...contest.totals.entries()].map(([playerId, count]) => ({
      player: state.players.find((item) => item.id === playerId), count
    })).filter((row) => row.player).sort((a, b) => b.count - a.count || a.player.name.localeCompare(b.player.name));
    target.innerHTML = `
      <div class="skins-total">
        <strong>Skins won</strong>
        ${totalRows.length ? totalRows.map((row) => `<span>${escapeHtml(row.player.name)} <b>${row.count}</b></span>`).join('') : '<span>No winners yet</span>'}
      </div>
      <div class="skins-hole-list">
        ${contest.results.map((result) => {
          if (result.status === 'waiting') return `<div class="skin-hole-row"><b>Hole ${result.hole}</b><span>Waiting on ${result.missing} score${result.missing === 1 ? '' : 's'}</span></div>`;
          if (result.status === 'tie') return `<div class="skin-hole-row"><b>Hole ${result.hole}</b><span>Tied at ${result.low} — no skin</span></div>`;
          return `<div class="skin-hole-row winner"><b>Hole ${result.hole}</b><span>${escapeHtml(result.winner.player.name)} — ${result.low}${useNet ? ' net' : ' gross'}</span></div>`;
        }).join('')}
      </div>`;
  }

  function renderSkins() {
    if (!state.tournament) return;
    renderSkinContest('handicapSkinsResults', state.tournament.handicapSkinHoles || [], true);
    renderSkinContest('blindSkinsResults', state.tournament.blindSkinHoles || [], false);
  }

  function switchTab(tabName, updateRoute) {
    const allowed = ['leaderboard', 'score', 'skins', 'players', 'settings'];
    let tab = allowed.includes(tabName) ? tabName : 'leaderboard';
    if (!isAdmin() && ['players','settings'].includes(tab)) tab = 'leaderboard';
    if (!(isAdmin() || isGroupScorer()) && tab === 'score') tab = 'leaderboard';
    state.activeTab = tab;
    document.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    allowed.forEach((name) => $(`${name}Tab`).classList.toggle('hidden', name !== tab));
    if (updateRoute && state.tournamentId) writeRoute(state.tournamentId, tab);
    if (tab === 'score') renderGroupScore();
    if (tab === 'skins') renderSkins();
  }

  async function refreshTournamentData(includeTournament) {
    if (!state.tournamentId || state.refreshing) return;
    state.refreshing = true;
    try {
      const requests = [
        state.store.list(`tournaments/${state.tournamentId}/players`),
        state.store.list(`tournaments/${state.tournamentId}/scores`)
      ];
      if (includeTournament) requests.unshift(state.store.get(`tournaments/${state.tournamentId}`));
      const results = await Promise.all(requests);
      let offset = 0;
      if (includeTournament) {
        if (!results[0]) throw new Error('Tournament no longer exists.');
        state.tournament = normalizeTournament({ id: state.tournamentId, ...results[0] });
        offset = 1;
      }
      state.players = results[offset].map(normalizePlayer).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      state.scores = results[offset + 1].map(normalizeScore).filter((score) => Number.isFinite(score.hole) && Number.isFinite(score.gross));
      if (includeTournament) renderTournament();
      else {
        renderPlayers();
        renderGroupOptions();
        renderLeaderboard();
        renderSkins();
      }
      setBanner('Live leaderboard connected.', 'connected');
    } catch (error) {
      console.error(error);
      setBanner(`Live refresh failed: ${error.message}`, 'error');
    } finally {
      state.refreshing = false;
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(() => {
      if (!document.hidden) refreshTournamentData(false);
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function goHome(updateRoute = true) {
    stopPolling();
    state.tournamentId = null;
    state.tournament = null;
    state.players = [];
    state.scores = [];
    if (updateRoute !== false) writeRoute(null);
    showOnly('homePanel');
    try {
      await loadHome();
      setBanner('Connected to Firebase.', 'connected');
    } catch (error) {
      showFatal(error, 'The tournament list could not be loaded.');
    }
  }

  async function shareTournament() {
    const url = `${baseUrl()}?spectator=1`;
    try {
      if (navigator.share) await navigator.share({ title: state.tournament.name, text: 'Follow the live golf leaderboard', url });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(url); toast('Permanent spectator link copied'); }
      else prompt('Copy this spectator link:', url);
    } catch (error) { if (error?.name !== 'AbortError') toast('The share link could not be opened'); }
  }

  function saveFirebaseConfig() {
    try {
      const config = JSON.parse($('firebaseConfigInput').value);
      if (!config?.projectId || !config?.apiKey) throw new Error('The projectId and apiKey are required.');
      localStorage.setItem('travelLeagueFirebaseConfig', JSON.stringify(config));
      location.href = `${location.pathname}?connected=${Date.now()}`;
    } catch (error) {
      toast(error.message || 'Configuration must be valid JSON');
    }
  }

  init().catch((error) => showFatal(error, 'Travel League Live could not start.'));
}());
