# Especificación de diseño — LCAlerta

Este documento es para el equipo de frontend. Dice **qué** hay que diseñar y **por qué**,
no cómo se ve. La lógica y los datos ya están conectados.

---

## 1. Qué es la app

Vecinos de colonias no turística de Lázaro Cárdenas reportan problemas urbanos con
**foto y ubicación**. Los reportes se convierten en **datos georreferenciados** que el
municipio prioriza. El diferencial no es que alguien reporte: es que el reporte
**tiene ciclo de vida visible** (`enviado → recibido → aprobado | no aprobado`) y que
el municipio responde con una nota visible para el vecino.

Dos hechos del contexto que mandan en el diseño:

1. **Muchas colonias casi no tienen señal.** La app tiene que ser creíble sin internet.
2. **No todos los usuarios están familiarizados con apps.** Botones grandes, un paso
   a la vez, palabras simples, íconos que acompañen al texto.

---

## 2. Pantallas

| Ruta | Qué es | Quién la ve |
|---|---|---|
| `/` | Feed de reportes | Vecino |
| `/mapa` | Mapa con los reportes | Vecino |
| `/perfil` | Entrar / crear cuenta, y perfil | Vecino |
| `/reporte/:id` | Reporte individual, historial y comentarios | Cualquiera (se comparte por WhatsApp) |
| `/estadisticas` | Gráficas de la ciudad | Jurado, gobierno |
| `/admin` | Panel del gobierno | Funcionario municipal |

---

## 3. Flujos que no pueden romperse

**Vecino nuevo:** crear cuenta → ver feed → reportar (foto + ubicación) → apoyar
el reporte de otro → ver que cambió de estado → recibir avisito.

**Vecino sin señal:** reportar igual (se guarda en el teléfono) → ver el aviso
"Sin señal, guardado" → al recuperar señal, sube solo.

**Gobierno:** entrar al panel → ver la cola ordenada por urgencia → cambiar estado
y dejar nota → exportar los datos.

---

## 4. Estados que TODA pantalla con datos debe manejar

Esto es lo que se olvida y luego rompe el demo:

- **Cargando** — ya existe el componente `Cargando` (esqueletos). Los esqueletos
  deben tener la altura real del contenido, o la página salta al cargar.
- **Vacío** — primera vez en una colonia sin reportes, o usuario sin actividad.
  No es un error: debe **invitar** ("Sé el primero en contarlo").
- **Error de red** — mensaje claro y botón de reintentar.
- **Sin señal** — con datos guardados en el dispositivo. Tranquilizador, no alarmista.
- **Sesión caducada** — volver a pedir el acceso, no romper.

---

## 5. Componentes a diseñar

Ya existen como esqueletos con la estructura y los datos; falta el diseño.

| Componente | En qué aparece | Nota de diseño |
|---|---|---|
| `TarjetaReporte` | Feed, perfil, página pública | Es lo que más se ve. La foto arriba, el estado debe entenderse de un vistazo |
| `BadgeEstado` | Tarjetas, mapa | "Arreglado" tiene que sentirse distinto y positivo |
| `BarraEstado` | Perfil, detalle | Avance de los 3 pasos del ciclo |
| `ChipColonia` | Feed | Colonias con más problemas primero |
| `FormularioReporte` | Feed | Dos pasos: formulario → resumen → confirmar |
| `IndicadorConexion` | Todas | Sin señal + N guardados |

---

## 6. Tokens: usar variables, no colores sueltos

Definidos en `src/index.css` (`:root`). Usarlos mantiene el sistema coherente:

- Superficies: `--color-fondo`, `--color-superficie`, `--color-superficie-alta`
- Marca: `--color-marca` (azul), `--color-exito`, `--color-alerta`, `--color-error`
- Texto: `--color-texto`, `--color-texto-suave`
- Categorías: `--color-cat-alumbrado`, `--color-cat-bache`, `--color-cat-basura`,
  `--color-cat-fuga`, `--color-cat-otro` (deben coincidir con el mapa)
- Forma y movimiento: `--radius-card`, `--duracion-media`, `--curva-suave`

---

## 7. Reglas de interfaz

- **Móvil primero.** El mínimo es 360 px de ancho. Navegación **abajo** (tipo app),
  no arriba: la zona de pulgar no llega a la parte superior.
- **Táctil:** áreas de 44 px mínimo. En móvil no hay hover: nada de información
  que solo aparezca al pasar el cursor.
- **Contraste** suficiente para leer bajo el sol.
- **Texto siempre con ícono cuando sea una acción**, no ícono solo.
- **Nada de jerga** en los textos: "Entrar", no "Autenticarse".
- Se respeta `prefers-reduced-motion` (ya configurado en CSS).

---

## 8. Regla de honestidad con los datos

Este proyecto no puede afirmar cosas que no se midieron. Es la regla que sostiene toda la propuesta y el jurado la va a notar.

**Prohibido mostrar como dato real lo que no lo es:**

| Se puede mostrar | NO se puede presentar como |
|---|---|
| Posición real que reporta un chofer | Tráfico en vivo si no hay chofer reportando |
| Distancia calculada a la combi más cercana | "La combi llega en 4 min" sin decir que es estimado |
| Conteos hechos en campo, con fecha y duración | "Tráfico promedio de la avenida" |
| Una zona piloto declarada | "Toda la ciudad" |

Cuando falte información, **la interfaz debe decirlo**. Ejemplos correctos:

- "Sin combis reportando ahora. No podemos estimar la llegada sin inventar datos."
- "Llega en unos 4 min (estimado con velocidad supuesto de 80 km/h)".
- "3 rutas cargadas; falta el trazo de 1, así que no se dibuja en el mapa."

Esto no resta puntos: **suma**, porque hace que lo demás que sí se midió sea creíble.
Un mapa vacío con el texto "sin combis reportando" vale más que uno lleno de datos
inventados que el jurado detecta.

## 9. Pantallas de movilidad

| Ruta | Qué es |
|---|---|
| `/chofer` | El chofer registra su combi y comparte ubicación cada 10 s |
| `/avenida` | Mapa con las rutas por color, las paradas y las combis en vivo |
| `/parada/:codigo` | Se abre al escanear el QR de la parada. Con `?soloQR=1` sin navegación |

### Decisiones de diseño que ya están tomadas

- **La combi se distingue de los reportes.** Un punto con color y halo, en movimiento.
- **Si no hay combis**, mostrar el texto de "sin combis reportando", no un mapa vacío.
- **El QR es lo que hace que la app sirva en la calle.** La pantalla de parada debe
  entenderse en dos segundos: dónde estoy, qué combi viene, cuánto falta.
- **En modo QR se oculta la navegación**: quien escaneó quiere una respuesta, no un menú.
- **El chofer va conduciendo.** Sus controles deben ser enormes y tolerar toques erróneos.

## 10. Palabras que hay que cuidar

- El botón de apoyar es **"Apoyar"**, no "Votar": el vecino apoya una queja, no vota
  una alternativa.
- El estado aprobado se lee como **"Arreglado"**, no "Aprobado": es lo que el vecino
  quiere ver.
- En el perfil, cuando lo que apoyaste se arregla, se debe notar: ese es el momento
  que hace que la gente vuelva a abrir la app.

## 11. Identidad visual

- **Color de marca:** azul (`--color-marca`). **Éxito:** verde. Ya están definidos.
- **Colores de categoría:** son fijos y coinciden con los del mapa. No cambiarlos.
- No usen emojis como iconos: ya está instalada la librería de iconos Lucide
  (`lucide-react`) y es la que debe usarse.
- **Palabras:** "Apoyar" (no "Votar"), "Arreglado" (no "Aprobado"),
  "LCAlerta" es el nombre provisional.