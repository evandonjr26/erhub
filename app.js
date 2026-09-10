const SUPABASE_URL = 'https://khchcksxxkquzxoglbww.supabase.co';
const SUPABASE_KEY = 'sb_publishable_X3VrmhaoZ948g13Rl7_Amg_n-71c2Fb';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const DEFAULT_PENDING = ['Admissão', 'Prescrever', 'Laboratoriais', 'Checar exames', 'Reavaliar'];
let session = null;
let rooms = [];
let room = null;
let patients = [];
let currentPatientId = null;
let realtimeChannel = null;
let sortableInstance = null;
let saveTimer = null;
let toastTimer = null;
let loadingCount = 0;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function setLoading(active) {
  loadingCount = Math.max(0, loadingCount + (active ? 1 : -1));
  $('loading').classList.toggle('hidden', loadingCount === 0);
}

function toast(message, isError = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').className = `toast${isError ? ' error' : ''}`;
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
}

function friendlyError(error) {
  const message = error?.message || String(error || 'Erro inesperado');
  const map = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
    'User already registered': 'Este e-mail já possui uma conta.',
    'Invalid invite code': 'Código de convite inválido.'
  };
  return map[message] || message;
}

function showOnly(viewId) {
  ['authView', 'workspaceView', 'appView'].forEach((id) => $(id).classList.toggle('hidden', id !== viewId));
}

function showAuthForm(name) {
  const forms = { login: 'loginForm', signup: 'signupForm', recovery: 'recoveryForm', password: 'newPasswordForm' };
  Object.values(forms).forEach((id) => $(id).classList.add('hidden'));
  $(forms[name]).classList.remove('hidden');
  $('showLogin').classList.toggle('hidden', name === 'login');
  $('showSignup').classList.toggle('hidden', name === 'signup' || name === 'password');
  $('showRecovery').classList.toggle('hidden', name === 'recovery' || name === 'password');
}

async function handleSession(nextSession) {
  session = nextSession;
  if (!session) {
    unsubscribeRealtime();
    rooms = [];
    room = null;
    patients = [];
    showOnly('authView');
    showAuthForm('login');
    return;
  }
  await loadRooms();
}

async function init() {
  bindEvents();
  const { data } = await db.auth.getSession();
  await handleSession(data.session);
  db.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'PASSWORD_RECOVERY') {
      session = nextSession;
      showOnly('authView');
      showAuthForm('password');
    } else if (event === 'SIGNED_OUT') {
      handleSession(null);
    } else if (event === 'SIGNED_IN' && nextSession?.user?.id !== session?.user?.id) {
      handleSession(nextSession);
    }
  });
}

function bindEvents() {
  $('showLogin').onclick = () => showAuthForm('login');
  $('showSignup').onclick = () => showAuthForm('signup');
  $('showRecovery').onclick = () => showAuthForm('recovery');
  $('loginForm').onsubmit = login;
  $('signupForm').onsubmit = signup;
  $('recoveryForm').onsubmit = recoverPassword;
  $('newPasswordForm').onsubmit = updatePassword;
  $('createRoomForm').onsubmit = createRoom;
  $('joinRoomForm').onsubmit = joinRoom;
  $('roomSelect').onchange = () => selectRoom($('roomSelect').value);
  $('inviteButton').onclick = copyInvite;
  $('importFile').onchange = importFile;
  $('novaPend').onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); addPend(); } };
  ['nome', 'leito', 'idade', 'dx', 'responsavel', 'prio', 'entrada'].forEach((id) => {
    $(id).addEventListener(id === 'prio' || id === 'entrada' ? 'change' : 'input', scheduleSave);
  });
  $('patientModal').onclick = (event) => { if (event.target === $('patientModal')) fecharPaciente(); };
  $('importModal').onclick = (event) => { if (event.target === $('importModal')) fecharModalImportar(); };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { fecharPaciente(); fecharModalImportar(); }
  });
}

async function login(event) {
  event.preventDefault();
  setLoading(true);
  const { error } = await db.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value });
  setLoading(false);
  if (error) toast(friendlyError(error), true);
}

async function signup(event) {
  event.preventDefault();
  setLoading(true);
  const { data, error } = await db.auth.signUp({
    email: $('signupEmail').value.trim(),
    password: $('signupPassword').value,
    options: { data: { display_name: $('signupName').value.trim() }, emailRedirectTo: location.origin }
  });
  setLoading(false);
  if (error) return toast(friendlyError(error), true);
  if (!data.session) {
    toast('Conta criada. Confira seu e-mail para confirmar o acesso.');
    showAuthForm('login');
  }
}

async function recoverPassword(event) {
  event.preventDefault();
  setLoading(true);
  const { error } = await db.auth.resetPasswordForEmail($('recoveryEmail').value.trim(), { redirectTo: location.origin });
  setLoading(false);
  if (error) return toast(friendlyError(error), true);
  toast('Enviamos o link de recuperação para seu e-mail.');
  showAuthForm('login');
}

async function updatePassword(event) {
  event.preventDefault();
  setLoading(true);
  const { error } = await db.auth.updateUser({ password: $('newPassword').value });
  setLoading(false);
  if (error) return toast(friendlyError(error), true);
  toast('Senha atualizada.');
  await handleSession((await db.auth.getSession()).data.session);
}

async function logout() {
  await db.auth.signOut();
}

async function loadRooms(preferredId) {
  setLoading(true);
  const { data, error } = await db.from('room_members').select('room_id, role, rooms(id,name,invite_code)').eq('user_id', session.user.id);
  setLoading(false);
  if (error) return toast(friendlyError(error), true);
  rooms = (data || []).map((item) => ({ ...(Array.isArray(item.rooms) ? item.rooms[0] : item.rooms), role: item.role })).filter((item) => item.id);
  if (!rooms.length) {
    room = null;
    showOnly('workspaceView');
    return;
  }
  const saved = preferredId || localStorage.getItem('erhub_room');
  await selectRoom(rooms.some((item) => item.id === saved) ? saved : rooms[0].id);
}

async function createRoom(event) {
  event.preventDefault();
  setLoading(true);
  const { data, error } = await db.rpc('create_room', { room_name: $('roomName').value.trim() });
  setLoading(false);
  if (error) return toast(friendlyError(error), true);
  $('roomName').value = '';
  await loadRooms(data?.[0]?.created_room_id);
  toast('Sala criada. Compartilhe o código somente com a equipe autorizada.');
}

async function joinRoom(event) {
  event.preventDefault();
  setLoading(true);
  const { data, error } = await db.rpc('join_room', { invite_code_input: $('inviteCode').value.trim().toUpperCase() });
  setLoading(false);
  if (error) return toast(friendlyError(error), true);
  $('inviteCode').value = '';
  await loadRooms(data);
  toast('Você entrou na sala.');
}

async function selectRoom(id) {
  const selected = rooms.find((item) => item.id === id);
  if (!selected) return;
  room = selected;
  localStorage.setItem('erhub_room', room.id);
  $('roomSelect').innerHTML = rooms.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === room.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  $('inviteButton').textContent = `Código: ${room.invite_code}`;
  showOnly('appView');
  await loadPatients();
  subscribeRealtime();
  checkLocalMigration();
}

function trocarSala() { showOnly('workspaceView'); }

async function copyInvite() {
  try { await navigator.clipboard.writeText(room.invite_code); toast('Código copiado.'); }
  catch { toast(`Código da sala: ${room.invite_code}`); }
}

async function loadPatients() {
  if (!room) return;
  setLoading(true);
  const { data, error } = await db.from('patients').select('*, pending_items(*)').eq('room_id', room.id).order('sort_order').order('created_at');
  setLoading(false);
  if (error) return toast(friendlyError(error), true);
  patients = (data || []).map((patient) => ({
    ...patient,
    pending_items: (patient.pending_items || []).sort((a, b) => a.position - b.position)
  }));
  render();
  renderHistory();
  if (currentPatientId && $('patientModal').classList.contains('open')) renderPending();
}

function subscribeRealtime() {
  unsubscribeRealtime();
  realtimeChannel = db.channel(`room-${room.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'patients', filter: `room_id=eq.${room.id}` }, loadPatients)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_items', filter: `room_id=eq.${room.id}` }, loadPatients)
    .subscribe();
}

function unsubscribeRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

function showView(id) {
  document.querySelectorAll('.view').forEach((node) => node.classList.remove('active'));
  $(id).classList.add('active');
  if (id === 'historico') renderHistory();
}

function activePatients() { return patients.filter((patient) => patient.status === 'active'); }

function elapsed(enteredAt) {
  const minutes = Math.floor((Date.now() - new Date(enteredAt).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  const hours = Math.floor(minutes / 60);
  return hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
}

function render() {
  const list = activePatients();
  $('board').innerHTML = list.length ? list.map((patient) => `
    <article class="card ${escapeHtml(patient.priority)}" data-id="${escapeHtml(patient.id)}">
      <button class="drag-handle" type="button" aria-label="Arrastar">⠿</button>
      <button class="delete-card" type="button" aria-label="Excluir paciente">✕</button>
      ${patient.bed ? `<div class="leito-badge">🛏 ${escapeHtml(patient.bed)}</div><br>` : ''}
      <strong>${escapeHtml(patient.name || 'Sem nome')} — ${patient.age ?? '-'} anos</strong><br>
      ${patient.responsible ? `<small>Responsável: ${escapeHtml(patient.responsible)}</small>` : ''}
      <div class="diagnosis">${escapeHtml(patient.diagnosis || '')}</div>
      <div class="tempo-sala">⏱ ${elapsed(patient.entered_at)}</div>
      ${(patient.pending_items || []).map((item) => `<div class="p-item ${item.done ? 'done' : ''}"><div class="check" data-pending-id="${escapeHtml(item.id)}"></div><span class="pending-title">${escapeHtml(item.title)}</span></div>`).join('')}
    </article>`).join('') : '<div class="empty">Nenhum paciente ativo nesta sala.<br><br><button type="button" onclick="novo()">Adicionar primeiro paciente</button></div>';

  document.querySelectorAll('.card').forEach((card) => {
    card.onclick = () => openPatient(card.dataset.id);
    card.querySelector('.delete-card').onclick = (event) => { event.stopPropagation(); deletePatient(card.dataset.id); };
    card.querySelectorAll('.check').forEach((check) => { check.onclick = (event) => { event.stopPropagation(); togglePending(check.dataset.pendingId); }; });
  });
  initSortable();
}

function renderHistory() {
  const history = patients.filter((patient) => patient.status !== 'active').sort((a, b) => new Date(b.outcome_at) - new Date(a.outcome_at));
  $('history').innerHTML = history.length ? history.map((patient) => `
    <article class="h-item">
      <strong>${escapeHtml(patient.name || 'Sem nome')} — ${patient.age ?? '-'} anos</strong><br>
      ${patient.bed ? `Leito: ${escapeHtml(patient.bed)}<br>` : ''}
      ${patient.responsible ? `Responsável: ${escapeHtml(patient.responsible)}<br>` : ''}
      <div class="diagnosis">${escapeHtml(patient.diagnosis || '')}</div>
      <span class="status ${escapeHtml(patient.status)}">${patient.status === 'discharged' ? 'Alta' : 'Transferência'}</span>
    </article>`).join('') : '<div class="empty">Nenhum paciente no histórico.</div>';
}

function initSortable() {
  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = window.Sortable.create($('board'), {
    handle: '.drag-handle', animation: 150,
    onEnd: async () => {
      const ids = [...$('board').querySelectorAll('.card')].map((node) => node.dataset.id);
      const updates = ids.map((id, index) => db.from('patients').update({ sort_order: index, updated_by: session.user.id }).eq('id', id).eq('room_id', room.id));
      const results = await Promise.all(updates);
      const error = results.find((result) => result.error)?.error;
      if (error) toast(friendlyError(error), true);
    }
  });
}

async function novo() {
  const order = activePatients().length;
  setLoading(true);
  const { data: patient, error } = await db.from('patients').insert({ room_id: room.id, sort_order: order, created_by: session.user.id, updated_by: session.user.id }).select().single();
  if (error) { setLoading(false); return toast(friendlyError(error), true); }
  const items = DEFAULT_PENDING.map((title, position) => ({ patient_id: patient.id, room_id: room.id, title, position, created_by: session.user.id, updated_by: session.user.id }));
  const { error: pendingError } = await db.from('pending_items').insert(items);
  setLoading(false);
  if (pendingError) toast(friendlyError(pendingError), true);
  await loadPatients();
  openPatient(patient.id);
}

function openPatient(id) {
  const patient = patients.find((item) => item.id === id);
  if (!patient) return;
  currentPatientId = id;
  $('nome').value = patient.name || '';
  $('leito').value = patient.bed || '';
  $('idade').value = patient.age ?? '';
  $('dx').value = patient.diagnosis || '';
  $('responsavel').value = patient.responsible || '';
  $('prio').value = patient.priority;
  $('entrada').value = toLocalInput(patient.entered_at);
  renderPending();
  $('patientModal').classList.add('open');
}

function patientPayload() {
  return {
    name: $('nome').value.trim(), bed: $('leito').value.trim(),
    age: $('idade').value === '' ? null : Number($('idade').value),
    diagnosis: $('dx').value.trim(), responsible: $('responsavel').value.trim(),
    priority: $('prio').value, entered_at: new Date($('entrada').value).toISOString(),
    updated_by: session.user.id
  };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePatient, 500);
}

async function savePatient() {
  if (!currentPatientId || !$('entrada').value) return;
  clearTimeout(saveTimer);
  const { error } = await db.from('patients').update(patientPayload()).eq('id', currentPatientId).eq('room_id', room.id);
  if (error) toast(friendlyError(error), true);
}

async function fecharPaciente() {
  if (!$('patientModal').classList.contains('open')) return;
  await savePatient();
  $('patientModal').classList.remove('open');
  currentPatientId = null;
  await loadPatients();
}

function renderPending() {
  const patient = patients.find((item) => item.id === currentPatientId);
  if (!patient) return;
  $('pendencias').innerHTML = (patient.pending_items || []).map((item) => `
    <div class="p-item ${item.done ? 'done' : ''}">
      <div class="check" data-id="${escapeHtml(item.id)}"></div>
      <span class="pending-title">${escapeHtml(item.title)}</span>
      <button class="trash" type="button" data-delete-id="${escapeHtml(item.id)}">🗑️</button>
    </div>`).join('');
  $('pendencias').querySelectorAll('.check').forEach((node) => node.onclick = () => togglePending(node.dataset.id));
  $('pendencias').querySelectorAll('[data-delete-id]').forEach((node) => node.onclick = () => deletePending(node.dataset.deleteId));
}

async function addPend() {
  const title = $('novaPend').value.trim();
  const patient = patients.find((item) => item.id === currentPatientId);
  if (!title || !patient) return;
  $('novaPend').value = '';
  const { error } = await db.from('pending_items').insert({ patient_id: patient.id, room_id: room.id, title, position: patient.pending_items.length, created_by: session.user.id, updated_by: session.user.id });
  if (error) return toast(friendlyError(error), true);
  await loadPatients();
}

async function togglePending(id) {
  const item = patients.flatMap((patient) => patient.pending_items || []).find((pending) => pending.id === id);
  if (!item) return;
  const { error } = await db.from('pending_items').update({ done: !item.done, updated_by: session.user.id }).eq('id', id).eq('room_id', room.id);
  if (error) return toast(friendlyError(error), true);
  await loadPatients();
}

async function deletePending(id) {
  const { error } = await db.from('pending_items').delete().eq('id', id).eq('room_id', room.id);
  if (error) return toast(friendlyError(error), true);
  await loadPatients();
}

async function deletePatient(id) {
  if (!confirm('Remover paciente sem registrar desfecho?')) return;
  const { error } = await db.from('patients').delete().eq('id', id).eq('room_id', room.id);
  if (error) return toast(friendlyError(error), true);
  await loadPatients();
}

async function desfecho(status) {
  await savePatient();
  const { error } = await db.from('patients').update({ status, outcome_at: new Date().toISOString(), updated_by: session.user.id }).eq('id', currentPatientId).eq('room_id', room.id);
  if (error) return toast(friendlyError(error), true);
  $('patientModal').classList.remove('open');
  currentPatientId = null;
  await loadPatients();
}

function gerarPDF() { showView('painel'); setTimeout(() => window.print(), 250); }

function exportarDados() {
  const payload = { version: 2, exportadoEm: new Date().toISOString(), sala: room.name, pacientes: patients.map(toExportPatient) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `erhub-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function toExportPatient(patient) {
  return { id: patient.id, nome: patient.name, leito: patient.bed, idade: patient.age, dx: patient.diagnosis, prio: patient.priority, responsavel: patient.responsible, entrada: patient.entered_at, desfecho: patient.status === 'discharged' ? 'Alta' : patient.status === 'transferred' ? 'Transferência' : null, pend: (patient.pending_items || []).map((item) => ({ t: item.title, d: item.done })) };
}

function abrirModalImportar() { $('textoColado').value = ''; $('importModal').classList.add('open'); }
function fecharModalImportar() { $('importModal').classList.remove('open'); $('importFile').value = ''; }

async function importFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try { await importPayload(JSON.parse(await file.text())); }
  catch (error) { toast(`Arquivo inválido: ${friendlyError(error)}`, true); }
}

async function importarTexto() {
  try { await importPayload(JSON.parse($('textoColado').value.trim())); }
  catch (error) { toast(`Texto inválido: ${friendlyError(error)}`, true); }
}

function normalizeImport(data) {
  if (!data || !Array.isArray(data.pacientes)) throw new Error('não encontrei uma lista de pacientes');
  const active = data.pacientes || [];
  const history = Array.isArray(data.historico) ? data.historico : [];
  return [...active, ...history];
}

async function importPayload(data) {
  const source = normalizeImport(data);
  if (!source.length) return toast('O arquivo não contém pacientes.', true);
  if (!confirm(`Importar ${source.length} paciente(s) para ${room.name}? Os dados atuais serão mantidos.`)) return;
  setLoading(true);
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const status = item.desfecho === 'Alta' ? 'discharged' : item.desfecho === 'Transferência' ? 'transferred' : 'active';
    const { data: created, error } = await db.from('patients').insert({
      room_id: room.id, name: String(item.nome || ''), bed: String(item.leito || ''),
      age: item.idade === '' || item.idade == null ? null : Number(item.idade), diagnosis: String(item.dx || ''),
      priority: ['red', 'yellow', 'green'].includes(item.prio) ? item.prio : 'yellow', responsible: String(item.responsavel || ''),
      entered_at: validIso(item.entrada), status, outcome_at: status === 'active' ? null : new Date().toISOString(),
      sort_order: activePatients().length + index, created_by: session.user.id, updated_by: session.user.id
    }).select().single();
    if (error) { setLoading(false); throw error; }
    const pending = (Array.isArray(item.pend) && item.pend.length ? item.pend : DEFAULT_PENDING.map((title) => ({ t: title, d: false }))).map((pendingItem, position) => ({
      patient_id: created.id, room_id: room.id, title: String(pendingItem.t || '').slice(0, 240), done: Boolean(pendingItem.d), position, created_by: session.user.id, updated_by: session.user.id
    })).filter((pendingItem) => pendingItem.title.trim());
    if (pending.length) {
      const { error: pendingError } = await db.from('pending_items').insert(pending);
      if (pendingError) { setLoading(false); throw pendingError; }
    }
  }
  setLoading(false);
  fecharModalImportar();
  localStorage.setItem('erhub_local_migrated', '1');
  $('migrationBanner').classList.add('hidden');
  await loadPatients();
  toast('Importação concluída. Os dados agora estão sincronizados.');
}

function checkLocalMigration() {
  const oldPatients = JSON.parse(localStorage.getItem('p') || '[]');
  const oldHistory = JSON.parse(localStorage.getItem('h') || '[]');
  const hasOld = oldPatients.length || oldHistory.length;
  $('migrationBanner').classList.toggle('hidden', !hasOld || localStorage.getItem('erhub_local_migrated') === '1');
}

async function migrarDadosLocais() {
  await importPayload({ pacientes: JSON.parse(localStorage.getItem('p') || '[]'), historico: JSON.parse(localStorage.getItem('h') || '[]') });
}

function ocultarMigracao() { $('migrationBanner').classList.add('hidden'); }

function validIso(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toLocalInput(value) {
  const date = new Date(value || Date.now());
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

setInterval(() => { if (room) render(); }, 60000);
init().catch((error) => toast(friendlyError(error), true));
