/**
 * ESQUELETO — Armazón de navegación y sincronización offline.
 * La lógica de red y sesión YA está conectada; falta el diseño visual.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Wifi, WifiOff, Newspaper, Bus, User, LogIn, Radio } from 'lucide-react';
import { ProveedorSesion, useSesion } from './sesion.jsx';
import { cola } from './cola.js';
import { Feed } from './pages/Feed.jsx';
import { Perfil } from './pages/Perfil.jsx';
import { Reporte } from './pages/Reporte.jsx';
import { Cargando } from './components/EstadosUI.jsx';

// Estas pantallas se cargan solo cuando se abren: el bundle inicial queda ligero,
// importante en celulares de gama baja y con señal mala.
const Admin = lazy(() => import('./pages/Admin.jsx').then((m) => ({ default: m.Admin })));
const Estadisticas = lazy(() => import('./pages/Estadisticas.jsx').then((m) => ({ default: m.Estadisticas })));
const Mapa = lazy(() => import('./pages/Mapa.jsx').then((m) => ({ default: m.Mapa })));
const Avenida = lazy(() => import('./pages/Avenida.jsx').then((m) => ({ default: m.Avenida })));
const Parada = lazy(() => import('./pages/Parada.jsx').then((m) => ({ default: m.Parada })));
const Chofer = lazy(() => import('./pages/Chofer.jsx').then((m) => ({ default: m.Chofer })));

function IndicadorConexion() {
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    const alCambiar = () => setEnLinea(navigator.onLine);
    window.addEventListener('online', alCambiar);
    window.addEventListener('offline', alCambiar);
    return () => {
      window.removeEventListener('online', alCambiar);
      window.removeEventListener('offline', alCambiar);
    };
  }, []);

  // Al recuperar la señal, subir lo que quedó en la cola del dispositivo.
  useEffect(() => {
    if (enLinea) cola.listar().then((p) => setPendientes(p.length));
  }, [enLinea]);

  /* DISEÑA: chip de estado de conexión.
     Sin señal debe ser tranquilizador, no alarmante: "Sin señal · 2 reportes guardados".
     Es una de las piezas más importantes para una ciudad con mala cobertura. */
  return (
    <div data-testid="indicador-conexion" data-linea={enLinea}>
      {!enLinea ? <WifiOff /> : <Wifi />}
      {!enLinea && pendientes > 0 ? `Sin señal · ${pendientes} guardados` : enLinea ? 'En línea' : 'Sin señal'}
    </div>
  );
}

function Navegacion() {
  const { pathname } = useLocation();
  const { usuario } = useSesion();

  /* DISEÑA: navegación principal.
     Requisito: en móvil la navegación va ABAJO (tipo app), no arriba,
     porque la zona de pulgar nunca llega a la parte superior de la pantalla.
     Usa la clase .safe-bottom para respetar la barra de gestos del iPhone. */
  const pestanas = [
    { a: '/', texto: 'Feed', icono: Newspaper },
    { a: '/avenida', texto: 'Avenida', icono: Bus },
    { a: '/perfil', texto: 'Yo', icono: User },
  ];

  // La pestaña del chofer solo aparece para quienes tienen esa cuenta: el
  // vecino no necesita verla, y el chofer la encuentra sin que nadie le
  // pase un enlace.
  if (usuario?.rol === 'chofer') {
    pestanas.splice(2, 0, { a: '/chofer', texto: 'Mi combi', icono: Radio });
  }

  return (
    <nav data-testid="navegacion" className="safe-bottom">
      {pestanas.map((p) => {
        const Icono = p.icono;
        return (
          <Link key={p.a} to={p.a} aria-current={pathname === p.a ? 'page' : undefined}>
            <Icono />
            {p.texto}
          </Link>
        );
      })}
      {!usuario && (
        /* Sin sesión solo se ve el acceso: la app no se puede usar sin cuenta. */
        <Link to="/perfil" aria-current={pathname === '/perfil' ? 'page' : undefined}>
          <LogIn />
          Entrar
        </Link>
      )}
    </nav>
  );
}

function App() {
  // Escaneando un QR en la calle: se oculta la navegación para no confundir
  // a quien solo quiere saber cuánto falta.
  const soloQR = new URLSearchParams(location.search).get('soloQR') === '1';

  return (
    <ProveedorSesion>
      {!soloQR && (
        <header className="safe-top">
          {/* DISEÑA: barra superior con nombre de la app, indicador de conexión
              y acceso a la cuenta. */}
          <IndicadorConexion />
        </header>
      )}

      <main>
        <Suspense fallback={<Cargando filas={2} />}>
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/reporte/:id" element={<Reporte />} />
            <Route path="/chofer" element={<Chofer />} />
            <Route path="/avenida" element={<Avenida />} />
            <Route path="/mapa" element={<Mapa />} />
            <Route path="/parada/:codigo" element={<Parada />} />
            <Route path="/estadisticas" element={<Estadisticas />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </Suspense>
      </main>

      {!soloQR && <Navegacion />}
    </ProveedorSesion>
  );
}

export default App;