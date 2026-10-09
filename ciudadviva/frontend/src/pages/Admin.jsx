/**
 * ESQUELETO — Panel del gobierno (/admin).
 *
 * Es la pantalla que ve el funcionario: cola ordenada por urgencia, cambio de
 * estado con nota, ranking de colonias y exportación.
 *
 * AHORA INCLUYE TAMBIÉN la parte de movilidad: aquí se cargan las rutas y paradas
 * desde un archivo, sin escribirlas a mano. Es lo que alimentará el mapa de la
 * avenida con las combis en vivo.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Key, Upload, Printer, Download, Route } from 'lucide-react';
import { api, ESTADOS, urgencia } from '../api.js';
import { Cargando, ErrorBox } from '../components/EstadosUI.jsx';
import { qrsDeParadas, usarQr } from '../components/Qr.jsx';

/**
 * Lista de paradas con su código QR listo para imprimir.
 * El equipo pega estas etiquetas en la calle; al escanearse, el celular abre
 * la app centrada en esa parada.
 */
function QrListas() {
  const [paradas, setParadas] = useState([]);
  const [imprimiendo, setImprimiendo] = useState(null);
  const svgs = usarQr(paradas);

  useEffect(() => {
    qrsDeParadas().then(setParadas).catch(() => {});
  }, []);

  // Al imprimir solo debe salir la etiqueta elegida. La hoja de estilos usa la
  // clase `imprimir-una` en el body para esconder las demás; sin ella se
  // imprimirían todas, porque el CSS de impresión muestra cada .qr-actual.
  const imprimirUna = (codigo) => {
    setImprimiendo(codigo);
    document.body.classList.add('imprimir-una');
    const limpiar = () => {
      document.body.classList.remove('imprimir-una');
      setImprimiendo(null);
      window.removeEventListener('afterprint', limpiar);
    };
    window.addEventListener('afterprint', limpiar);
    window.print();
    // Respaldo por si el navegador no dispara afterprint (ocurre en algunos).
    setTimeout(limpiar, 1500);
  };

  if (paradas.length === 0) return null;

  return (
    <div data-testid="qr-listas">
      <h3 className="text-lg font-bold">Códigos QR de paradas ({paradas.length})</h3>
      <p className="text-sm opacity-70">
        Cada etiqueta lleva el nombre de la parada, el código y este QR. Al escanearse abre la app
        centrada en esa parada. <strong>Imprime una a una</strong> y revisa el dominio en la hoja
        antes de pegar el papel en la calle.
      </p>
      <ul>
          {paradas.map((p) => (
<li key={p.id}>
              <strong>{p.nombre}</strong>{' '}
              <small className="opacity-60">{p.qr}</small>
              {svgs[p.qr] && (
                <div
                  className={`qr-actual${imprimiendo === p.qr ? ' qr-actual--unica' : ''}`}
                  data-nombre={p.nombre}
                  data-codigo={p.qr}
                  dangerouslySetInnerHTML={{ __html: svgs[p.qr] }}
                />
              )}
              {/* Visible en pantalla para verificar el destino antes de imprimir. */}
              {svgs[p.qr] && (
                <p className="text-xs opacity-60 break-all">{api.enlaceParada(p.qr)}</p>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => imprimirUna(p.qr)}>
                <Printer /> Imprimir esta
              </button>
            </li>
        ))}
      </ul>
    </div>
  );
}

export function Admin() {
  const [clave, setClave] = useState(() => localStorage.getItem('adminKey') || '');
  const [reportes, setReportes] = useState([]);
  const [colonias, setColonias] = useState([]);
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(null);
  const [nota, setNota] = useState('');

  // --- movilidad: carga de rutas y paradas ---
  const [pestana, setPestana] = useState('reportes');
  const [qrDe, setQrDe] = useState(null);
  const [rutas, setRutas] = useState([]);
  const archivo = useRef(null);
  const [resultadoCarga, setResultadoCarga] = useState(null);
  const [trazando, setTrazando] = useState(null);
  const [trazado, setTrazado] = useState(null);

  const cargar = async () => {
    setError(null);
    try {
      const [r, c] = await Promise.all([api.reportes({ limit: 200 }), api.colonias()]);
      // El gobierno no quiere un mapa: quiere una lista ordenada por urgencia.
      setReportes([...r].sort((a, b) => urgencia(b) - urgencia(a)));
      setColonias(c);
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    cargar();
    api.rutas().then(setRutas).catch(() => {});
    const t = setInterval(cargar, 30000);
    return () => clearInterval(t);
  }, []);

  const guardarEstado = async (reporte, estado) => {
    try {
      await api.adminCambiarEstado(reporte.id, estado, nota, clave);
      setEditando(null);
      setNota('');
      await cargar();
    } catch (e) {
      setError(e);
    }
  };

  /**
   * Cargar rutas y paradas desde un archivo JSON.
   * El formato está documentado en scripts/datos/LEEME.md.
   * Valores de ejemplo: scripts/datos/EJEMPLO-centro.json
   */
  const cargarArchivo = async () => {
    const f = archivo.current?.files?.[0];
    if (!f) return;
    setResultadoCarga(null);
    try {
      const datos = JSON.parse(await f.text());
      const resumen = [];

      if (datos.zona) {
        const z = await api.crearZona(datos.zona, clave);
        resumen.push(`zona "${datos.zona.nombre}" (id ${z.id})`);
      }
      for (const ruta of datos.rutas ?? []) {
        const { paradas, ...rutaSinParadas } = ruta;
        const creada = await api.crearRuta(rutaSinParadas, clave);
        resumen.push(`ruta "${ruta.nombre}" (id ${creada.id})`);
        if (Array.isArray(paradas) && paradas.length) {
          const r = await api.crearParadas(creada.id, paradas, clave);
          resumen.push(`  ${r.guardadas} paradas`);
        }
      }
      setResultadoCarga(resumen);
      api.rutas().then(setRutas).catch(() => {});
    } catch (e) {
      setError(e);
    }
  };

  /** Recalcula el trazo por calles reales de una ruta. */
  const trazar = async (rutaId) => {
    setTrazando(rutaId);
    setTrazado(null);
    setError(null);
    try {
      const detalle = await api.trazarRuta(rutaId, clave);
      setTrazado({ id: rutaId, detalle });
      api.rutas().then(setRutas).catch(() => {});
    } catch (e) {
      setError(e);
    } finally {
      setTrazando(null);
    }
  };

  const estadisticas = useMemo(
    () => ({ total: reportes.length, abiertos: reportes.filter((r) => r.estado !== 'aprobado').length }),
    [reportes]
  );

  return (
    <section data-testid="admin">
      {/* DISEÑA: identificación del panel y clave.
          La clave protege las ACCIONES; la página además debería quedar
          restringida con Cloudflare Zero Trust (ver README). */}
      <div>
            <Key size={16} />
            <input
              className="input input-bordered w-full"
              type="password"
              placeholder="Clave del ayuntamiento"
              value={clave}
              onChange={(e) => {
                setClave(e.target.value);
                localStorage.setItem('adminKey', e.target.value);
              }}
            />
          </div>

      {/* DOS PARTES DEL PANEL:
          1. Reportes ciudadanos (cola por urgencia)
          2. Movilidad (cargar rutas y paradas desde archivo) */}
<nav className="flex gap-2 mb-3">
          <button className={pestana === 'reportes' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => setPestana('reportes')}>
            Reportes ciudadanos
          </button>
          <button className={pestana === 'movilidad' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => setPestana('movilidad')}>
            Rutas y paradas
          </button>
        </nav>

      {error && <ErrorBox error={error} alReintentar={cargar} />}

      {pestana === 'movilidad' && (
        <section data-testid="admin-movilidad">
          {/* DISEÑA: subir un archivo .json con rutas y paradas.
              Ejemplo listo en scripts/datos/zona-centro.json.
              Muestra el resumen de lo que se cargó. */}
          /* DISEÑA: subir un archivo .json con rutas y paradas.
              Ejemplo listo en scripts/datos/zona-centro.json.
              Muestra el resumen de lo que se cargó. */}
          <h2 className="text-xl font-bold">Rutas y paradas de combi</h2>
          <label className="btn btn-outline btn-sm my-2">
            <Upload /> Elegir archivo JSON
            <input type="file" accept="application/json" className="hidden" ref={archivo} />
          </label>
          <button className="btn btn-primary" onClick={cargarArchivo}>Cargar datos</button>
          {resultadoCarga && (
            <ul>
              {resultadoCarga.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          <h3 className="text-lg font-bold">Rutas cargadas ({rutas.length})</h3>
          <ul data-testid="lista-rutas-admin">
          {rutas.map((r) => (
            <li key={r.id}>
              <span className="inline-block w-3 h-3 rounded-full align-middle" style={{ background: r.color }} />
              <strong> {r.nombre} </strong>
              {r.trazo ? ' · trazo guardado' : ' · SIN TRAZO: no se dibuja en el mapa'}
              <div className="flex gap-2 flex-wrap items-center mt-1">
                <button
                  className="btn btn-outline btn-sm"
                  disabled={trazando === r.id}
                  onClick={() => trazar(r.id)}
                >
                  <Route size={14} />
                  {trazando === r.id ? 'Ajustando a calles...' : 'Ajustar a calles'}
                </button>
              </div>
              {trazado === r.id && (
                <div className="text-xs mt-1">
                  <p>
                    Trazo de <strong>{trazado.detalle.puntos}</strong> puntos ·{' '}
                    <strong>{trazado.detalle.distancia_m.toLocaleString('es-MX')}</strong> m por calles
                  </p>
                  <ul>
                    {trazado.detalle.ajustes.map((a) => (
                      <li key={a.id}>
                        {a.nombre}: movida {a.ajuste_m} m para caer en la calle
                      </li>
                    ))}
                  </ul>
                  {trazado.detalle.advertencia && (
                    <p className="font-bold">{trazado.detalle.advertencia}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

          {/* Códigos QR de las paradas: el equipo los imprime y los pega en la calle.
              El QR apunta a /parada/<código>?soloQR=1 */}
          <QrListas />
          </section>
        )}

      {pestana === 'reportes' && (
        <>
          {/* DISEÑA: dos cifras arriba — total de reportes y cuántos siguen abiertos.
              Es lo primero que un funcionario quiere saber. */}
          <p>
            {estadisticas.total} reportes · {estadisticas.abiertos} abiertos
          </p>

          {reportes.length === 0 && !error ? (
            <Cargando />
          ) : (
            /* DISEÑA: tabla o tarjetas ordenadas por urgencia (ya viene ordenada).
               Columnas útiles: categoría, colonia, estado, apoyos, días sin resolver,
               urgencia, y ACCIÓN para cambiar estado con nota. */
            <table>
              <thead>
                <tr>
                  <th>Reporte</th>
                  <th>Colonia</th>
                  <th>Estado</th>
                  <th>Apoyos</th>
                  <th>Días</th>
                  <th>Urgencia</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {reportes.map((r) => (
                  <tr key={r.id} data-estado={r.estado}>
                    <td>{r.categoria}</td>
                    <td>{r.colonia}</td>
                    <td>{r.estado}</td>
                    <td>{r.votos}</td>
                    <td>{Math.floor((Date.now() - new Date(String(r.created_at).replace(' ', 'T') + 'Z')) / 86400000)}</td>
                    <td>{urgencia(r)}</td>
                    <td>
                      {editando === r.id ? (
                        <>
                          <select value={r.estado} onChange={(e) => guardarEstado({ ...r, estado: e.target.value }, e.target.value)}>
                            {ESTADOS.map((s) => (
                              <option key={s.clave} value={s.clave}>{s.etiqueta}</option>
                            ))}
                          </select>
                          <input placeholder="Nota para el vecino" value={nota} onChange={(e) => setNota(e.target.value)} />
                          <button onClick={() => guardarEstado(r, r.estado)}>Guardar</button>
                        </>
                      ) : (
                        <button onClick={() => setEditando(r.id)}>Cambiar estado</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* DISEÑA: "Mapa del silencio" — colonias con más días sin resolver.
              Es el dato que justifica una intervención. */}
          <section data-testid="ranking">
            <h2>Colonias con más tiempo sin atender</h2>
            <ol>
              {colonias.map((c) => (
                <li key={c.colonia}>
                  {c.colonia} — {c.abiertos} abiertos, {c.dias_max_abiertos ?? 0} días sin atender
                </li>
              ))}
            </ol>
          </section>

          {/* Exportar: el funcionario se lleva los datos a su escritorio. */}
          <a href={api.adminExportUrl('csv', clave)} download="lcalerta_reportes.csv">
            <Download /> CSV
          </a>
          <a href={api.adminExportUrl('geojson', clave)} download="lcalerta_reportes.geojson">
            <Download /> GeoJSON
          </a>
        </>
      )}
    </section>
  );
}