/**
 * ESQUELETO — estructura y datos listos, el diseño lo hace el equipo.
 * Busca los comentarios `DISEÑA:`.
 */
import { Send, Eye, CheckCircle2, XCircle } from 'lucide-react';
import { ESTADOS } from '../api.js';

const estado = (clave) => ESTADOS.find((e) => e.clave === clave);

// Un ícono por estado: más rápido de leer que un texto suelto.
const ICONO = { enviado: Send, recibido: Eye, aprobado: CheckCircle2, no_aprobado: XCircle };

/** Etiqueta compacta del estado (Feed, tarjeta, mapa). */
export function BadgeEstado({ estado: clave }) {
  const e = estado(clave);
  const Icono = ICONO[clave];
  /* DISEÑA: según el estado debe entenderse de un vistazo:
     enviado = recién puesto, recibido = el ayuntamiento lo vio,
     aprobado = ya se arregló, no_aprobado = no se va a atender.
     El verde de "aprobado" es el que cierra el ciclo: debe destacarse. */
  return (
    <span className="badge" data-estado={clave}>
      {Icono && <Icono />}
      {e?.etiqueta ?? clave}
    </span>
  );
}

/** Barra de progreso del estado. Útil en "Mis reportes" y en el detalle. */
export function BarraEstado({ estado: clave }) {
  const pasos = ['enviado', 'recibido', 'aprobado'];
  const actual = pasos.indexOf(clave);
  const rechazado = clave === 'no_aprobado';
  /* DISEÑA: avance de los 3 pasos. Si está en "no_aprobado", mostrar el motivo (nota). */
  return (
    <ol data-estado={clave} data-rechazado={rechazado}>
      {pasos.map((p, i) => {
        const Icono = ICONO[p];
        return (
          <li key={p} data-hecho={!rechazado && i <= actual}>
            {Icono && <Icono />} {estado(p).etiqueta}
          </li>
        );
      })}
    </ol>
  );
}

/** Chip de colonia con el número de reportes abiertos. */
export function ChipColonia({ colonia, abiertos, diasSinAtender, alFiltrar }) {
  /* DISEÑA: chip seleccionable que filtra el feed por colonia.
     Muestra también los días sin atender si viene el dato. */
  const dias = Number(diasSinAtender) || 0;
  return (
    <button className="badge badge-lg badge-outline whitespace-nowrap" onClick={() => alFiltrar(colonia)}>
      {colonia} · {abiertos} abiertos
      {dias > 0 && ` · ${dias} d sin atender`}
    </button>
  );
}