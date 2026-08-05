import { firebaseConfig as fileConfig } from './firebase-config.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore, collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const $ = id => document.getElementById(id);
const state = { db:null, tournamentId:null, tournament:null, players:[], scores:[], unsubscribe:[] };
const parPattern = [4,4,3,5,4,4,3,5,4];
const defaultPars = holes => Array.from({length:holes}, (_,i)=>parPattern[i%9]);
const defaultStrokeIndexes = holes => holes === 9 ? [1,5,7,3,9,2,8,4,6] : [1,10,17,5,13,3,15,7,11,2,12,18,6,14,4,16,8,9];

function toast(message){ $('toast').textContent=message; $('toast').classList.remove('hidden'); setTimeout(()=>$('toast').classList.add('hidden'),2400); }
function show(panel){ ['setupPanel','homePanel','tournamentPanel','errorPanel'].forEach(id=>$(id).classList.toggle('hidden',id!==panel)); }
function escapeHtml(value=''){ return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function formatDate(value){ return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : ''; }
function clearSubscriptions(){ state.unsubscribe.forEach(fn=>{ try{fn?.();}catch{} }); state.unsubscribe=[]; }
function fail(error, message='The app could not load this screen.'){
  console.error(error); $('errorMessage').textContent=`${message}${error?.message ? ` (${error.message})` : ''}`; show('errorPanel');
}
window.addEventListener('error', e=>console.error('Window error:',e.error||e.message));
window.addEventListener('unhandledrejection', e=>console.error('Unhandled promise:',e.reason));

async function connect(){
  let config=fileConfig;
  if(!config){ try{ config=JSON.parse(localStorage.getItem('travelLeagueFirebaseConfig')); }catch{ config=null; } }
  if(!config?.projectId){ show('setupPanel'); return; }
  try{
    const app=getApps().length ? getApps()[0] : initializeApp(config);
    state.db=getFirestore(app);
    show('homePanel');
    await loadTournaments();
    const match=location.hash.match(/tournament=([^&]+)/);
    if(match) await openTournament(decodeURIComponent(match[1]));
  }catch(error){ fail(error,'Firebase could not connect.'); }
}

async function loadTournaments(){
  const list=$('tournamentList'); list.innerHTML='<div class="empty">Loading tournaments…</div>';
  try{
    const snap=await getDocs(query(collection(state.db,'tournaments'),orderBy('date','desc')));
    if(snap.empty){ list.innerHTML='<div class="empty"><strong>No tournaments yet.</strong><br>Create your first tournament above.</div>'; return; }
    list.innerHTML=snap.docs.map(d=>{ const t=d.data(); const mode=(t.scoringMode||'gross')==='handicap'?'Net handicap':'Gross'; return `<button class="list-item tournament-link" data-id="${d.id}"><div><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(t.course)} • ${formatDate(t.date)} • ${t.holes||18} holes</p><span class="pill">${mode}</span></div><span class="chevron">›</span></button>`; }).join('');
    document.querySelectorAll('.tournament-link').forEach(btn=>btn.addEventListener('click',()=>openTournament(btn.dataset.id)));
  }catch(error){ fail(error,'Tournaments could not be loaded. Check Firestore permissions.'); }
}

async function createTournament(){
  const name=$('newTournamentName').value.trim(), course=$('newCourseName').value.trim(), date=$('newTournamentDate').value;
  const holes=Number($('newHoles').value), scoringMode=$('newScoringMode').value, handicapAllowance=Number($('newHandicapAllowance').value);
  if(!name||!course||!date){ toast('Complete the tournament information'); return; }
  try{
    const ref=await addDoc(collection(state.db,'tournaments'),{name,course,date,holes,scoringMode,handicapAllowance,pars:defaultPars(holes),strokeIndexes:defaultStrokeIndexes(holes),createdAt:serverTimestamp()});
    $('newTournamentDialog').close();
    await openTournament(ref.id);
  }catch(error){ fail(error,'The tournament could not be created.'); }
}

async function openTournament(id){
  try{
    clearSubscriptions(); state.tournamentId=id;
    const snap=await getDoc(doc(state.db,'tournaments',id));
    if(!snap.exists()){ toast('Tournament not found'); location.hash=''; await loadTournaments(); return; }
    state.tournament=normalizeTournament({id:snap.id,...snap.data()});
    location.hash=`tournament=${encodeURIComponent(id)}`;
    show('tournamentPanel'); switchTab('leaderboard'); renderAll(); subscribeTournament();
  }catch(error){ fail(error,'The tournament screen could not be opened.'); }
}
function normalizeTournament(t){
  const holes=Number(t.holes||18);
  return {...t,holes,scoringMode:t.scoringMode||'gross',handicapAllowance:Number(t.handicapAllowance??1),pars:Array.isArray(t.pars)&&t.pars.length===holes?t.pars:defaultPars(holes),strokeIndexes:Array.isArray(t.strokeIndexes)&&t.strokeIndexes.length===holes?t.strokeIndexes:defaultStrokeIndexes(holes)};
}
function subscribeTournament(){
  const base=doc(state.db,'tournaments',state.tournamentId);
  state.unsubscribe.push(onSnapshot(base,snap=>{ if(!snap.exists())return; state.tournament=normalizeTournament({id:snap.id,...snap.data()}); renderAll(); },error=>fail(error,'Tournament updates stopped.')));
  state.unsubscribe.push(onSnapshot(collection(base,'players'),snap=>{ state.players=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name).localeCompare(String(b.name))); renderPlayers(); renderPlayerOptions(); renderLeaderboard(); renderScoreHistory(); },error=>fail(error,'Players could not be loaded.')));
  state.unsubscribe.push(onSnapshot(collection(base,'scores'),snap=>{ state.scores=snap.docs.map(d=>({id:d.id,...d.data()})); renderLeaderboard(); renderScoreHistory(); loadCurrentScore(); },error=>fail(error,'Scores could not be loaded.')));
}
function renderAll(){ renderHeader(); renderSettings(); renderHoleOptions(); renderLeaderboard(); renderScoreHistory(); }
function renderHeader(){
  const t=state.tournament; $('tournamentName').textContent=t.name||'Tournament'; $('tournamentMeta').textContent=`${t.course||''} • ${formatDate(t.date)} • ${t.holes} holes`;
  const handicap=t.scoringMode==='handicap'; $('scoringLabel').textContent=handicap?`Net scores • ${Math.round(t.handicapAllowance*100)}% handicap allowance`:'Gross scores'; $('scoreColumnLabel').textContent=handicap?'Net':'Gross';
}
function renderPlayers(){
  const list=$('playerList');
  if(!state.players.length){ list.innerHTML='<div class="empty">No players yet. Add the golfers playing this event.</div>'; return; }
  list.innerHTML=state.players.map(p=>`<div class="list-item player-row"><div><h3>${escapeHtml(p.name)}</h3><p>Course handicap: ${Number(p.handicap||0)}</p></div><button class="icon-btn delete-player" data-id="${p.id}" aria-label="Delete player">✕</button></div>`).join('');
  document.querySelectorAll('.delete-player').forEach(btn=>btn.addEventListener('click',()=>deletePlayer(btn.dataset.id)));
}
function renderPlayerOptions(){
  const current=$('scorePlayer').value;
  $('scorePlayer').innerHTML=state.players.length ? state.players.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') : '<option value="">Add a player first</option>';
  if(state.players.some(p=>p.id===current)) $('scorePlayer').value=current;
  loadCurrentScore();
}
function renderHoleOptions(){
  const current=Math.min(Number($('scoreHole').value||1),state.tournament.holes);
  $('scoreHole').innerHTML=Array.from({length:state.tournament.holes},(_,i)=>`<option value="${i+1}">Hole ${i+1}</option>`).join(''); $('scoreHole').value=String(current); updateHoleInfo();
}
function playingHandicap(player){ return Math.round(Number(player?.handicap||0)*Number(state.tournament?.handicapAllowance??1)); }
function strokesReceivedOnHole(player,hole){
  const ph=playingHandicap(player), holes=state.tournament.holes, index=Number(state.tournament.strokeIndexes[hole-1]||hole);
  if(ph===0) return 0;
  const sign=ph<0?-1:1, abs=Math.abs(ph), full=Math.floor(abs/holes), remainder=abs%holes;
  return sign*(full+(index<=remainder?1:0));
}
function scoreStats(player){
  const ps=state.scores.filter(s=>s.playerId===player.id).sort((a,b)=>Number(a.hole)-Number(b.hole));
  let gross=0,net=0,par=0,maxHole=0;
  ps.forEach(s=>{ const hole=Number(s.hole), strokes=Number(s.strokes); gross+=strokes; net+=strokes-strokesReceivedOnHole(player,hole); par+=Number(state.tournament.pars[hole-1]||4); maxHole=Math.max(maxHole,hole); });
  const display=state.tournament.scoringMode==='handicap'?net:gross;
  return {gross,net,par,toPar:display-par,holesPlayed:ps.length,thru:maxHole,display};
}
function renderLeaderboard(){
  const board=$('leaderboard'); if(!state.players.length){ board.innerHTML='<div class="empty">Add players to begin the leaderboard.</div>'; return; }
  const rows=state.players.map(p=>({...p,...scoreStats(p)})).sort((a,b)=>{ const aUn=a.holesPlayed?0:1,bUn=b.holesPlayed?0:1; return aUn-bUn||a.toPar-b.toPar||b.thru-a.thru||a.display-b.display||String(a.name).localeCompare(String(b.name)); });
  board.innerHTML=rows.map((p,i)=>{ const score=!p.holesPlayed?'—':p.toPar===0?'E':p.toPar>0?`+${p.toPar}`:String(p.toPar); const cls=p.toPar<0?'under':p.toPar>0?'over':''; const grossNote=state.tournament.scoringMode==='handicap'&&p.holesPlayed?`Gross ${p.gross}`:`${p.display||'—'} strokes`; return `<div class="leader-row"><div class="place">${i+1}</div><div><div class="player-name">${escapeHtml(p.name)}</div><div class="player-sub">${grossNote}</div></div><div class="thru">${p.holesPlayed?p.thru:'—'}</div><div class="to-par ${cls}">${score}</div></div>`; }).join('');
}
function renderScoreHistory(){
  const playerId=$('scorePlayer').value, player=state.players.find(p=>p.id===playerId); if(!state.tournament)return;
  $('scoreHistory').innerHTML=Array.from({length:state.tournament.holes},(_,i)=>{ const hole=i+1, score=state.scores.find(s=>s.playerId===playerId&&Number(s.hole)===hole), received=player?strokesReceivedOnHole(player,hole):0, net=score?Number(score.strokes)-received:null; return `<button class="score-chip" data-hole="${hole}"><span>H${hole}</span><strong>${score?.strokes??'—'}</strong><small>${state.tournament.scoringMode==='handicap'&&score?`Net ${net}`:`Par ${state.tournament.pars[i]}`}</small></button>`; }).join('');
  document.querySelectorAll('.score-chip').forEach(btn=>btn.addEventListener('click',()=>{ $('scoreHole').value=btn.dataset.hole; loadCurrentScore(); window.scrollTo({top:0,behavior:'smooth'}); }));
}
function renderSettings(){
  const t=state.tournament; $('editTournamentName').value=t.name||''; $('editCourseName').value=t.course||''; $('editTournamentDate').value=t.date||''; $('editHoles').value=String(t.holes); $('editScoringMode').value=t.scoringMode; $('editHandicapAllowance').value=String(t.handicapAllowance);
  $('holeSettings').innerHTML=Array.from({length:t.holes},(_,i)=>`<div class="hole-setting"><strong>Hole ${i+1}</strong><label>Par<input class="par-input" type="number" min="3" max="6" value="${t.pars[i]}" /></label><label>Stroke index<input class="si-input" type="number" min="1" max="${t.holes}" value="${t.strokeIndexes[i]}" /></label></div>`).join('');
}
function updateHoleInfo(){
  const hole=Number($('scoreHole').value||1), par=state.tournament?.pars?.[hole-1]||4, si=state.tournament?.strokeIndexes?.[hole-1]||hole; $('holeInfo').textContent=`Hole ${hole} • Par ${par} • Stroke index ${si}`; updateNetPreview();
}
function updateNetPreview(){
  const player=state.players.find(p=>p.id===$('scorePlayer').value), box=$('netHolePreview');
  if(state.tournament?.scoringMode!=='handicap'||!player){ box.classList.add('hidden'); return; }
  const hole=Number($('scoreHole').value||1), gross=Number($('scoreValue').value||0), received=strokesReceivedOnHole(player,hole), net=gross-received; box.textContent=received===0?`Net score: ${net}`:`${received>0?'Receives':'Gives'} ${Math.abs(received)} stroke${Math.abs(received)===1?'':'s'} • Net score: ${net}`; box.classList.remove('hidden');
}
function loadCurrentScore(){
  if(!state.tournament)return; const playerId=$('scorePlayer').value,hole=Number($('scoreHole').value||1),existing=state.scores.find(s=>s.playerId===playerId&&Number(s.hole)===hole),value=existing?.strokes??state.tournament.pars[hole-1]??4; $('scoreValue').value=String(value); $('scoreValue').textContent=String(value); updateHoleInfo(); renderScoreHistory();
}
async function addPlayer(){
  const name=$('playerNameInput').value.trim(), handicap=Math.round(Number($('playerHandicapInput').value||0)); if(!name){toast('Enter a player name');return;}
  try{ await addDoc(collection(state.db,'tournaments',state.tournamentId,'players'),{name,handicap,createdAt:serverTimestamp()}); $('playerNameInput').value=''; $('playerHandicapInput').value='0'; toast('Player added'); }catch(error){fail(error,'The player could not be added.');}
}
async function deletePlayer(id){
  if(!confirm('Delete this player and all scores?'))return; try{ const batch=writeBatch(state.db),base=doc(state.db,'tournaments',state.tournamentId); batch.delete(doc(base,'players',id)); state.scores.filter(s=>s.playerId===id).forEach(s=>batch.delete(doc(base,'scores',s.id))); await batch.commit(); }catch(error){fail(error,'The player could not be deleted.');}
}
async function saveScore(){
  const playerId=$('scorePlayer').value,hole=Number($('scoreHole').value),strokes=Number($('scoreValue').value); if(!playerId){toast('Add or select a player');return;} if(!Number.isFinite(strokes)||strokes<1){toast('Enter a valid score');return;}
  try{ await setDoc(doc(state.db,'tournaments',state.tournamentId,'scores',`${playerId}_${hole}`),{playerId,hole,strokes,updatedAt:serverTimestamp()}); toast(`Hole ${hole} saved`); if(hole<state.tournament.holes){$('scoreHole').value=String(hole+1);loadCurrentScore();} }catch(error){fail(error,'The score could not be saved.');}
}
async function saveSettings(){
  const holes=Number($('editHoles').value), pars=[...document.querySelectorAll('.par-input')].map(i=>Number(i.value)), strokeIndexes=[...document.querySelectorAll('.si-input')].map(i=>Number(i.value));
  const validIndexes=new Set(strokeIndexes).size===holes&&strokeIndexes.every(v=>v>=1&&v<=holes); if(!validIndexes){toast(`Stroke indexes must use each number 1 through ${holes} once`);return;}
  try{ await updateDoc(doc(state.db,'tournaments',state.tournamentId),{name:$('editTournamentName').value.trim(),course:$('editCourseName').value.trim(),date:$('editTournamentDate').value,holes,scoringMode:$('editScoringMode').value,handicapAllowance:Number($('editHandicapAllowance').value),pars,strokeIndexes}); toast('Settings saved'); }catch(error){fail(error,'Settings could not be saved.');}
}
async function deleteTournament(){
  if(!confirm('Delete this entire tournament? This cannot be undone.'))return; try{ const base=doc(state.db,'tournaments',state.tournamentId),batch=writeBatch(state.db); state.players.forEach(p=>batch.delete(doc(base,'players',p.id))); state.scores.forEach(s=>batch.delete(doc(base,'scores',s.id))); batch.delete(base); await batch.commit(); clearSubscriptions(); state.tournamentId=null; location.hash=''; show('homePanel'); await loadTournaments(); }catch(error){fail(error,'The tournament could not be deleted.');}
}
function switchTab(name){ document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name)); ['leaderboard','score','players','settings'].forEach(tab=>$(`${tab}Tab`).classList.toggle('hidden',tab!==name)); }
async function shareTournament(){ const url=`${location.origin}${location.pathname}#tournament=${encodeURIComponent(state.tournamentId)}`; try{ if(navigator.share)await navigator.share({title:state.tournament.name,text:'Follow the live golf leaderboard',url}); else{await navigator.clipboard.writeText(url);toast('Leaderboard link copied');} }catch(error){ if(error?.name!=='AbortError')toast('Could not share link'); } }
function goHome(){ clearSubscriptions(); state.tournamentId=null; location.hash=''; show('homePanel'); loadTournaments(); }

$('saveConfigBtn').addEventListener('click',()=>{ try{const config=JSON.parse($('firebaseConfigInput').value);localStorage.setItem('travelLeagueFirebaseConfig',JSON.stringify(config));location.reload();}catch{toast('Configuration must be valid JSON');} });
$('clearConfigBtn').addEventListener('click',()=>{localStorage.removeItem('travelLeagueFirebaseConfig');$('firebaseConfigInput').value='';});
$('newTournamentBtn').addEventListener('click',()=>{$('newTournamentDate').value=new Date().toISOString().slice(0,10);$('newTournamentDialog').showModal();});
$('createTournamentBtn').addEventListener('click',e=>{e.preventDefault();createTournament();});
$('refreshBtn').addEventListener('click',loadTournaments); $('backBtn').addEventListener('click',goHome); $('homeLogo').addEventListener('click',goHome); $('recoverBtn').addEventListener('click',goHome); $('shareBtn').addEventListener('click',shareTournament);
$('addPlayerBtn').addEventListener('click',addPlayer); $('saveScoreBtn').addEventListener('click',saveScore); $('scorePlayer').addEventListener('change',loadCurrentScore); $('scoreHole').addEventListener('change',loadCurrentScore);
$('scoreMinus').addEventListener('click',()=>{const v=Math.max(1,Number($('scoreValue').value)-1);$('scoreValue').value=String(v);$('scoreValue').textContent=String(v);updateNetPreview();});
$('scorePlus').addEventListener('click',()=>{const v=Math.min(20,Number($('scoreValue').value)+1);$('scoreValue').value=String(v);$('scoreValue').textContent=String(v);updateNetPreview();});
$('saveSettingsBtn').addEventListener('click',saveSettings); $('deleteTournamentBtn').addEventListener('click',deleteTournament);
$('editHoles').addEventListener('change',()=>{ const holes=Number($('editHoles').value); state.tournament={...state.tournament,holes,pars:defaultPars(holes),strokeIndexes:defaultStrokeIndexes(holes)}; renderSettings(); });
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
let deferredPrompt; window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').classList.remove('hidden');}); $('installBtn').addEventListener('click',async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').classList.add('hidden');}});
if('serviceWorker' in navigator){ navigator.serviceWorker.register('./service-worker.js?v=2.1').catch(console.error); }
await connect();
