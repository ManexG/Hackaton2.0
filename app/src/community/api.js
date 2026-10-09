import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const base = (import.meta.env.VITE_PUBLIC_API_URL || '/api').replace(/\/$/, '') + '/community';
export const categories = [
  { id: 'alumbrado', name: 'Alumbrado', color: '#a16e12', weight: 2 },
  { id: 'bache', name: 'Bache', color: '#ba5438', weight: 1 },
  { id: 'basura', name: 'Basura', color: '#56823a', weight: 1 },
  { id: 'fuga_agua', name: 'Fuga de agua', color: '#257bae', weight: 3 },
  { id: 'otro', name: 'Otro', color: '#776290', weight: 1 },
];
export const statuses = {
  enviado: 'Enviado',
  recibido: 'En revisión',
  aprobado: 'Resuelto',
  no_aprobado: 'No aplica',
};
export function session() {
  try {
    return (
      JSON.parse(localStorage.getItem('las-palmas.community') || 'null') ||
      JSON.parse(sessionStorage.getItem('cerca.driver') || 'null')
    );
  } catch {
    return null;
  }
}
export function saveSession(value) {
  if (value) localStorage.setItem('las-palmas.community', JSON.stringify(value));
  else localStorage.removeItem('las-palmas.community');
}
export function fingerprint() {
  let value = localStorage.getItem('las-palmas.device');
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem('las-palmas.device', value);
  }
  return value;
}
export async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (session()?.token) headers.set('Authorization', `Bearer ${session().token}`);
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    body = JSON.stringify(body);
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(base + path, {
    ...options,
    headers,
    body,
    signal: options.signal ?? AbortSignal.timeout(20000),
  });
  if (options.download && response.ok) return response.blob();
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || 'No pudimos conectar. Intenta de nuevo.');
    error.status = response.status;
    throw error;
  }
  return data;
}
export const publicUrl = () =>
  (import.meta.env.VITE_PUBLIC_APP_URL || location.origin + '/').replace(/\/$/, '');
export const reportLink = (id) => `${publicUrl()}/#/reporte/${id}`;
export const stopLink = (id) => `${publicUrl()}/?stop=${encodeURIComponent(id)}`;
export function urgency(report) {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(report.created_at.replace(' ', 'T') + 'Z')) / 86400000)
  );
  return report.votos * 2 + days + (categories.find((c) => c.id === report.categoria)?.weight ?? 1);
}
export async function currentPosition() {
  if (Capacitor.isNativePlatform()) {
    let permission = await Geolocation.checkPermissions();
    if (permission.location !== 'granted' && permission.coarseLocation !== 'granted')
      permission = await Geolocation.requestPermissions();
    if (permission.location !== 'granted' && permission.coarseLocation !== 'granted')
      throw new Error('Permite la ubicación para situar el reporte.');
  }
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 5000,
  });
  return [position.coords.latitude, position.coords.longitude];
}
export async function compressPhoto(file) {
  if (!file?.size) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Selecciona una foto JPG, PNG o WebP.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    if (!blob || blob.size > 4_000_000) throw new Error('La foto es demasiado grande. Elige otra.');
    return blob;
  } finally {
    bitmap.close();
  }
}
export const photoUrl = (key) => base + '/foto/' + key;
