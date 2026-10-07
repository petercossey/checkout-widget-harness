// A widget's own smoke step: <widget folder>/smoke.ts, default-exporting a WidgetSmoke.
// `npm run smoke` runs it after the harness checks, once the shopper has left the shipping step and
// come back (the "billing → Edit shipping" path). It should drive the widget the way a shopper would.
import type { Locator, Page } from 'playwright';

export interface WidgetSmokeContext {
  page: Page;
  /** The widget's host element. Query your own UI through this. */
  host: Locator;
  /** The complete guest address checkout has saved when your step starts. */
  address: Record<string, string>;
  /** Waits until checkout has saved a shipping address with these values (case-insensitive), read from the Storefront API. */
  expectSavedAddress(fields: Record<string, string>, timeout?: number): Promise<void>;
}

/** Throw to fail. Return a short detail for the report. */
export type WidgetSmoke = (ctx: WidgetSmokeContext) => Promise<string | void>;
