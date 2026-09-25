// One MutationObserver drives every widget. Each change to the checkout DOM runs reconcile(),
// which is idempotent: it mounts widgets whose slot has appeared and unmounts widgets whose
// host was removed. Checkout re-renders never create duplicates.

import { SELECTORS, slotAnchor, type Slot } from './adapter.ts';
import { checkout, type CheckoutApi } from './checkout.ts';
import { createLogger, type Logger } from './log.ts';

export interface WidgetContext {
  /** An empty element owned by the widget, inserted at the slot. */
  host: HTMLElement;
  checkout: CheckoutApi;
  log: Logger;
  /** Aborted on unmount. Pass it to addEventListener({ signal }) for automatic cleanup. */
  signal: AbortSignal;
}

export interface Widget {
  /** Unique, kebab-case. Used for the host's data-cwh-widget attribute and the Script Manager name. */
  name: string;
  slot: Slot;
  /** Render into ctx.host. Optionally return a cleanup function. Runs again every time the slot reappears. */
  mount(ctx: WidgetContext): void | (() => void);
}

export interface WidgetStatus {
  name: string;
  slot: Slot;
  state: 'waiting' | 'mounted' | 'failed';
  mounts: number;
  failures: number;
}

interface Instance extends WidgetStatus {
  widget: Widget;
  log: Logger;
  host?: HTMLElement;
  cleanup?: () => void;
  abort?: AbortController;
}

const MAX_FAILURES = 3;

export function createLifecycle(log: Logger) {
  const instances: Instance[] = [];
  let observer: MutationObserver | undefined;

  function reconcile(): void {
    for (const inst of instances) {
      if (inst.state === 'failed') continue;
      const anchor = slotAnchor(inst.widget.slot);
      if (inst.host && (!inst.host.isConnected || !anchor || inst.host.parentElement !== anchor.parent)) unmount(inst);
      if (!inst.host && anchor) mount(inst, anchor);
    }
  }

  function mount(inst: Instance, anchor: { parent: HTMLElement; before: Node | null }): void {
    // Remove any stray copy, e.g. if the script was included twice.
    document.querySelectorAll(`[data-cwh-widget="${inst.name}"]`).forEach((el) => el.remove());
    const host = document.createElement('div');
    host.dataset.cwhWidget = inst.name;
    const abort = new AbortController();
    try {
      anchor.parent.insertBefore(host, anchor.before);
      const cleanup = inst.widget.mount({ host, checkout, log: inst.log, signal: abort.signal });
      Object.assign(inst, { host, abort, cleanup: cleanup || undefined, state: 'mounted', mounts: inst.mounts + 1 });
      inst.log.info('mounted', `#${inst.mounts}`);
    } catch (error) {
      abort.abort();
      host.remove();
      fail(inst, error);
    }
  }

  function unmount(inst: Instance): void {
    inst.abort?.abort();
    try {
      inst.cleanup?.();
    } catch (error) {
      inst.log.warn('cleanup threw', error);
    }
    inst.host?.remove();
    Object.assign(inst, { host: undefined, cleanup: undefined, abort: undefined, state: inst.state === 'failed' ? 'failed' : 'waiting' });
    inst.log.info('unmounted');
  }

  function fail(inst: Instance, error: unknown): void {
    inst.failures += 1;
    inst.log.error('mount failed', error);
    if (inst.failures >= MAX_FAILURES) {
      inst.state = 'failed';
      inst.log.error(`disabled after ${MAX_FAILURES} failures`);
    }
  }

  return {
    register(widget: Widget): void {
      if (instances.some((i) => i.name === widget.name)) return log.warn(`widget "${widget.name}" already registered`);
      instances.push({ widget, name: widget.name, slot: widget.slot, state: 'waiting', mounts: 0, failures: 0, log: createLogger(widget.name) });
      reconcile();
    },
    start(): void {
      if (observer) return;
      const root = document.querySelector(SELECTORS.app) ?? document.body;
      observer = new MutationObserver(() => {
        try {
          reconcile();
        } catch (error) {
          log.error('reconcile failed', error);
        }
      });
      // childList covers step changes and re-renders; style covers the offscreen loading skeleton.
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
      reconcile();
    },
    stop(): void {
      observer?.disconnect();
      observer = undefined;
      instances.forEach(unmount);
    },
    status(): WidgetStatus[] {
      return instances.map(({ name, slot, state, mounts, failures }) => ({ name, slot, state, mounts, failures }));
    },
  };
}
