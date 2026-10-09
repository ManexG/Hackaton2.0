// app.js — feed, mapa, offline-first, paginación, comentarios
const $ = s => document.querySelector(s);
const CAT_COLOR = { alumbrado: '#eab308', bache: '#ef4444', basura: '#22c55e', fuga_agua: '#3b82f6', otro: '#a855f7' };
const CAT_LABEL = { alumbrado: 'Alumbrado', bache: 'Bache', basura: 'Basura', fuga_agua: 'Fuga de agua', otro: 'Otro' };
const CAT_ICON = { alumbrado: 'lightbulb', bache: 'alert-triangle', basura: 'trash-2', fuga_agua: 'droplet', otro: 'help-circle' };
const ESTADO_EMOJI = { enviado: '<i data-lucide="send"></i> Enviado', recibido: '<i data-lucide="eye"></i> Visto', aprobado: '<i data-lucide="check-circle-2"></i> Arreglado', no_aprobado: '<i data-lucide="x-circle"></i> No aplica' };

// (animación de entrada de cards vía CSS keyframes en app.css)

// ---------- IndexedDB ----------
const idb = {
  open() { return new Promise((res, rej) => {
    const r = indexedDB.open('lcalerta', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('cola', { keyPath: 'ts' }); r.result.createObjectStore('cache', { keyPath: 'k' }); };
    r.onsuccess = () => res(r.result); r.onerror = rej;
  });},
  async all(store) { const db = await this.open(); return new Promise(res => {
    const tx = db.transaction(store).objectStore(store).getAll(); tx.onsuccess = () => res(tx.result); });},
  async put(store, v) { const db = await this.open(); return new Promise(res => {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(v); tx.oncomplete = res; });},
  async del(store, k) { const db = await this.open(); return new Promise(res => {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(k); tx.oncomplete = res; });},
};

// ---------- Gate: no sesión, no app ----------
function gate() {
  const ok = !!auth.token;
  $('#btnReportar').style.display = ok ? '' : 'none';
  $('#rankingChips').style.display = ok ? '' : 'none';
  document.querySelectorAll('.dock button').forEach(b => {
    if (b.dataset.tab === 'perfil') return;
    b.style.opacity = ok ? '1' : '.4';
    b.style.pointerEvents = ok ? 'auto' : 'none';
  });
  if (!ok) activarTab('perfil');
}

// ---------- Tabs ----------
function activarTab(nombre) {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('dock-active', x.dataset.tab === nombre));
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== 'tab-' + nombre);
  if (nombre === 'mapa') mapa();
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => activarTab(b.dataset.tab));

$('#btnReportar').onclick = () => { if (auth.token) abrirModal(); else activarTab('perfil'); };
$('#btnCancelar').onclick = () => { $('#modalReportar').hidden = true; resetModal(); };

// ---------- GPS ----------
$('#btnGps').onclick = () => navigator.geolocation?.getCurrentPosition(
  p => {
    const lat = p.coords.latitude, lng = p.coords.longitude;
    $('#coords').textContent = '¡Listo!';
    $('#formReporte [name=lat]').value = lat;
    $('#formReporte [name=lng]').value = lng;
    coloniaDesdeGPS(lat, lng);
  },
  () => $('#coords').textContent = 'No pudimos ubicarte',
  { enableHighAccuracy: true });

// Colonia automática por coordenadas (Photon / OpenStreetMap). Si falla, el campo queda editable a mano.
async function coloniaDesdeGPS(lat, lng) {
  const campo = $('#formReporte [name=colonia]');
  if (campo.value.trim()) return; // el vecino ya escribió una: no la pisamos
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`, { signal: ctrl.signal });
    clearTimeout(t);
    const d = await r.json();
    const pr = d.features?.[0]?.properties;
    const nombre = pr && (pr.suburb || pr.district || pr.neighbourhood || pr.city_district || pr.village || pr.city);
    if (nombre) { campo.value = nombre; $('#coords').textContent = `Colonia: ${nombre}`; }
  } catch { /* sin señal o Photon caído: se deja escribir la colonia */ }
}

// ---------- Envío (2 pasos: formulario -> confirmación) ----------
let pendienteEnvio = null;
function resetModal() {
  $('#formReporte').reset();
  $('#formFields').hidden = false;
  $('#pasoConfirm').hidden = true;
  $('#coords').textContent = '';
  $('#msgForm').textContent = '';
  if (pendienteEnvio && pendienteEnvio.thumbUrl) URL.revokeObjectURL(pendienteEnvio.thumbUrl);
  pendienteEnvio = null;
}
function abrirModal() { resetModal(); $('#modalReportar').hidden = false; }

$('#formReporte').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const lat = parseFloat(f.lat.value), lng = parseFloat(f.lng.value);
  if (!isFinite(lat)) return $('#msgForm').textContent = 'Primero toca Mi ubicación';
  const foto = f.foto.files[0];
  const fotoBlob = foto ? await compress(foto) : null;
  pendienteEnvio = { ts: Date.now(), categoria: f.categoria.value, descripcion: f.descripcion.value,
    colonia: f.colonia.value, lat, lng, foto: fotoBlob, thumbUrl: fotoBlob ? URL.createObjectURL(fotoBlob) : null };
  $('#resumen').innerHTML = `
    ${pendienteEnvio.thumbUrl ? `<img src="${pendienteEnvio.thumbUrl}" class="rounded-xl w-full">` : ''}
    <p class="text-lg font-black m-0">${CAT_LABEL[pendienteEnvio.categoria]}</p>
    ${pendienteEnvio.descripcion ? `<p class="m-0">${pendienteEnvio.descripcion}</p>` : ''}
    <p class="text-slate-400 text-sm m-0">${pendienteEnvio.colonia || 'Sin colonia'} · ${pendienteEnvio.lat.toFixed(5)}, ${pendienteEnvio.lng.toFixed(5)}</p>
    <p class="text-slate-400 text-xs m-0">Se enviará a tus compañeros y al ayuntamiento. Puedes editar antes de confirmar.</p>`;
  $('#formFields').hidden = true;
  $('#pasoConfirm').hidden = false;
  lucide.createIcons();
};

$('#btnEditar').onclick = () => { $('#pasoConfirm').hidden = true; $('#formFields').hidden = false; };

$('#btnConfirmar').onclick = async () => {
  if (!pendienteEnvio) return;
  await idb.put('cola', { ts: pendienteEnvio.ts, categoria: pendienteEnvio.categoria, descripcion: pendienteEnvio.descripcion,
    colonia: pendienteEnvio.colonia, lat: pendienteEnvio.lat, lng: pendienteEnvio.lng, foto: pendienteEnvio.foto });
  $('#modalReportar').hidden = true;
  resetModal();
  toast('¡Tu reporte quedó guardado!');
  syncChip(); renderPendientes(); sync();
};
function compress(file) { return new Promise(res => {
  const img = new Image(); img.src = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, 1280 / img.width);
    const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(res, 'image/jpeg', 0.7); };
});}

// ---------- Sync ----------
async function sync() {
  if (!navigator.onLine) return syncChip();
  for (const r of await idb.all('cola')) {
    const fd = new FormData();
    fd.append('categoria', r.categoria); fd.append('descripcion', r.descripcion);
    fd.append('colonia', r.colonia); fd.append('lat', r.lat); fd.append('lng', r.lng);
    if (r.foto) fd.append('foto', r.foto, 'foto.jpg');
    try { const res = await fetch('/api/reportes', { method: 'POST', body: fd, headers: headersAuth() });
      if (res.ok) await idb.del('cola', r.ts);
    } catch { break; }
  }
  syncChip(); renderPendientes(); cargarFeed(true);
}
window.addEventListener('online', sync);
async function syncChip() {
  const c = await idb.all('cola');
  const el = $('#syncChip');
  el.classList.toggle('badge-error', !navigator.onLine);
  el.classList.toggle('badge-success', navigator.onLine);
  el.textContent = navigator.onLine ? (c.length ? `${c.length} por subir` : 'En línea') : `Sin señal · ${c.length}`;
}

// ---------- Pendientes ----------
async function renderPendientes() {
  const cola = await idb.all('cola');
  $('#pendientes').innerHTML = cola.length
    ? cola.map(r => `<div class="bg-amber-900/50 text-amber-200 rounded-lg p-3 mb-2 font-semibold">${CAT_LABEL[r.categoria]} — ${r.descripcion || ''} <b>(te falta señal)</b></div>`).join('') : '';
}

// ---------- Feed paginado ----------
let offset = 0, cargando = false;
function queryFeed() {
  const p = new URLSearchParams({ limit: 20, offset });
  const q = $('#buscador').value.trim();
  if (q) p.set('q', q);
  if ($('#fEstado').value) p.set('estado', $('#fEstado').value);
  if ($('#fColonia').value) p.set('colonia', $('#fColonia').value);
  return p.toString();
}
async function cargarFeed(reset = false) {
  if (reset) { offset = 0; $('#muro').innerHTML = ''; $('#muro').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; }
  if (cargando) return; cargando = true;
  try {
    const res = await fetch(`/api/reportes?${queryFeed()}`);
    const reportes = await res.json();
    if (reset) idb.put('cache', { k: 'muro', v: reportes });
    offset += reportes.length;
    if (reset) $('#muro').innerHTML = '';
    $('#muro').innerHTML += reportes.map(tarjeta).join('') || (reset ? emptyState() : '');
    $('#moreBtn').style.display = reportes.length === 20 ? '' : 'none';
    bindearTarjetas();
    marcadores(reportes);
    lucide.createIcons();
  } catch {
    const cache = (await idb.all('cache')).find(c => c.k === 'muro');
    if (cache && reset) $('#muro').innerHTML = cache.v.map(tarjeta).join('');
  }
  cargando = false;
  avisarCambios();
}
$('#moreBtn').onclick = () => cargarFeed();
function emptyState() {
  return `<div class="text-center text-slate-400 py-10">
    <i data-lucide="inbox" style="width:48px;height:48px"></i>
    <p class="mt-2 text-lg">Aún no hay reportes aquí.<br>Sé el primero en contarlo <b>Reportar</b>.</p></div>`;
}

function tarjeta(r) {
  return `<li class="card p-4">
    <div class="flex items-center gap-2">
      <i data-lucide="${CAT_ICON[r.categoria] || 'help-circle'}"></i>
      <h3 class="font-black text-lg m-0">${CAT_LABEL[r.categoria] || r.categoria}</h3>
      <span class="badge estado ${r.estado}">${ESTADO_EMOJI[r.estado]}</span>
    </div>
    <p class="text-slate-400 text-sm m-0">${r.user_nombre ? '<i data-lucide="user"></i> ' + r.user_nombre + ' · ' : ''}${r.colonia || 'Colonia'} · ${dias(r.created_at)}</p>
    ${r.descripcion ? `<p>${r.descripcion}</p>` : ''}
    ${r.nota ? `<p class="bg-blue-950/50 rounded-lg p-2"><i data-lucide="landmark"></i> ${r.nota}</p>` : ''}
    ${r.foto_key ? `<img id="foto-${r.id}" loading="lazy" class="rounded-xl w-full" src="/api/foto/${r.foto_key}" alt="reporte">` : ''}
    <div class="flex gap-2 mt-3">
      <button class="btn btn-outline btn-primary flex-1" data-votar="${r.id}"><i data-lucide="thumbs-up"></i> Apoyar (${r.votos})</button>
      <button class="btn btn-outline btn-secondary" data-compartir="${r.id}"><i data-lucide="share-2"></i></button>
    </div>
    <details class="mt-2">
      <summary class="cursor-pointer font-bold"><i data-lucide="message-circle"></i> Comentarios</summary>
      <ul id="coms-${r.id}" class="space-y-1 my-2"></ul>
      <form id="formCom-${r.id}" class="flex gap-2">
        <input name="nombre" placeholder="Tu nombre" class="input input-bordered input-sm flex-1">
        <input name="texto" placeholder="Escribe…" class="input input-bordered input-sm flex-[2]">
        <button class="btn btn-sm btn-primary">Enviar</button>
      </form>
    </details>
  </li>`;
}
function bindearTarjetas() {
  document.querySelectorAll('[data-votar]').forEach(b => b.onclick = async () => {
    const res = await fetch(`/api/reportes/${b.dataset.votar}/votar`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint: fp }) });
    if (res.status === 409) toast('Ya apoyaste este reporte');
    else if (res.ok) { b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' }); toast('¡Listo! Apoyaste este reporte'); }
    cargarFeed(true);
  });
document.querySelectorAll('[data-compartir]').forEach(b => b.onclick = () => {
    const url = `${location.origin}/reporte/${b.dataset.compartir}`;
    if (navigator.share) navigator.share({ title: 'LCAlerta', text: 'Mira este reporte de mi colonia', url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast('Enlace copiado'));
  });
  document.querySelectorAll('[data-tab] summary, details').forEach?.(() => {});
  document.querySelectorAll('details').forEach(d => {
    d.ontoggle = async () => {
      if (!d.open) return;
      const id = d.querySelector('[id^=coms-]')?.id.replace('coms-', '');
      if (!id) return;
      const list = await (await fetch(`/api/reportes/${id}/comentarios`)).json();
      document.querySelector(`#coms-${id}`).innerHTML =
        list.map(c => `<li class="bg-slate-100 rounded-lg p-2"><b>${c.nombre || 'Vecino'}:</b> ${c.texto}</li>`).join('') || '<li class="text-slate-400 text-sm">Sin comentarios aún 🤫</li>';
      const form = document.querySelector(`#formCom-${id}`);
      form.onsubmit = async ev => {
        ev.preventDefault();
        const f = ev.target;
        await fetch(`/api/reportes/${id}/comentarios`, { method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nombre: f.nombre.value, texto: f.texto.value }) });
        f.reset(); d.ontoggle();
      };
    };
  });
}

// ---------- Avisos de cambios de estado ----------
async function avisarCambios() {
  if (!auth.token) return;
  try {
    const mine = await (await fetch('/api/mis-reportes', { headers: headersAuth() })).json();
    const prev = JSON.parse(localStorage.getItem('lcalerta_mis_estados') || '{}');
    mine.forEach(r => {
      const old = prev[r.id];
      if (old && old !== r.estado) {
        if (r.estado === 'aprobado') toast(`¡Arreglaron tu ${CAT_LABEL[r.categoria]}!`);
        else if (r.estado === 'recibido') toast(`El ayuntamiento vio tu reporte`);
        else if (r.estado === 'no_aprobado') toast(`Rechazaron tu reporte: ${r.nota || ''}`);
      }
    });
    const nuevo = {}; mine.forEach(r => nuevo[r.id] = r.estado);
    localStorage.setItem('lcalerta_mis_estados', JSON.stringify(nuevo));
  } catch {}
}

// ---------- Ranking de colonias ----------
async function rankingChips() {
  try {
    const cols = await (await fetch('/api/colonias')).json();
    $('#rankingChips').innerHTML = cols.slice(0, 8).map(c =>
      `<span class="badge badge-lg badge-outline whitespace-nowrap">🏟 ${c.colonia} · ${c.abiertos} abiertos</span>`).join('');
    const sel = $('#fColonia'), val = sel.value;
    sel.innerHTML = '<option value="">Colonia</option>' + cols.map(c => `<option value="${c.colonia}">${c.colonia}</option>`).join('');
    sel.value = val;
  } catch {}
}

// ---------- Búsqueda y filtros ----------
let debounceQ;
$('#buscador').addEventListener('input', () => { clearTimeout(debounceQ); debounceQ = setTimeout(() => cargarFeed(true), 300); });
$('#fEstado').addEventListener('change', () => cargarFeed(true));
$('#fColonia').addEventListener('change', () => cargarFeed(true));

// ---------- Mapa ----------
let mapInst = null, layer = null;
function mapa() {
  if (mapInst) { mapInst.invalidateSize(); return; }
  mapInst = L.map('map').setView([17.958, -102.210], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInst);
  layer = L.layerGroup().addTo(mapInst);
  cargarFeed(true);
}
function marcadores(reportes) {
  if (!layer) return; layer.clearLayers();
  reportes.forEach(r => L.marker([r.lat, r.lng], {
    icon: L.divIcon({ className: '', iconSize: [12, 12], html: `<span class="pulse-dot" style="background:${CAT_COLOR[r.categoria] || '#999'}"></span>` }),
  }).bindPopup(`<b>${CAT_LABEL[r.categoria]}</b><br>${ESTADO_EMOJI[r.estado]}<br>${r.colonia || ''}<br>Apoyos: ${r.votos}`).addTo(layer));
}

// ---------- Descargar mapa para usarlo sin señal ----------
// Descarga los tiles del área de Lázaro Cárdenas para que el mapa abra offline.
const LC_BBOX = { sur: 17.88, norte: 18.06, oeste: -102.32, este: -102.06 };
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);

$('#btnTiles').onclick = async () => {
  const btn = $('#btnTiles');
  const zooms = [13, 14, 15];
  let meta = 0;
  for (const z of zooms) {
    for (let x = lon2x(LC_BBOX.oeste, z); x <= lon2x(LC_BBOX.este, z); x++) {
      for (let y = lat2y(LC_BBOX.norte, z); y <= lat2y(LC_BBOX.sur, z); y++) {
        meta++; btn.textContent = `Descargando ${meta} mapas...`;
        try { await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`); } catch {}
      }
    }
  }
  localStorage.setItem('lcalerta_tiles_ok', '1');
  btn.outerHTML = '<p class="text-sm text-emerald-400 text-center py-2"><i data-lucide="check"></i> Mapa descargado. Ya abre sin señal.</p>';
  lucide.createIcons();
};
if (localStorage.getItem('lcalerta_tiles_ok')) {
  $('#btnTiles').outerHTML = '<p class="text-sm text-emerald-400 text-center py-2"><i data-lucide="check"></i> Mapa descargado. Ya abre sin señal.</p>';
}

const dias = iso => { const d = (Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 864e5; return d < 1 ? 'hoy' : `hace ${Math.floor(d)} días`; };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2500); }

// ---------- Orb stack (acciones rápidas) ----------
document.querySelector('#orbCreate').onclick = () => { if (auth.token) abrirModal(); else activarTab('perfil'); };
document.querySelector('#orbExport').onclick = () => {
  if (navigator.share) navigator.share({ title: 'LCAlerta', text: 'Reporta lo que pasa en tu colonia', url: location.origin }).catch(() => {});
  else navigator.clipboard?.writeText(location.origin).then(() => toast('Enlace copiado'));
};
document.querySelector('#orbConfirm').onclick = () => activarTab('perfil');

// ---------- Init ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
syncChip(); renderPendientes(); cargarFeed(true); rankingChips(); setInterval(syncChip, 5000); pintarSesion(); gate(); lucide.createIcons();
