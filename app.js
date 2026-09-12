const SUPABASE_URL = 'https://khchcksxxkquzxoglbww.supabase.co';
const SUPABASE_KEY = 'sb_publishable_X3VrmhaoZ948g13Rl7_Amg_n-71c2Fb';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const DEFAULT_PENDING = ['Admissão', 'Prescrever', 'Laboratoriais', 'Checar exames', 'Reavaliar'];
const PRIORITIES = [{ id: 'red', label: 'Críticos' }, { id: 'yellow', label: 'Urgentes' }, { id: 'green', label: 'Estáveis' }];
const OUTCOMES = { discharge:'Alta', admission:'Internação', internal_transfer:'Transferência de setor', external_transfer:'Transferência externa', death:'Óbito' };

let session = null, rooms = [], room = null, patients = [], roomMembers = [], currentPatientId = null;
let patientMode = 'edit', draftPending = [], realtimeChannel = null, saveTimer = null, toastTimer = null;
let loadingCount = 0, activeFilter = 'all', deferredPrompt = null, presenceKey = null, inactivityTimer = null;
let deleteTimer = null, lastSyncAt = null, auditRows = [], editingMap = {};
let flushing = null, patientDirty = false, patientSaving = null, outcomeTargetId = null;

function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]); }
function uuid() { return crypto.randomUUID(); }
function isoLocal(value = new Date()) { const d = new Date(value); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function isOverdue(item) { return !item.done && item.due_at && new Date(item.due_at) < new Date(); }
function roomCacheKey() { return `erhub_snapshot_${session?.user?.id || 'none'}_${room?.id || 'none'}`; }
function setLoading(active) { loadingCount = Math.max(0, loadingCount + (active ? 1 : -1)); $('loading').classList.toggle('hidden', loadingCount === 0); }
function setSync(text,saving=false){if(text==='Tudo salvo'&&(getQueue().length||patientDirty))text=patientDirty?'Salvando…':'Aguardando sincronização';$('syncStatus').textContent=text;$('syncStatus').classList.toggle('saving',saving||getQueue().length>0);$('modalSaveStatus').textContent=text;}
function friendlyError(error) { const message = error?.message || String(error || 'Erro inesperado'); return ({'Invalid login credentials':'E-mail ou senha incorretos.','Email not confirmed':'Confirme seu e-mail antes de entrar.','User already registered':'Este e-mail já possui uma conta.','Invalid invite code':'Código de convite inválido.','Failed to fetch':'Sem conexão. A alteração será sincronizada depois.'})[message] || message; }
function toast(message, isError = false, action = null) {
  clearTimeout(toastTimer); $('toastText').textContent = message; $('toast').className = `toast${isError ? ' error' : ''}`;
  const button = $('toastAction'); button.classList.toggle('hidden', !action); button.textContent = action?.label || ''; button.onclick = action?.run || null;
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), action ? 6500 : 4200);
}
function showOnly(viewId) { ['authView','workspaceView','appView'].forEach(id => $(id).classList.toggle('hidden', id !== viewId)); }
function openModal(id) { $(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { if(id==='patientModal')return closePatient(); $(id).classList.remove('open'); if (!document.querySelector('.modal.open')) document.body.style.overflow = ''; }
function showAuthForm(name) { const forms={login:'loginForm',signup:'signupForm',recovery:'recoveryForm',password:'newPasswordForm'}; Object.values(forms).forEach(id=>$(id).classList.add('hidden')); $(forms[name]).classList.remove('hidden'); $('showLogin').classList.toggle('hidden',name==='login'); $('showSignup').classList.toggle('hidden',name==='signup'||name==='password'); $('showRecovery').classList.toggle('hidden',name==='recovery'||name==='password'); }

async function init() {
  bindEvents(); updateNetworkState(); registerPwa();
  setInterval(()=>{if(room&&!document.hidden){renderKpis();renderBoard();if($('passagem').classList.contains('active'))renderHandoff();}},60000);
  const { data } = await db.auth.getSession(); await handleSession(data.session);
  db.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'PASSWORD_RECOVERY') { session=nextSession; showOnly('authView'); showAuthForm('password'); }
    else if (event === 'SIGNED_OUT') handleSession(null);
    else if (event === 'SIGNED_IN' && nextSession?.user?.id !== session?.user?.id) handleSession(nextSession);
  });
}

function bindEvents() {
  $('showLogin').onclick=()=>showAuthForm('login'); $('showSignup').onclick=()=>showAuthForm('signup'); $('showRecovery').onclick=()=>showAuthForm('recovery');
  $('loginForm').onsubmit=login; $('signupForm').onsubmit=signup; $('recoveryForm').onsubmit=recoverPassword; $('newPasswordForm').onsubmit=updatePassword;
  $('createRoomForm').onsubmit=createRoom; $('joinRoomForm').onsubmit=joinRoom; $('roomSelect').onchange=()=>selectRoom($('roomSelect').value);
  $('searchInput').oninput=renderBoard; $('historySearch').oninput=renderHistory; $('historyFilter').onchange=renderHistory;
  $('priorityFilters').onclick=e=>{ const b=e.target.closest('[data-filter]'); if(!b)return; activeFilter=b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b)); renderBoard(); };
  $('patientForm').onsubmit=savePatientForm; $('novaPend').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addPending();}};
  $('deletePatientButton').onclick=()=>deletePatient(currentPatientId); $('outcomeButton').onclick=()=>showOutcome(currentPatientId);
  $('addTemplateButton').onclick=addDefaultPending; $('shareButton').onclick=showShare; $('copyCodeButton').onclick=()=>copyText(room.invite_code,'Código copiado.'); $('copyLinkButton').onclick=()=>copyText($('shareLink').value,'Link copiado.'); $('nativeShareButton').onclick=nativeShare;
  $('refreshAudit').onclick=loadAudit; $('unlockForm').onsubmit=unlock;
  document.addEventListener('click', handleActionClick);
  document.addEventListener('input', e=>{ if(['nome','leito','idade','dx','responsavel','handoffNotes'].includes(e.target.id)) scheduleSave(); resetInactivity(); });
  document.addEventListener('change', e=>{ if(['prio','entrada'].includes(e.target.id)) scheduleSave(); resetInactivity(); });
  document.addEventListener('keydown', e=>{ resetInactivity(); if(e.key==='Escape'){document.querySelectorAll('.modal.open').forEach(m=>closeModal(m.id));} });
  window.addEventListener('online', async()=>{updateNetworkState();await flushQueue();if(room)await loadPatients();}); window.addEventListener('offline',updateNetworkState);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&room)loadPatients();});
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installAuth').classList.remove('hidden');});
}

function handleActionClick(event) {
  resetInactivity();
  const close=event.target.closest('[data-close]'); if(close)return closeModal(close.dataset.close);
  const view=event.target.closest('[data-view]'); if(view){showView(view.dataset.view);closeModal('mobileMenu');return;}
  const outcome=event.target.closest('[data-outcome]')?.dataset.outcome; if(outcome){applyOutcome(outcome);return;}
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='room-members')showRoomMembers(); if(action==='leave-room')leaveRoom(); if(action==='logout')logout(); if(action==='switch-room'){closeModal('mobileMenu');showOnly('workspaceView');} if(action==='new-patient')newPatient();
  if(action==='print')window.print(); if(action==='mobile-menu')openModal('mobileMenu'); if(action==='share'){closeModal('mobileMenu');showShare();}
  if(action==='install')installPwa(); if(action==='lock'){closeModal('mobileMenu');lock();} if(action==='delete-room')deleteRoom(); if(action==='add-pending')addPending();
  const peek=event.target.closest('.peek'); if(peek){const input=$(peek.dataset.target);input.type=input.type==='password'?'text':'password';}
}

async function handleSession(nextSession) {
  session=nextSession;
  if(!session){unsubscribeRealtime();rooms=[];room=null;patients=[];showOnly('authView');showAuthForm('login');return;}
  presenceKey=`${session.user.id}-${Math.random().toString(36).slice(2,7)}`; await loadRooms(); resetInactivity();
}
async function login(e){e.preventDefault();setLoading(true);const {error}=await db.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});setLoading(false);if(error)toast(friendlyError(error),true);}
async function signup(e){e.preventDefault();setLoading(true);const {data,error}=await db.auth.signUp({email:$('signupEmail').value.trim(),password:$('signupPassword').value,options:{data:{display_name:$('signupName').value.trim()},emailRedirectTo:location.origin}});setLoading(false);if(error)return toast(friendlyError(error),true);if(data.session)await handleSession(data.session);else toast('Conta criada. O Supabase ainda exige confirmação: confira seu e-mail para entrar.');}
async function recoverPassword(e){e.preventDefault();setLoading(true);const {error}=await db.auth.resetPasswordForEmail($('recoveryEmail').value.trim(),{redirectTo:location.origin});setLoading(false);if(error)return toast(friendlyError(error),true);toast('Enviamos o link de recuperação.');showAuthForm('login');}
async function updatePassword(e){e.preventDefault();setLoading(true);const {error}=await db.auth.updateUser({password:$('newPassword').value});setLoading(false);if(error)return toast(friendlyError(error),true);toast('Senha atualizada.');await handleSession((await db.auth.getSession()).data.session);}
async function logout(){if(currentPatientId){await closePatient();if(patientDirty)return;}if(navigator.onLine)await flushQueue();if(getQueue().length){toast('Há alterações sem sincronizar. Conecte-se antes de sair para preservá-las.',true);return;}clearTimeout(inactivityTimer);for(const key of Object.keys(localStorage))if(key.startsWith('erhub_snapshot_'))localStorage.removeItem(key);await db.auth.signOut();$('lockScreen').classList.add('hidden');document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open'));document.body.style.overflow='';}

async function loadRooms(preferredId) {
  setLoading(true); const {data,error}=await db.from('room_members').select('room_id,role,rooms(id,name,invite_code)').eq('user_id',session.user.id); setLoading(false);
  if(error)return toast(friendlyError(error),true); rooms=(data||[]).map(x=>({...([].concat(x.rooms||[])[0]),role:x.role})).filter(x=>x.id);
  const invite=new URLSearchParams(location.search).get('room');
  if(invite&&!rooms.some(r=>r.invite_code===invite.toUpperCase())){const joined=await db.rpc('join_room',{invite_code_input:invite.toUpperCase()});if(!joined.error){history.replaceState({},'',location.pathname);return loadRooms(joined.data);}}
  if(!rooms.length){unsubscribeRealtime();room=null;patients=[];showOnly('workspaceView');return;} const saved=preferredId||localStorage.getItem('erhub_room');await selectRoom(rooms.some(x=>x.id===saved)?saved:rooms[0].id);
}
async function createRoom(e){e.preventDefault();setLoading(true);const {data,error}=await db.rpc('create_room',{room_name:$('roomName').value.trim()});setLoading(false);if(error)return toast(friendlyError(error),true);$('roomName').value='';await loadRooms(data?.[0]?.created_room_id);toast('Sala criada.');}
async function joinRoom(e){e.preventDefault();setLoading(true);const {data,error}=await db.rpc('join_room',{invite_code_input:$('inviteCode').value.trim().toUpperCase()});setLoading(false);if(error)return toast(friendlyError(error),true);$('inviteCode').value='';await loadRooms(data);toast('Você entrou na sala.');}
async function deleteRoom(){if(!room||room.role!=='owner')return toast('Somente o proprietário pode excluir a sala.',true);const name=room.name;if(!confirm(`Excluir definitivamente a sala “${name}” e todos os pacientes e pendências? Esta ação não pode ser desfeita.`))return;setLoading(true);const {error}=await db.rpc('delete_room',{target_room_id:room.id});setLoading(false);if(error)return toast(friendlyError(error),true);unsubscribeRealtime();localStorage.removeItem(roomCacheKey());localStorage.removeItem('erhub_room');closeModal('mobileMenu');room=null;patients=[];await loadRooms();toast('Sala excluída.');}
async function selectRoom(id){const selected=rooms.find(x=>x.id===id);if(!selected)return;room=selected;localStorage.setItem('erhub_room',room.id);$('roomSelect').innerHTML=rooms.map(x=>`<option value="${x.id}"${x.id===room.id?' selected':''}>${escapeHtml(x.name)}</option>`).join('');showOnly('appView');const canDelete=room.role==='owner'; document.querySelectorAll('[data-action="leave-room"]').forEach(b=>b.classList.toggle('hidden',canDelete));$('deleteRoomDesktop').classList.toggle('hidden',!canDelete);$('deleteRoomMobile').classList.toggle('hidden',!canDelete);await loadRoomMembers();await flushQueue();await loadPatients();subscribeRealtime();}

async function loadRoomMembers(){const members=await db.from('room_members').select('user_id,role').eq('room_id',room.id);if(members.error)return;const ids=(members.data||[]).map(x=>x.user_id);const profiles=ids.length?await db.from('profiles').select('id,display_name').in('id',ids):{data:[]};const names={};(profiles.data||[]).forEach(x=>names[x.id]=x.display_name);roomMembers=(members.data||[]).map(x=>({...x,name:names[x.user_id]||'Profissional'}));$('novaPendAssignee').innerHTML='<option value="">Sem responsável</option>'+roomMembers.map(x=>`<option value="${x.user_id}">${escapeHtml(x.name)}</option>`).join('');}

async function loadPatients() {
  if(!room||patientDirty||patientSaving||getQueue().length)return; const requestedRoom=room.id; setLoading(true); const {data,error}=await db.from('patients').select('*,pending_items(*)').eq('room_id',room.id).order('sort_order').order('created_at'); setLoading(false);
  if(room?.id!==requestedRoom||patientDirty||patientSaving||getQueue().length)return;
  if(error){const cached=localStorage.getItem(roomCacheKey());if(cached){patients=JSON.parse(cached);renderAll();toast('Exibindo a última versão salva neste aparelho.');}else toast(friendlyError(error),true);return;}
  const names=Object.fromEntries(roomMembers.map(x=>[x.user_id,x.name]));patients=(data||[]).map(p=>({...p,updated_by_name:names[p.updated_by]||'Profissional',pending_items:(p.pending_items||[]).sort((a,b)=>a.position-b.position).map(x=>({...x,assignee_name:names[x.assigned_to]||''}))}));localStorage.setItem(roomCacheKey(),JSON.stringify(patients));lastSyncAt=new Date();setSync('Tudo salvo');renderAll();
  if(currentPatientId&&$('patientModal').classList.contains('open'))renderPending();
}
function renderAll(){renderKpis();renderBoard();renderHistory();renderHandoff();$('lastSync').textContent=lastSyncAt?'Atualizado agora':'Versão salva no aparelho';}
function activePatients(){return patients.filter(p=>p.status==='active');}
function elapsed(value){const m=Math.floor((Date.now()-new Date(value).getTime())/60000);if(!Number.isFinite(m)||m<0)return'—';const h=Math.floor(m/60);return h>=24?`${Math.floor(h/24)}d ${h%24}h`:h?`${h}h ${m%60}min`:`${m}min`;}
function formatDate(value){return value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';}
function patientMatches(p,query){return [p.name,p.bed,p.diagnosis,p.responsible].join(' ').toLowerCase().includes(query.toLowerCase());}

function renderKpis(){const list=activePatients(),critical=list.filter(p=>p.priority==='red').length,late=list.flatMap(p=>p.pending_items||[]).filter(isOverdue).length,longest=list.sort((a,b)=>new Date(a.entered_at)-new Date(b.entered_at))[0];$('kpis').innerHTML=`<article class="kpi"><span class="kpi-label">Pacientes ativos</span><strong>${list.length}</strong><small>na sala agora</small></article><article class="kpi alert"><span class="kpi-label">Críticos</span><strong>${critical}</strong><small>prioridade máxima</small></article><article class="kpi warn"><span class="kpi-label">Pendências vencidas</span><strong>${late}</strong><small>precisam de atenção</small></article><article class="kpi"><span class="kpi-label">Maior permanência</span><strong>${longest?elapsed(longest.entered_at):'—'}</strong><small>${longest?escapeHtml(longest.name):'sala vazia'}</small></article>`;}
function renderBoard(){const query=$('searchInput').value.trim();let list=activePatients().filter(p=>patientMatches(p,query));if(activeFilter==='overdue')list=list.filter(p=>(p.pending_items||[]).some(isOverdue));else if(activeFilter!=='all')list=list.filter(p=>p.priority===activeFilter);$('board').innerHTML=PRIORITIES.map(pr=>{const lane=list.filter(p=>p.priority===pr.id);return `<section class="lane" data-priority="${pr.id}"><div class="lane-head"><div class="lane-title"><i></i>${pr.label}</div><span class="lane-count">${lane.length}</span></div><div class="lane-body" data-priority="${pr.id}">${lane.length?lane.map(patientCard).join(''):'<div class="empty-lane">Nenhum paciente nesta prioridade</div>'}</div></section>`}).join('');bindCards();initSortables();}
function patientCard(p){
  const items=p.pending_items||[];
  const done=items.filter(x=>x.done).length;
  const open=items.filter(x=>!x.done).sort((a,b)=>
    Number(isOverdue(b))-Number(isOverdue(a))||
    Number(b.priority==='high')-Number(a.priority==='high')||
    a.position-b.position
  );
  const late=open.filter(isOverdue).length;
  const progress=items.length?Math.round(done/items.length*100):null;
  const editing=editingMap[p.id];
  const pendingHtml=open.length
    ?open.map(x=>`<button type="button" class="card-pending-row${isOverdue(x)?' late':''}" data-card-pending="${x.id}" aria-label="Concluir ${escapeHtml(x.title)}"><span class="card-pending-check"></span><span class="card-pending-title">${escapeHtml(x.title)}</span>${x.due_at?`<small>${isOverdue(x)?'Atrasada':'Até '+formatDate(x.due_at)}</small>`:''}</button>`).join('')
    :`<div class="card-all-done">✓ ${items.length?'Todas concluídas':'Sem pendências cadastradas'}</div>`;
  const progressHtml=items.length
    ?`<div class="pending-summary"><div class="progress-line"><i style="width:${progress}%"></i></div><div class="pending-summary-row"><span>${done}/${items.length} concluídas</span><span>${progress}%</span></div></div>`
    :'';
  return `<article class="patient-card priority-${p.priority}${late?' overdue':''}" data-id="${p.id}"><div class="card-top"><div class="bed-badge">${escapeHtml(p.bed||'—')}</div><div class="card-title"><strong>${escapeHtml(p.name||'Sem nome')}</strong><small>${p.age??'—'} anos${p.responsible?` · ${escapeHtml(p.responsible)}`:''}</small></div><button class="drag-handle" type="button" aria-label="Mover">⠿</button></div><div class="card-diagnosis">${escapeHtml(p.diagnosis||'Sem diagnóstico informado')}</div><div class="card-meta"><span class="meta-pill">⏱ ${elapsed(p.entered_at)}</span>${late?`<span class="meta-pill alert-meta">⚠ ${late} em atraso</span>`:''}${editing?`<span class="meta-pill editing-meta">${escapeHtml(editing)} editando</span>`:`<span class="meta-pill">por ${escapeHtml(p.updated_by_name||'Profissional')}</span>`}</div><div class="card-pending-list">${pendingHtml}</div>${progressHtml}<div class="quick-actions"><button data-quick="pending">＋ Pendência</button><button data-quick="outcome">Registrar desfecho</button></div></article>`;
}
function bindCards(){document.querySelectorAll('.patient-card').forEach(card=>{card.onclick=()=>openPatient(card.dataset.id);card.querySelectorAll('[data-card-pending]').forEach(btn=>btn.onclick=e=>{e.stopPropagation();togglePendingFromBoard(card.dataset.id,btn.dataset.cardPending);});card.querySelectorAll('[data-quick]').forEach(btn=>btn.onclick=e=>{e.stopPropagation();if(btn.dataset.quick==='pending'){openPatient(card.dataset.id);setTimeout(()=>$('novaPend').focus(),80);}else showOutcome(card.dataset.id);});});}
function initSortables(){if(!window.Sortable)return;document.querySelectorAll('.lane-body').forEach(lane=>new Sortable(lane,{group:'patients',handle:'.drag-handle',animation:160,onEnd:async e=>{const id=e.item.dataset.id,priority=e.to.dataset.priority;const ids=[...e.to.querySelectorAll('.patient-card')].map(x=>x.dataset.id);const p=patients.find(x=>x.id===id);if(p)p.priority=priority;renderKpis();await Promise.all(ids.map((patientId,i)=>saveMutation('patients','update',{priority,sort_order:i,updated_by:session.user.id},{id:patientId,room_id:room.id})));}}));}

function renderHistory(){const query=$('historySearch').value.trim(),filter=$('historyFilter').value;const list=patients.filter(p=>p.status!=='active'&&(filter==='all'||outcomeType(p)===filter)&&patientMatches(p,query)).sort((a,b)=>new Date(b.outcome_at)-new Date(a.outcome_at));$('history').innerHTML=list.length?list.map(p=>`<article class="history-item"><div class="history-main"><h3>${escapeHtml(p.name||'Sem nome')} <span class="muted">· ${escapeHtml(p.bed||'sem leito')}</span></h3><div class="history-meta">${escapeHtml(p.diagnosis||'Sem diagnóstico')} · Entrada ${formatDate(p.entered_at)} · Desfecho ${formatDate(p.outcome_at)}</div></div><div><span class="status-badge ${p.status}">${outcomeLabel(p)}</span><button class="restore-button" data-restore="${p.id}">Restaurar</button></div></article>`).join(''):'<div class="empty-lane">Nenhum paciente encontrado no histórico.</div>';document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>restorePatient(b.dataset.restore));}
function renderHandoff(){const list=activePatients().sort((a,b)=>PRIORITIES.findIndex(x=>x.id===a.priority)-PRIORITIES.findIndex(x=>x.id===b.priority));$('handoff').innerHTML=list.length?list.map(p=>{const open=(p.pending_items||[]).filter(x=>!x.done);return `<article class="handoff-card ${p.priority}"><div class="handoff-head"><div><h3>${escapeHtml(p.bed||'Sem leito')} · ${escapeHtml(p.name||'Sem nome')}</h3><small>${p.age??'—'} anos · ${escapeHtml(p.responsible||'Sem responsável')} · ${elapsed(p.entered_at)} na sala</small></div><span class="status-badge ${p.priority==='red'?'transferred':'discharged'}">${PRIORITIES.find(x=>x.id===p.priority).label}</span></div><p>${escapeHtml(p.diagnosis||'Sem diagnóstico informado')}</p>${p.handoff_notes?`<div class="handoff-notes"><strong>Para o próximo plantão</strong><br>${escapeHtml(p.handoff_notes)}</div>`:''}<strong>${open.length} pendência(s) aberta(s)</strong><ul class="handoff-pending">${open.map(x=>`<li>${escapeHtml(x.title)}${x.due_at?` — ${formatDate(x.due_at)}`:''}</li>`).join('')}</ul></article>`}).join(''):'<div class="empty-lane">Nenhum paciente ativo para a passagem.</div>';}

function newPatient(){patientMode='create';currentPatientId=null;draftPending=DEFAULT_PENDING.map((title,i)=>({id:uuid(),title,done:false,position:i,priority:'normal',due_at:null}));$('patientModalTitle').textContent='Novo paciente';$('patientModalEyebrow').textContent='Admissão segura';['nome','leito','idade','dx','responsavel','handoffNotes'].forEach(id=>$(id).value='');$('prio').value='yellow';$('entrada').value=isoLocal();$('deletePatientButton').classList.add('hidden');$('outcomeButton').classList.add('hidden');$('savePatientButton').classList.remove('hidden');$('savePatientButton').textContent='Criar paciente';$('modalSaveStatus').textContent='Nada será gravado antes de criar';renderPending();openModal('patientModal');setTimeout(()=>$('nome').focus(),80);}
function openPatient(id){const p=patients.find(x=>x.id===id);if(!p)return;patientMode='edit';currentPatientId=id;$('patientModalTitle').textContent=p.name||'Paciente';$('patientModalEyebrow').textContent=`${p.bed||'Sem leito'} · ${PRIORITIES.find(x=>x.id===p.priority)?.label||''}`;$('nome').value=p.name;$('leito').value=p.bed;$('idade').value=p.age??'';$('dx').value=p.diagnosis;$('responsavel').value=p.responsible;$('prio').value=p.priority;$('entrada').value=isoLocal(p.entered_at);$('handoffNotes').value=p.handoff_notes||'';$('deletePatientButton').classList.remove('hidden');$('outcomeButton').classList.remove('hidden');$('savePatientButton').classList.remove('hidden');$('savePatientButton').textContent='Salvar alterações';setSync('Tudo salvo');renderPending();openModal('patientModal');trackEditing(id);}
function renderPending(){const items=patientMode==='create'?draftPending:(patients.find(p=>p.id===currentPatientId)?.pending_items||[]);const done=items.filter(x=>x.done).length;$('pendingProgress').textContent=`${done} de ${items.length} concluídas`;$('pendencias').innerHTML=items.length?items.map(x=>`<div class="pending-item ${x.done?'done':''}" data-pending="${x.id}"><button class="pending-check" type="button" aria-label="Concluir"></button><div><div class="pending-name">${escapeHtml(x.title)}</div><div class="pending-detail ${isOverdue(x)?'late':''}">${x.due_at?(isOverdue(x)?'Vencida · ':'Prazo · ')+formatDate(x.due_at):'Sem prazo'}${x.assignee_name?` · ${escapeHtml(x.assignee_name)}`:''}</div></div>${x.priority==='high'?'<span class="priority-flag">ALTA</span>':'<span></span>'}<button class="trash" type="button" aria-label="Excluir">×</button></div>`).join(''):'<div class="empty-lane">Nenhuma pendência.</div>';document.querySelectorAll('[data-pending]').forEach(row=>{row.querySelector('.pending-check').onclick=()=>togglePending(row.dataset.pending);row.querySelector('.trash').onclick=()=>deletePending(row.dataset.pending);});}
function formPayload(){return{name:$('nome').value.trim(),bed:$('leito').value.trim(),age:$('idade').value?Number($('idade').value):null,diagnosis:$('dx').value.trim(),responsible:$('responsavel').value.trim(),priority:$('prio').value,entered_at:new Date($('entrada').value||new Date()).toISOString(),handoff_notes:$('handoffNotes').value.trim(),updated_by:session.user.id};}
async function savePatientForm(e){e.preventDefault();if(patientMode==='edit'){const result=await saveCurrentPatient();if(result?.error)return;toast('Alterações salvas.');return closePatient();}const payload=formPayload();if(!payload.name)return toast('Informe o nome do paciente.',true);const id=uuid();const patient={id,room_id:room.id,...payload,status:'active',outcome_at:null,sort_order:activePatients().length,created_by:session.user.id,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),pending_items:draftPending.map(x=>({...x,patient_id:id,room_id:room.id,created_by:session.user.id,updated_by:session.user.id}))};patients.push(patient);renderAll();closePatient();setSync('Salvando…',true);const pResult=await saveMutation('patients','insert',{...patient,pending_items:undefined});if((!pResult.error||!navigator.onLine)&&patient.pending_items.length){const cleanItems=patient.pending_items.map(x=>{const item={...x};delete item.assignee_name;return item;});await saveMutation('pending_items','insert',cleanItems);}setSync(pResult.error?'Na fila para sincronizar':'Tudo salvo');toast('Paciente adicionado.');}
async function closePatient(){clearTimeout(saveTimer);if(patientMode==='edit'&&patientDirty){const result=await saveCurrentPatient();if(result?.error)return;}if(patientSaving)await patientSaving;$('patientModal').classList.remove('open');document.body.style.overflow='';currentPatientId=null;patientMode='edit';patientDirty=false;if(realtimeChannel&&session)trackEditing(null);}
function scheduleSave(){if(patientMode!=='edit'||!currentPatientId)return;patientDirty=true;clearTimeout(saveTimer);setSync('Salvando…',true);saveTimer=setTimeout(()=>saveCurrentPatient(),650);}
async function saveCurrentPatient(){if(patientSaving)await patientSaving;const p=patients.find(x=>x.id===currentPatientId);if(!p||!patientDirty)return {error:null};if(!$('patientForm').reportValidity()||!$('nome').value.trim()||!$('entrada').value){setSync('Revise os dados antes de salvar');return {error:new Error('Dados inválidos')};}const payload=formPayload();patientDirty=false;Object.assign(p,payload);patientSaving=saveMutation('patients','update',payload,{id:p.id,room_id:p.room_id});const result=await patientSaving;patientSaving=null;if(result.error){patientDirty=true;setSync('Falha ao salvar — tente novamente');}else {setSync(getQueue().length?'Aguardando sincronização':'Tudo salvo');renderAll();}return result;}
function addDefaultPending(){const current=patientMode==='create'?draftPending:(patients.find(p=>p.id===currentPatientId)?.pending_items||[]);const existing=new Set(current.map(x=>x.title));DEFAULT_PENDING.filter(x=>!existing.has(x)).forEach((title,i)=>addPendingItemObject(title,'normal',null,current.length+i));renderPending();}
function addPending(){const title=$('novaPend').value.trim();if(!title)return;addPendingItemObject(title,$('novaPendPriority').value,$('novaPendDue').value||null,null,$('novaPendAssignee').value||null);$('novaPend').value='';$('novaPendDue').value='';$('novaPendAssignee').value='';renderPending();}
async function addPendingItemObject(title,priority='normal',due=null,position=null,assignedTo=null){const member=roomMembers.find(x=>x.user_id===assignedTo);const item={id:uuid(),title,priority,due_at:due?new Date(due).toISOString():null,assigned_to:assignedTo,assignee_name:member?.name||'',done:false,position:position??0};if(patientMode==='create'){item.position=position??draftPending.length;draftPending.push(item);return;}const p=patients.find(x=>x.id===currentPatientId);if(!p)return;Object.assign(item,{patient_id:p.id,room_id:room.id,position:position??p.pending_items.length,created_by:session.user.id,updated_by:session.user.id});p.pending_items.push(item);renderAll();const payload={...item};delete payload.assignee_name;await saveMutation('pending_items','insert',payload);}
async function togglePending(id){const list=patientMode==='create'?draftPending:(patients.find(p=>p.id===currentPatientId)?.pending_items||[]),item=list.find(x=>x.id===id);if(!item)return;item.done=!item.done;renderPending();renderAll();if(patientMode==='edit')await saveMutation('pending_items','update',{done:item.done,updated_by:session.user.id},{id,room_id:room.id});}
async function togglePendingFromBoard(patientId,id){const p=patients.find(x=>x.id===patientId),item=p?.pending_items?.find(x=>x.id===id);if(!item)return;item.done=true;renderAll();await saveMutation('pending_items','update',{done:true,updated_by:session.user.id},{id,room_id:p.room_id});}
async function deletePending(id){const creating=patientMode==='create',patientId=currentPatientId,roomId=room?.id;const list=creating?draftPending:(patients.find(p=>p.id===patientId)?.pending_items||[]),index=list.findIndex(x=>x.id===id);if(index<0)return;const [removed]=list.splice(index,1);renderPending();renderAll();if(!creating)await saveMutation('pending_items','delete',null,{id,room_id:roomId});toast('Pendência removida.',false,{label:'Desfazer',run:async()=>{const target=creating?draftPending:patients.find(p=>p.id===patientId)?.pending_items;if(!target)return;target.splice(index,0,removed);renderAll();if(currentPatientId===patientId)renderPending();if(!creating)await saveMutation('pending_items','insert',removed);}});}

function outcomeType(p){return p.outcome_type||(p.status==='discharged'?'discharge':'internal_transfer');}
function outcomeLabel(p){return OUTCOMES[outcomeType(p)]||'Transferência';}
async function showOutcome(id=currentPatientId){const target=id;if(!target)return;if(currentPatientId===target&&$('patientModal').classList.contains('open')){await closePatient();if(currentPatientId===target)return;}const p=patients.find(x=>x.id===target);if(!p)return;outcomeTargetId=target;$('outcomePatientName').textContent=p.name||'este paciente';openModal('outcomeModal');}
async function applyOutcome(type){const id=outcomeTargetId,p=patients.find(x=>x.id===id);if(!p||!OUTCOMES[type])return;closeModal('outcomeModal');outcomeTargetId=null;const status=type==='discharge'?'discharged':'transferred',before={status:p.status,outcome_type:p.outcome_type||null,outcome_at:p.outcome_at},roomId=p.room_id;p.status=status;p.outcome_type=type;p.outcome_at=new Date().toISOString();renderAll();await saveMutation('patients','update',{status,outcome_type:type,outcome_at:p.outcome_at,updated_by:session.user.id},{id:p.id,room_id:roomId});toast(`${OUTCOMES[type]} registrado.`,false,{label:'Desfazer',run:async()=>{Object.assign(p,before);renderAll();await saveMutation('patients','update',{...before,updated_by:session.user.id},{id:p.id,room_id:roomId});}});}
async function restorePatient(id){const p=patients.find(x=>x.id===id);if(!p)return;p.status='active';p.outcome_type=null;p.outcome_at=null;renderAll();await saveMutation('patients','update',{status:'active',outcome_type:null,outcome_at:null,updated_by:session.user.id},{id,room_id:room.id});toast('Paciente restaurado ao painel.');}
async function deletePatient(id){if(currentPatientId===id){await closePatient();if(patientDirty)return;}const p=patients.find(x=>x.id===id);if(!p)return;const roomId=p.room_id,userId=session.user.id;let undone=false;toast('Exclusão em 6 segundos.',false,{label:'Desfazer',run:()=>{undone=true;toast('Exclusão cancelada.');}});setTimeout(async()=>{if(undone||session?.user?.id!==userId)return;const result=await saveMutation('patients','delete',null,{id,room_id:roomId});if(!result.error){patients=patients.filter(x=>x.id!==id);renderAll();}},6500);}

function subscribeRealtime(){unsubscribeRealtime();realtimeChannel=db.channel(`room-${room.id}`,{config:{presence:{key:presenceKey}}}).on('postgres_changes',{event:'*',schema:'public',table:'patients',filter:`room_id=eq.${room.id}`},()=>loadPatients()).on('postgres_changes',{event:'*',schema:'public',table:'pending_items',filter:`room_id=eq.${room.id}`},()=>loadPatients()).on('presence',{event:'sync'},renderPresence).on('presence',{event:'join'},renderPresence).on('presence',{event:'leave'},renderPresence).subscribe(async status=>{if(status==='SUBSCRIBED'){await realtimeChannel.track({user_id:session.user.id,name:session.user.user_metadata?.display_name||session.user.email?.split('@')[0],editing:null,online_at:new Date().toISOString()});$('connectionText').textContent='Ao vivo';}});}
function unsubscribeRealtime(){if(realtimeChannel)db.removeChannel(realtimeChannel);realtimeChannel=null;}
function renderPresence(){if(!realtimeChannel)return;const entries=Object.values(realtimeChannel.presenceState()).flat(),count=entries.length;$('presenceText').textContent=`${count} ${count===1?'pessoa':'pessoas'} online`;editingMap={};entries.filter(x=>x.user_id!==session.user.id&&x.editing).forEach(x=>editingMap[x.editing]=x.name||'Alguém');renderBoard();}
function trackEditing(id){if(realtimeChannel)realtimeChannel.track({user_id:session.user.id,name:session.user.user_metadata?.display_name||'Profissional',editing:id,online_at:new Date().toISOString()});}

function auditPatientName(data){
  const patientId=data?.patient_id||data?.id;
  return data?.name||patients.find(p=>p.id===patientId)?.name||'paciente';
}
function auditMemberName(id){
  return roomMembers.find(member=>member.user_id===id)?.name||'profissional';
}
function auditSummary(row){
  const before=row.before_data||{},after=row.after_data||{};
  if(row.entity==='patients'){
    const name=after.name||before.name||'paciente';
    const bed=after.bed||before.bed;
    const target=`${name}${bed?` · leito ${bed}`:''}`;
    if(row.action==='insert')return `adicionou ${target}`;
    if(row.action==='delete')return `excluiu ${target}`;
    if(row.action!=='update')return null;
    if(before.status!==after.status){
      if(after.status==='active')return `restaurou ${target} ao painel`;
      const type=after.outcome_type||(after.status==='discharged'?'discharge':'internal_transfer');
      return `registrou ${OUTCOMES[type]||'desfecho'} para ${target}`;
    }
    const changes=[];
    if(before.priority!==after.priority){
      const oldLabel=PRIORITIES.find(x=>x.id===before.priority)?.label||before.priority;
      const newLabel=PRIORITIES.find(x=>x.id===after.priority)?.label||after.priority;
      changes.push(`prioridade: ${oldLabel} → ${newLabel}`);
    }
    if(before.bed!==after.bed)changes.push(`leito: ${before.bed||'—'} → ${after.bed||'—'}`);
    if(before.responsible!==after.responsible)changes.push(`responsável: ${before.responsible||'—'} → ${after.responsible||'—'}`);
    if(before.name!==after.name)changes.push(`nome: ${before.name||'—'} → ${after.name||'—'}`);
    if(before.age!==after.age)changes.push(`idade: ${before.age??'—'} → ${after.age??'—'}`);
    if(before.diagnosis!==after.diagnosis)changes.push('atualizou diagnóstico/queixa');
    if(before.handoff_notes!==after.handoff_notes)changes.push('atualizou notas da passagem');
    if(before.entered_at!==after.entered_at)changes.push('alterou horário de entrada');
    return changes.length?`alterou ${target}: ${changes.slice(0,3).join('; ')}${changes.length>3?' e outros dados':''}`:null;
  }
  if(row.entity==='pending_items'){
    const data=row.action==='delete'?before:after;
    const title=data.title||before.title||'pendência';
    const patient=auditPatientName(data);
    if(row.action==='insert')return `adicionou a pendência “${title}” em ${patient}`;
    if(row.action==='delete')return `removeu a pendência “${title}” de ${patient}`;
    if(row.action!=='update')return null;
    if(before.done!==after.done)return `${after.done?'concluiu':'reabriu'} a pendência “${title}” de ${patient}`;
    const changes=[];
    if(before.title!==after.title)changes.push(`renomeou para “${after.title}”`);
    if(before.priority!==after.priority)changes.push(`mudou a prioridade para ${after.priority==='high'?'alta':after.priority==='low'?'baixa':'normal'}`);
    if(before.due_at!==after.due_at)changes.push(after.due_at?'alterou o prazo':'removeu o prazo');
    if(before.assigned_to!==after.assigned_to)changes.push(after.assigned_to?`atribuiu a ${auditMemberName(after.assigned_to)}`:'removeu o responsável');
    return changes.length?`alterou a pendência “${title}” de ${patient}: ${changes.join('; ')}`:null;
  }
  return null;
}
async function loadAudit(){
  if(!room)return;
  $('auditList').innerHTML='<div class="empty-lane">Carregando atividade…</div>';
  const {data,error}=await db.from('audit_log').select('*').eq('room_id',room.id).order('occurred_at',{ascending:false}).limit(100);
  if(error)return $('auditList').innerHTML=`<div class="empty-lane">${escapeHtml(friendlyError(error))}</div>`;
  const rows=(data||[]);
  const userIds=[...new Set(rows.map(x=>x.user_id).filter(Boolean))];
  const names={};
  if(userIds.length){
    const result=await db.from('profiles').select('id,display_name').in('id',userIds);
    if(!result.error)(result.data||[]).forEach(x=>names[x.id]=x.display_name);
  }
  auditRows=rows.map(row=>({row,summary:auditSummary(row)})).filter(x=>x.summary);
  $('auditList').innerHTML=auditRows.length
    ?auditRows.map(({row,summary})=>`<article class="audit-item"><div class="audit-icon">◷</div><div><p><strong>${escapeHtml(names[row.user_id]||'Profissional')}</strong> ${escapeHtml(summary)}.</p><small>${formatDate(row.occurred_at)}</small></div></article>`).join('')
    :'<div class="empty-lane">Nenhuma atividade registrada.</div>';
}
function showView(id){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===id));document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===id));if(id==='historico')renderHistory();if(id==='passagem')renderHandoff();if(id==='auditoria')loadAudit();window.scrollTo({top:0,behavior:'smooth'});}

function showShare(){if(!room)return;$('shareCode').textContent=room.invite_code;const link=`${location.origin}${location.pathname}?room=${encodeURIComponent(room.invite_code)}`;$('shareLink').value=link;$('qrCode').innerHTML='';if(window.QRCode)new QRCode($('qrCode'),{text:link,width:160,height:160,colorDark:'#07111f',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});openModal('shareModal');}
async function copyText(text,message){try{await navigator.clipboard.writeText(text);toast(message);}catch{toast(text);}}
async function nativeShare(){const data={title:`ERHub · ${room.name}`,text:`Entre na sala ${room.name} com o código ${room.invite_code}`,url:$('shareLink').value};if(navigator.share)await navigator.share(data);else copyText(data.url,'Link copiado.');}
function lock(){if(!session)return;$('unlockPassword').value='';$('lockScreen').classList.remove('hidden');setTimeout(()=>$('unlockPassword').focus(),60);}
async function unlock(e){e.preventDefault();setLoading(true);const {error}=await db.auth.signInWithPassword({email:session.user.email,password:$('unlockPassword').value});setLoading(false);if(error)return toast('Senha incorreta.',true);$('lockScreen').classList.add('hidden');resetInactivity();}
function resetInactivity(){clearTimeout(inactivityTimer);if(session)inactivityTimer=setTimeout(lock,15*60*1000);}

function updateNetworkState(){const offline=!navigator.onLine;$('offlineBanner').classList.toggle('hidden',!offline);$('connectionDot').classList.toggle('offline',offline);$('connectionText').textContent=offline?'Offline':'Ao vivo';}
function queueKey(){return 'erhub_queue_'+(session?.user?.id||'none');}
function getQueue(){try{return JSON.parse(localStorage.getItem(queueKey())||'[]');}catch{return[];}}
function queueMutation(op){const queue=getQueue();const entry={...op,operation_id:uuid(),user_id:session.user.id,queued_at:new Date().toISOString()};queue.push(entry);localStorage.setItem(queueKey(),JSON.stringify(queue));return entry;}
async function saveMutation(table,action,payload,filters={}){if(!session)return {error:new Error('Sessão encerrada')};const clean=value=>{if(!value)return value;const copy={...value};delete copy.assignee_name;delete copy.updated_by_name;delete copy.pending_items;return copy;};payload=Array.isArray(payload)?payload.map(clean):clean(payload);let entry;try{entry=queueMutation({table,action,payload,filters});localStorage.setItem(roomCacheKey(),JSON.stringify(patients));}catch(error){toast('Não foi possível guardar a alteração neste aparelho.',true);return {error};}if(navigator.onLine)await flushQueue();const queued=getQueue().some(x=>x.operation_id===entry.operation_id);setSync(queued?'Aguardando sincronização':'Tudo salvo');return {error:null,queued};}
async function flushQueue(){if(flushing)return flushing;if(!session||!navigator.onLine)return;const userId=session.user.id,key=queueKey();flushing=(async()=>{setSync('Sincronizando…',true);while(session?.user?.id===userId&&navigator.onLine){const queue=JSON.parse(localStorage.getItem(key)||'[]');const op=queue[0];if(!op)break;try{let query=db.from(op.table);if(op.action==='insert')query=query.upsert(op.payload,{onConflict:'id',ignoreDuplicates:true});if(op.action==='update')query=query.update(op.payload);if(op.action==='delete')query=query.delete();for(const [k,v]of Object.entries(op.filters||{}))query=query.eq(k,v);const {error}=await query;if(error)throw error;const latest=JSON.parse(localStorage.getItem(key)||'[]');localStorage.setItem(key,JSON.stringify(latest.filter(x=>x.operation_id!==op.operation_id)));}catch(error){toast('Alterações preservadas neste aparelho. Sincronização pendente: '+friendlyError(error),true);break;}}setSync(getQueue().length?'Aguardando sincronização':'Tudo salvo');})();try{await flushing;}finally{flushing=null;}}
function registerPwa(){if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));$('installAuth').onclick=installPwa;}
async function installPwa(){closeModal('mobileMenu');if(!deferredPrompt)return toast('No iPhone, toque em Compartilhar e depois “Adicionar à Tela de Início”.');deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installAuth').classList.add('hidden');}

function installRoomManagement(){
 const menu=$('mobileMenu').querySelector('.modal-panel');
 const desktop=$('deleteRoomDesktop').parentElement;
 for(const [container,cls] of [[menu,'menu-action'],[desktop,'nav-item']]){
  for(const [action,label] of [['room-members','Participantes da sala'],['leave-room','Sair desta sala']]){
   const b=document.createElement('button');b.type='button';b.className=cls;b.dataset.action=action;b.innerHTML='<span aria-hidden="true">'+(action==='room-members'?'♙':'↪')+'</span>'+label;container.appendChild(b);
  }
 }
 const modal=document.createElement('div');modal.id='membersModal';modal.className='modal';
 modal.innerHTML='<div class="modal-panel compact-panel"><div class="modal-head"><h2>Participantes da sala</h2><button class="icon-button" type="button" data-close="membersModal" aria-label="Fechar">×</button></div><div id="membersList"></div></div>';
 document.body.appendChild(modal);
 setInterval(()=>{if(room&&navigator.onLine&&!document.hidden)verifyRoomAccess();},15000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&room)verifyRoomAccess();});
}
async function verifyRoomAccess(){
 const id=room?.id;if(!id||!session)return;
 const {data,error}=await db.from('room_members').select('user_id').eq('room_id',id).eq('user_id',session.user.id);
 if(!error&&!data?.length&&room?.id===id){await forgetRoom(id);toast('Você não tem mais acesso a esta sala.');return false;}
 return !error;
}
async function forgetRoom(id){
 unsubscribeRealtime();clearTimeout(saveTimer);patientDirty=false;currentPatientId=null;
 localStorage.removeItem(`erhub_snapshot_${session.user.id}_${id}`);
 localStorage.setItem(queueKey(),JSON.stringify(getQueue().filter(op=>{
 const payload=Array.isArray(op.payload)?op.payload:[op.payload];
 return op.filters?.room_id!==id&&!payload.some(p=>p?.room_id===id);
 })));
 localStorage.removeItem('erhub_room');room=null;patients=[];roomMembers=[];auditRows=[];
 document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open'));document.body.style.overflow='';
 for(const target of ['board','history','handoff','auditList'])$(target).innerHTML='';
 history.replaceState({},'',location.pathname);await loadRooms();
}
async function leaveRoom(){
 if(!room||room.role==='owner')return;
 if(!navigator.onLine)return toast('Conecte-se à internet para sair da sala.',true);
 if(currentPatientId){await closePatient();if(patientDirty)return;}
 await flushQueue();if(getQueue().length)return toast('Sincronize as alterações antes de sair da sala.',true);
 const id=room.id;
 if(!confirm('Sair desta sala? Ela continuará disponível para os outros participantes.'))return;
 const {error}=await db.rpc('leave_room',{target_room_id:id});
 if(error)return toast(friendlyError(error),true);
 await forgetRoom(id);toast('Você saiu da sala.');
}
async function showRoomMembers(){
 closeModal('mobileMenu');if(!room)return;
 await loadRoomMembers();openModal('membersModal');
 const owner=room.role==='owner';
 $('membersList').innerHTML='<p class="muted">Apenas o criador pode remover participantes.</p>'+roomMembers.map(m=>`<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--border)"><div><strong>${escapeHtml(m.name)}</strong><small style="display:block">${m.role==='owner'?'Criador':'Participante'}${m.user_id===session.user.id?' · Você':''}</small></div>${owner&&m.role!=='owner'?`<button class="button danger" type="button" data-remove-member="${m.user_id}">Remover</button>`:''}</div>`).join('');
 $('membersList').querySelectorAll('[data-remove-member]').forEach(b=>b.onclick=()=>removeRoomMember(b.dataset.removeMember));
}
async function removeRoomMember(id){
 const m=roomMembers.find(x=>x.user_id===id);
 if(!m||room?.role!=='owner')return;
 if(!confirm(`Remover ${m.name} da sala? O código de convite será renovado para impedir a reentrada com o código antigo. Os demais participantes permanecem.`))return;
 const {error}=await db.rpc('remove_room_member',{target_room_id:room.id,target_user_id:id});
 if(error)return toast(friendlyError(error),true);
 const current=room.id;await loadRooms(current);await showRoomMembers();toast('Participante removido. O código de convite foi renovado.');
}
installRoomManagement();

init();
