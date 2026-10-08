import { Capacitor } from '@capacitor/core';
import type { Driver, FleetSnapshot } from './transit';

const configured = (import.meta.env.VITE_PUBLIC_API_URL as string | undefined)?.replace(/\/$/, '');
export const apiBase = configured || (Capacitor.isNativePlatform() ? '' : '/api');
export class ConnectionError extends Error { constructor(message: string, public status = 0) { super(message); } }
export async function api<T>(path: string, options: { token?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  if (!apiBase) throw new ConnectionError('El servicio de choferes aún no está conectado.');
  const controller = new AbortController();
  const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(apiBase + path, {
      method: options.body === undefined ? 'GET' : 'POST', signal: controller.signal,
      headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ConnectionError(data?.message ?? 'El servicio no está disponible.', response.status);
    return data as T;
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError('No pudimos conectar con el servicio. Comprueba tu conexión.');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export interface DriverSession { token: string; expiresAt: number; driver: Driver }
export function isSnapshot(value: unknown): value is FleetSnapshot {
  const data = value as FleetSnapshot | null;
  return Boolean(data && typeof data.serverTime === 'number' && Array.isArray(data.vehicles) && Array.isArray(data.services));
}
