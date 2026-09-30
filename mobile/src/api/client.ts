import Constants from 'expo-constants';

// EXPO_PUBLIC_API_URL wins; in dev, fall back to the machine running Metro, port 8080.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost ?? 'localhost'}:8080`;

/** Media URLs are API-relative in dev ("/media/...") and absolute on a CDN. */
export const mediaUrl = (u: string) => (u.startsWith('/') ? API_URL + u : u);

export type Page<T> = { items: T[]; next_offset: number | null };
export type CountedPage<T> = Page<T> & { total: number };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

/** JSON request; `token` signs it in. Errors come back as ApiError with the server's message. */
export function request<T>(path: string, { token, ...init }: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return send<T>(path, { ...init, headers });
}

/** A local file for a multipart upload; React Native's FormData takes this in place of a Blob. */
export const file = (uri: string, name: string, type: string) => ({ uri, name, type }) as unknown as Blob;

/** Multipart upload (photos, recordings). */
export function upload<T>(method: 'PUT' | 'POST', path: string, token: string, fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return send<T>(path, { method, headers: { Authorization: `Bearer ${token}` }, body: form });
}
