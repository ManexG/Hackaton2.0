// Página pública de un reporte: /reporte/:id  (timeline + comentarios + voto)
const $ = s => document.querySelector(s);
const CAT_LABEL = { alumbrado: 'Alumbrado', bache: 'Bache', basura: 'Basura', fuga_agua: 'Fuga de agua', otro: 'Otro' };
const CAT_ICON = { alumbrado: 'lightbulb', bache: 'alert-triangle', basura: 'trash-2', fuga_agua: 'droplet', otro: 'help-circle' };
const ESTADO = {
  enviado: '<i data-lucide="send"></i> Enviado',
  recibido: '<i data-lucide="eye"></i> Visto por el ayuntamiento',
  aprobado: '<i data-lucide="check-circle-2"></i> Arreglado',
  no_aprobado: '<i data-lucide="x-circle"></i> No aplica',
};
const fp = localStorage.getItem('lcalerta_fp') ||
  (() => { const v = crypto.randomUUID(); localStorage.setItem('lcalerta_fp', v); return v; })();

const id = new URLSearchParams(location.search).get('id') ||
            (location.pathname.match(/\/reporte\/(\d+)/) || [])[1];
const fecha = iso => new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

(async () => {
  if (!id) return $('#caja').innerHTML = '<p>Reporte no válido.</p>';
  let r;
  try {
    const res = await fetch(`/api/reportes/${id}`);
    r = await res.json();
    if (!res.ok) throw new Error(r.error);
  } catch {
    $('#caja').innerHTML = '<p class="text-slate-400">No encontramos este reporte.</p>';
    return;
  }

  const [historial, comentarios] = await Promise.all([
    fetch(`/api/reportes/${id}/historial`).then(x => x.json()).catch(() => []),
    fetch(`/api/reportes/${id}/comentarios`).then(x => x.json()).catch(() => []),
  ]);

  $('#caja').innerHTML = `
    <article class="card p-4">
      <div class="flex items-center gap-2 flex-wrap">
        <i data-lucide="${CAT_ICON[r.categoria] || 'help-circle'}"></i>
        <h1 class="font-black text-xl m-0">${CAT_LABEL[r.categoria] || r.categoria}</h1>
        <span class="badge estado ${r.estado}">${ESTADO[r.estado] || r.estado}</span>
      </div>
      <p class="text-slate-400 text-sm m-0">${r.user_nombre ? 'Reportado por ' + r.user_nombre + ' · ' : ''}${r.colonia || 'Sin colonia'} · ${fecha(r.created_at)}</p>
      ${r.descripcion ? `<p class="text-lg">${r.descripcion}</p>` : ''}
      ${r.foto_key ? `<img src="/api/foto/${r.foto_key}" class="rounded-xl w-full mt-2" alt="Foto del reporte">` : ''}
      ${r.nota ? `<p class="bg-blue-950/50 rounded-lg p-3"><i data-lucide="landmark"></i> ${r.nota}</p>` : ''}
      <button class="btn btn-outline btn-primary w-full mt-3" id="btnVotar"><i data-lucide="thumbs-up"></i> Apoyar (${r.votos})</button>
      <p id="msgVoto" class="msg"></p>
    </article>

    <section class="card p-4 mt-4">
      <h2 class="font-bold"><i data-lucide="history"></i> Historial</h2>
      <ol class="timeline-list mt-2">
        <li class="flex gap-3 pb-3 border-l-2 border-blue-500 pl-3 ml-2">
          <div><b>Reportado por un vecino</b><p class="text-slate-400 text-sm m-0">${fecha(r.created_at)}</p></div>
        </li>
        ${historial.map(h => `
          <li class="flex gap-3 pb-3 border-l-2 border-white/20 pl-3 ml-2">
            <div><b>${ESTADO[h.estado] || h.estado}</b>
              <p class="text-slate-400 text-sm m-0">${fecha(h.created_at)}${h.nota ? ' · ' + h.nota : ''}</p></div>
          </li>`).join('')}
      </ol>
    </section>

    <section class="card p-4 mt-4">
      <h2 class="font-bold"><i data-lucide="message-circle"></i> Comentarios (${comentarios.length})</h2>
      <ul class="space-y-2 my-3">
        ${comentarios.map(c => `<li class="bg-slate-900 rounded-lg p-2"><b>${c.nombre || 'Vecino'}:</b> ${c.texto}</li>`).join('') || '<li class="text-slate-400">Sin comentarios todavía.</li>'}
      </ul>
      <form id="formCom" class="space-y-2">
        <input name="nombre" placeholder="Tu nombre" class="input input-bordered w-full">
        <input name="texto" placeholder="Escribe un comentario…" class="input input-bordered w-full">
        <button class="btn btn-primary w-full">Comentar</button>
      </form>
    </section>`;

  $('#btnVotar').onclick = async () => {
    const res = await fetch(`/api/reportes/${id}/votar`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint: fp }) });
    $('#msgVoto').textContent = res.status === 409 ? 'Ya apoyaste este reporte'
      : res.ok ? '¡Gracias por apoyar!' : 'No pudimos registrar tu apoyo';
    if (res.ok) $('#btnVotar').innerHTML = `<i data-lucide="thumbs-up"></i> Apoyado`;
    lucide.createIcons();
  };

  $('#formCom').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target;
    await fetch(`/api/reportes/${id}/comentarios`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: f.nombre.value, texto: f.texto.value }) });
    location.reload();
  };

  lucide.createIcons();
})();