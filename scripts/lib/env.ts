// Loads store-credentials.env and exposes the store's API + storefront details.
import { readFileSync } from 'node:fs';

const file = new URL('../../store-credentials.env', import.meta.url);

function load(): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error('Missing store-credentials.env in the project root. Copy store-credentials.example.env and fill it in (see README › Prerequisites).');
  }
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]);
  return Object.fromEntries(entries);
}

export const env = load();

function required(key: string): string {
  const value = env[key];
  if (!value) throw new Error(`store-credentials.env is missing "${key}"`);
  return value;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.bigcommerce.com/stores/${required('store_hash')}${path}`, {
    ...init,
    headers: { 'X-Auth-Token': required('access_token'), Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

let storefront: string | undefined;
/** Storefront origin, e.g. https://supply-yard.mybigcommerce.com. Set `storefront_url` in the env file to override. */
export async function storefrontUrl(): Promise<string> {
  storefront ??= env.storefront_url || (await api<{ secure_url: string }>('/v2/store')).secure_url;
  return storefront.replace(/\/$/, '');
}

export const credentials = { required };
