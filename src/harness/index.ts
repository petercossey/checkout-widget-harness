// Public API for widgets:
//   import { registerWidget } from '../../src/harness/index.ts';
//
// There's one harness runtime per page. If several widget bundles load, the first one
// creates window.cwh and the rest register with it.
// Nothing here may throw into the page: checkout must behave exactly as if we weren't there.

import { API } from './adapter.ts';
import { checkout } from './checkout.ts';
import { createLifecycle, type Widget } from './lifecycle.ts';
import { createLogger, events, setDebug } from './log.ts';
import { readMode } from './mode.ts';
import { onRequest } from './net.ts';

export { setNativeValue } from './fill.ts';
export type { Widget, WidgetContext, WidgetStatus } from './lifecycle.ts';
export type { Address, FillOptions, FillResult } from './fill.ts';
export type { Checkout, Consignment, HiddenShippingParts, SelectOptionResult, ShippingOption } from './checkout.ts';
export type { Slot } from './adapter.ts';

declare const __CWH_VERSION__: string;
const VERSION = typeof __CWH_VERSION__ === 'string' ? __CWH_VERSION__ : 'dev';

export interface Harness {
  version: string;
  mode: string;
  register(widget: Widget): void;
  /** For DevTools and agents: widget states plus recent log events. */
  status(): { version: string; mode: string; widgets: ReturnType<ReturnType<typeof createLifecycle>['status']>; events: typeof events };
  checkout: typeof checkout;
  stop(): void;
}

declare global {
  interface Window {
    cwh?: Harness;
    /** Set by `npm run dev` / `npm run smoke` so the local build wins over the deployed copy. */
    cwhDevOverride?: boolean;
  }
}

export function registerWidget(widget: Widget): void {
  try {
    // Local build injected by dev/smoke: ignore the deployed Script Manager copy of this code.
    if (window.cwhDevOverride && !document.currentScript?.hasAttribute('data-cwh-dev')) {
      return console.info(`[cwh] dev override: skipping deployed ${widget.name}`);
    }
    (window.cwh ?? boot()).register(widget);
  } catch (error) {
    console.error('[cwh] failed to register', widget?.name, error);
  }
}

function boot(): Harness {
  const log = createLogger();
  const mode = readMode();
  setDebug(mode === 'debug');
  const lifecycle = createLifecycle(log);

  const harness: Harness = {
    version: VERSION,
    mode,
    register: (widget) => (mode === 'off' ? log.info(`off: skipping ${widget.name}`) : lifecycle.register(widget)),
    status: () => ({ version: VERSION, mode, widgets: lifecycle.status(), events }),
    checkout,
    stop: () => lifecycle.stop(),
  };
  window.cwh = harness;

  if (mode === 'off') {
    console.info('[cwh] disabled in this browser (?cwh=on to re-enable)');
    return harness;
  }
  if (mode === 'debug') {
    console.info(`[cwh] ${VERSION} debug mode (?cwh=on to turn off)`);
    onRequest(API.storefront, (e) => log.child('net').debug(`${e.method} ${e.url.split('?')[0]} → ${e.status} (${e.ms}ms)`, e));
  }

  const start = () => {
    try {
      lifecycle.start();
    } catch (error) {
      log.error('start failed', error);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  return harness;
}
