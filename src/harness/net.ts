// Read-only access to checkout data: observes the checkout SDK's Storefront API traffic
// (the SDK uses XHR only, never fetch) and reads the checkout from the public Storefront API.
// Requests pass through unchanged. The XHR tap is installed lazily, the first time something subscribes.

import { API } from './adapter.ts';

export interface ShippingOption {
  id: string;
  description: string;
  cost: number;
  type: string;
  /** Set by the server according to the merchant's "Default shipping option" setting. */
  isRecommended: boolean;
}

export interface Consignment {
  id: string;
  shippingAddress: Record<string, unknown>;
  availableShippingOptions?: ShippingOption[];
  selectedShippingOption?: ShippingOption | null;
}

export interface Checkout {
  id: string;
  consignments: Consignment[];
  customer: { id: number; isGuest: boolean; addresses?: Record<string, unknown>[] };
  [key: string]: unknown;
}

/** GET /api/storefront/checkouts/{id} (public Storefront API, same-origin cookies). */
export async function getCheckout(): Promise<Checkout | null> {
  try {
    const carts = await (await fetch('/api/storefront/carts', { credentials: 'same-origin' })).json();
    const id = carts?.[0]?.id;
    if (!id) return null;
    const res = await fetch(`/api/storefront/checkouts/${id}?include=consignments.availableShippingOptions,customer`, { credentials: 'same-origin' });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

export interface NetRequest {
  method: string;
  url: string;
  requestBody: unknown;
}

export interface NetEvent extends NetRequest {
  status: number;
  ms: number;
  /** Parsed JSON response, or undefined if it wasn't JSON. */
  response: unknown;
}

type Tapped = XMLHttpRequest & { __cwh?: { method: string; url: string } };

const startListeners = new Set<(request: NetRequest) => void>();
const endListeners = new Set<(event: NetEvent) => void>();
let installed = false;

/** Calls fn after every completed Storefront API request whose URL matches `match`. Returns an unsubscribe function. */
export function onRequest(match: RegExp, fn: (event: NetEvent) => void): () => void {
  return subscribe(endListeners, match, fn);
}

/** Calls fn when a matching Storefront API request is sent. Returns an unsubscribe function. */
export function onRequestStart(match: RegExp, fn: (request: NetRequest) => void): () => void {
  return subscribe(startListeners, match, fn);
}

function subscribe<T extends NetRequest>(listeners: Set<(e: T) => void>, match: RegExp, fn: (e: T) => void): () => void {
  install();
  const listener = (e: T) => {
    if (match.test(e.url)) fn(e);
  };
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify<T>(listeners: Set<(e: T) => void>, e: T): void {
  for (const listener of listeners) {
    try {
      listener(e);
    } catch {
      // one listener failing must never affect the SDK or other listeners
    }
  }
}

function install(): void {
  if (installed) return;
  installed = true;
  const proto = XMLHttpRequest.prototype;
  const open = proto.open;
  const send = proto.send;

  proto.open = function (this: Tapped, method: string, url: string | URL) {
    this.__cwh = { method: String(method).toUpperCase(), url: String(url) };
    return open.apply(this, arguments as unknown as Parameters<typeof open>);
  };

  proto.send = function (this: Tapped, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = this.__cwh;
    if (meta && API.storefront.test(meta.url)) {
      const started = performance.now();
      const request: NetRequest = { ...meta, requestBody: parse(typeof body === 'string' ? body : undefined) };
      this.addEventListener('loadend', () => {
        notify(endListeners, {
          ...request,
          status: this.status,
          ms: Math.round(performance.now() - started),
          response: this.responseType === '' || this.responseType === 'text' ? parse(this.responseText) : this.response,
        });
      });
      notify(startListeners, request);
    }
    return send.call(this, body);
  };
}

function parse(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
