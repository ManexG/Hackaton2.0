/**
 * Qr.jsx — generación de los códigos QR de las paradas.
 *
 * Se separa en su propio archivo a propósito: si la generación de QR falla,
 * el resto de la app sigue funcionando. Las etiquetas son importantes, pero
 * no deben tumbar el panel de administración.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api.js';

/** Trae todas las paradas que tienen código QR, de todas las rutas. */
export async function qrsDeParadas() {
  const rutas = await api.rutas();
  const grupos = await Promise.all(rutas.map((r) => api.paradasDeRuta(r.id)));
  return grupos.flat().filter((p) => p.qr);
}

/**
 * Genera el SVG de cada código. El QR apunta a /parada/<código>?soloQR=1,
 * que es lo que va impreso en la calle.
 */
export function usarQr(paradas) {
  const [svgs, setSvgs] = useState({});

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const nuevos = {};
      for (const p of paradas) {
        try {
          nuevos[p.qr] = await QRCode.toString(api.enlaceParada(p.qr), {
            type: 'svg',
            margin: 1,
            width: 240,
            color: { dark: '#294331', light: '#ffffff' },
          });
        } catch {
          // Una etiqueta que falla no debe impedir imprimir las demás.
        }
      }
      if (!cancelado) setSvgs(nuevos);
    })();
    return () => {
      cancelado = true;
    };
  }, [paradas]);

  return svgs;
}