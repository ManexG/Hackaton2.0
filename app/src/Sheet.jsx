import { useRef } from 'react';
import { Icon } from './Icon.jsx';
export const SHEET_PEEK = 0.5;
export const SHEET_HALF = 0.6;
export const sheetHeights = () => ({
  peek: Math.round(window.innerHeight * SHEET_PEEK),
  half: Math.round(window.innerHeight * SHEET_HALF),
});
export const NAV_ITEMS = [
  ['plan', 'Buscar viaje', 'search'],
  ['routes', 'Rutas', 'bus-front'],
  ['stops', 'Paradas', 'map-pin'],
];
export function BottomNav({ current, onSelect }) {
  return (
    <nav className="bottom-nav" aria-label="Secciones de la aplicación">
      {NAV_ITEMS.map(([id, label, icon]) => (
        <button
          key={id}
          data-section={id}
          aria-pressed={current === id}
          className={current === id ? 'active' : ''}
          onClick={() => onSelect(id)}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
// Grab handle and title bar. Dragging resizes the sheet up to half of the screen; releasing near
// the bottom closes it so the map is always one gesture away.
export function SheetHeader({ title, onDrag, onRelease, onToggle, onClose }) {
  const start = useRef(null);
  function down(event) {
    start.current = {
      y: event.clientY,
      moved: false,
      height: event.currentTarget.parentElement.offsetHeight,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    if (!start.current) return;
    const delta = start.current.y - event.clientY;
    if (Math.abs(delta) > 6) start.current.moved = true;
    if (start.current.moved) onDrag(start.current.height + delta);
  }
  function up(event) {
    if (!start.current) return;
    const { moved, height, y } = start.current;
    start.current = null;
    if (moved) onRelease(height + (y - event.clientY));
    else onToggle();
  }
  return (
    <div className="sheet-header">
      <button
        type="button"
        className="sheet-handle"
        aria-label="Arrastra para cambiar el tamaño del panel, o pulsa para ampliarlo"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => (start.current = null)}
        onClick={(event) => event.detail === 0 && onToggle()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') onRelease(window.innerHeight);
          else if (event.key === 'ArrowDown') onRelease(0);
          else return;
          event.preventDefault();
        }}
      >
        <span />
      </button>
      <div className="sheet-title">
        <strong>{title}</strong>
        <button
          type="button"
          className="sheet-close"
          aria-label="Cerrar panel y ver el mapa"
          onClick={onClose}
        >
          <Icon name="x" />
          <span>Ver mapa</span>
        </button>
      </div>
    </div>
  );
}
