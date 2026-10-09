import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from './version.js';
const configured = import.meta.env.VITE_PUBLIC_API_URL?.replace(/\/$/, '');
export const apiBase = configured || (Capacitor.isNativePlatform() ? '' : '/api');
export class ConnectionError extends Error {
  status;
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}
export async function api(path, options = {}) {
  if (!apiBase) throw new ConnectionError('El servicio de choferes aún no está conectado.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(apiBase + path, {
      method: options.body === undefined ? 'GET' : 'POST',
      signal: controller.signal,
      headers: {
        'X-App-Version': APP_VERSION,
        'X-App-Platform': Capacitor.isNativePlatform() ? 'native' : 'web',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 426)
      window.dispatchEvent(
        new CustomEvent('las-palmas-update-required', { detail: data?.release })
      );
    if (!response.ok)
      throw new ConnectionError(
        data?.message ?? 'El servicio no está disponible.',
        response.status
      );
    return data;
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError('No pudimos conectar con el servicio. Comprueba tu conexión.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
export function isSnapshot(value) {
  const data = value;
  return Boolean(
    data &&
    Number.isFinite(data.serverTime) &&
    Array.isArray(data.vehicles) &&
    Array.isArray(data.services) &&
    data.services.every(
      (service) => service && typeof service.routeId === 'string' && Array.isArray(service.windows)
    ) &&
    data.vehicles.every(
      (vehicle) =>
        vehicle &&
        typeof vehicle.id === 'string' &&
        typeof vehicle.unit === 'string' &&
        typeof vehicle.routeId === 'string' &&
        Array.isArray(vehicle.point) &&
        vehicle.point.length === 2 &&
        vehicle.point.every(Number.isFinite) &&
        Number.isFinite(vehicle.updatedAt) &&
        Number.isFinite(vehicle.serviceEndAt) &&
        [1, -1].includes(vehicle.direction)
    )
  );
}
