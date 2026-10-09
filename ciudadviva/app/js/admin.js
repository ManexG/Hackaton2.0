// LCAlerta — panel municipio
const $ = s => document.querySelector(s);
const PESO = { alumbrado: 2, bache: 1, basura: 1, fuga_agua: 3, otro: 1 };
const getKey = () => localStorage.getItem('adminKey') || '';
$('#btnKey').onclick = () => { const k = prompt('Clave de admin:', getKey()); if (k) { localStorage.setItem('adminKey', k); load(); } };

const diasNec = iso => Math.floor((Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 864e5);
const urgencia = r => r.votos * 2 + diasNec(r.created_at) + (PESO[r.categoria] || 1);

async function load() {
  const params = new URLSearchParams();
  if ($('#fEstado').value) params.set('estado', $('#fEstado').value);
  if ($('#fCat').value) params.set('categoria', $('#fCat').value);
  const res = await fetch('/api/reportes?' + params);
  let list = await res.json();
  list.sort((a, b) => urgencia(b) - urgencia(a));  // cola por urgencia
  $('#tbl tbody').innerHTML = list.map(r => `<tr>
    <td>${r.id}</td><td>${r.categoria}</td><td>${r.colonia || ''}</td>
    <td><span class="estado ${r.estado}">${r.estado.replace('_',' ')}</span></td>
    <td>${r.votos}</td><td>${diasNec(r.created_at)}</td><td><b>${urgencia(r)}</b></td>
    <td><input data-nota="${r.id}" value="${r.nota || ''}" size="18"></td>
    <td>
      <select data-est="${r.id}">
        ${['enviado','recibido','aprobado','no_aprobado'].map(e => `<option ${e===r.estado?'selected':''}>${e}</option>`).join('')}
      </select>
      <button data-save="${r.id}">✔</button></td></tr>`).join('');
  document.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const id = b.dataset.save;
    const nota = document.querySelector(`[data-nota="${id}"]`).value;
    const estado = document.querySelector(`[data-est="${id}"]`).value;
    const r = await fetch(`/api/reportes/${id}/estado`, { method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-key': getKey() },
      body: JSON.stringify({ estado, nota }) });
    if (!r.ok) alert('Clave incorrecta o error'); load();
  });
  const rank = await (await fetch('/api/colonias')).json();
  $('#ranking').innerHTML = rank.map(c => `<li>${c.colonia} — ${c.abiertos} abiertos / ${c.total} totales, 👍 ${c.votos}, ⏱ máx ${c.dias_max_abiertos ?? 0} días sin atender</li>`).join('');
  const porDia = {};
  list.forEach(r => { const d = r.created_at.slice(0, 10); porDia[d] = (porDia[d] || 0) + 1; });
  const max = Math.max(1, ...Object.values(porDia));
  $('#actividad').innerHTML = Object.keys(porDia).sort().map(d =>
    `<div style="display:flex;align-items:center;gap:.4rem;font-size:.75rem"><span style="width:5.5rem">${d}</span>` +
    `<div style="background:#2563eb;height:.8rem;border-radius:.3rem;width:${(porDia[d]/max*60).toFixed(0)}%"></div><b>${porDia[d]}</b></div>`).join('');
  $('#expCsv').href = `/api/export?format=csv&key=${encodeURIComponent(getKey())}`;
  $('#expGeo').href = `/api/export?format=geojson&key=${encodeURIComponent(getKey())}`;
}
$('#fEstado').onchange = $('#fCat').onchange = load;
document.querySelector('#orbCsv').onclick = () => document.querySelector('#expCsv').click();
document.querySelector('#orbGeo').onclick = () => document.querySelector('#expGeo').click();
document.querySelector('#orbRefresh').onclick = () => { load(); };
load(); setInterval(load, 15000);
