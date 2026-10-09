// auth.js — sesión, perfil, mis reportes/apoyos
const fp = localStorage.getItem('lcalerta_fp') || (() => { const v = crypto.randomUUID(); localStorage.setItem('lcalerta_fp', v); return v; })();
const auth = {
  get token() { return localStorage.getItem('lcalerta_token'); },
  set token(v) { v ? localStorage.setItem('lcalerta_token', v) : localStorage.removeItem('lcalerta_token'); },
  get nombre() { return localStorage.getItem('lcalerta_nombre') || ''; },
  set nombre(v) { localStorage.setItem('lcalerta_nombre', v || ''); },
};
function headersAuth() { return auth.token ? { authorization: 'Bearer ' + auth.token } : {}; }
function pintarSesion() {
  document.querySelector('#btnSesion').textContent = auth.token ? auth.nombre : 'Entrar';
  renderPerfil();
  if (typeof gate === 'function') gate();
}
async function renderPerfil() {
  const logged = !!auth.token;
  document.querySelector('#perfilAnon').hidden = logged;
  document.querySelector('#perfilUser').hidden = !logged;
  if (!logged) return;
  try {
    const me = await (await fetch('/api/auth/me', { headers: headersAuth() })).json();
    if (me.error) throw new Error();
    document.querySelector('#pNombre').textContent = me.nombre;
    document.querySelector('#pEmail').textContent = me.email;
    const mine = await (await fetch('/api/mis-reportes', { headers: headersAuth() })).json();
    document.querySelector('#misReportes').innerHTML = mine.map(r =>
      `<li class="bg-slate-800 rounded-lg p-2 shadow-sm">${CAT_LABEL[r.categoria]} · ${ESTADO_EMOJI[r.estado]} · ${r.colonia || ''}</li>`).join('') || '<li>Aún no reportas nada</li>';
    const votos = await (await fetch('/api/mis-votos?fingerprint=' + fp)).json();
    document.querySelector('#misVotos').innerHTML = votos.map(v =>
      `<li class="bg-slate-800 rounded-lg p-2 shadow-sm"><i data-lucide="thumbs-up"></i> ${CAT_LABEL[v.categoria]} · ${v.colonia || ''}</li>`).join('') || '<li>No has apoyado nada todavía</li>';
    const ins = [];
    if (mine.length >= 1) ins.push('<i data-lucide="award"></i> Primer reporte');
    if (mine.length >= 5) ins.push('<i data-lucide="flame"></i> Vecino activo');
    if (votos.length >= 1) ins.push('<i data-lucide="thumbs-up"></i> Padrino de reportes');
    if (mine.some(r => r.votos >= 5)) ins.push('<i data-lucide="megaphone"></i> Tu reporte se hizo viral');
    document.querySelector('#insignias').innerHTML = ins.map(i => `<span class="badge badge-warning">${i}</span>`).join('');
    lucide.createIcons();
  } catch { auth.token = null; auth.nombre = ''; pintarSesion(); }
}

document.querySelector('#btnSesion').onclick = () => activarTab('perfil');
document.querySelector('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: f.email.value, password: f.password.value }) });
  const d = await r.json();
  if (!r.ok) return $('#msgLogin').textContent = d.error;
  auth.token = d.token; auth.nombre = d.nombre; f.reset(); $('#msgLogin').textContent = '¡Bienvenido de vuelta!'; pintarSesion();
};
document.querySelector('#registroForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const r = await fetch('/api/auth/registro', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nombre: f.nombre.value, email: f.email.value, password: f.password.value }) });
  const d = await r.json();
  if (!r.ok) return $('#msgReg').textContent = d.error;
  auth.token = d.token; auth.nombre = d.nombre; f.reset(); $('#msgReg').textContent = '¡Cuenta lista!'; pintarSesion();
};
document.querySelector('#btnLogout').onclick = () => { auth.token = null; auth.nombre = ''; pintarSesion(); };
