// THE ONLY FILE THAT KNOWS BIGCOMMERCE CHECKOUT MARKUP.
// Targets: stock Optimized One-Page Checkout, checkout-js 1.906.x (verified 2026-09-25).
// When BigCommerce changes the DOM, fix it here. See docs/checkout-internals.md §2–4a for the evidence.
//
// Rules:
// - Prefer hooks BigCommerce's own e2e tests use: ids, name="shippingAddress.*", data-test.
// - Never depend on styling classes (optimizedCheckout-*) or DOM depth.
// - Every lookup returns null when not found. Callers must fail closed.

import { waitFor } from './dom.ts';

export const SELECTORS = {
  app: '#checkout-app',
  shippingStepActive: 'li.checkout-step--shipping.checkout-step--current',
  shippingAddress: '#checkoutShippingAddress',
  // The form renders offscreen, then resets, while loading. Don't touch it until these are gone.
  // Once ready, .loading-skeleton stays in the DOM with style="" (verified). Only an absolute position means offscreen.
  loadingSkeleton: '.address-form-skeleton',
  offscreenSkeleton: '.loading-skeleton[style*="absolute"]',
  // Signed-in shoppers with saved addresses
  addressToggle: '#addressToggle',
  addNewAddress: '[data-test="add-new-address"]',
  shippingOptions: '#checkout-shipping-options',
} as const;

// Storefront API paths the checkout SDK calls (XHR). Match on suffix: subfolder stores prefix them.
export const API = {
  storefront: /\/api\/storefront\//,
  consignments: /\/api\/storefront\/checkouts\/[^/?]+\/consignments/,
} as const;

export type Slot = 'shipping.address.before' | 'shipping.address.after';

/** The shipping address fieldset, only when the shipping step is active and fully initialised. */
export function shippingAddressRoot(): HTMLElement | null {
  const step = document.querySelector(SELECTORS.shippingStepActive);
  const root = step?.querySelector<HTMLElement>(SELECTORS.shippingAddress);
  if (!step || !root) return null;
  if (step.querySelector(SELECTORS.loadingSkeleton) || root.closest(SELECTORS.offscreenSkeleton)) return null;
  return root;
}

/** Where a widget host is inserted. It's a sibling of the fieldset, which survives in-form re-renders. */
export function slotAnchor(slot: Slot): { parent: HTMLElement; before: Node | null } | null {
  const root = shippingAddressRoot();
  const parent = root?.parentElement;
  if (!root || !parent) return null;
  return { parent, before: slot === 'shipping.address.before' ? root : root.nextSibling };
}

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** A shipping address field by SDK address key, e.g. 'firstName' or 'customFields.field_25'. */
export function shippingField(key: string): FieldElement | null {
  const root = shippingAddressRoot();
  if (!root) return null;
  const el = root.querySelector<FieldElement>(`[name="shippingAddress.${key}"]`);
  // With Google address autocomplete on, address1 has no name attribute.
  if (!el && key === 'address1') return root.querySelector<HTMLInputElement>('#addressLine1Input');
  return el;
}

/** Every shipping address field, keyed by SDK address key. Includes custom fields ('customFields.field_25'). */
export function shippingFields(): [key: string, el: FieldElement][] {
  const root = shippingAddressRoot();
  if (!root) return [];
  const fields = [...root.querySelectorAll<FieldElement>('[name^="shippingAddress."]')].map((el): [string, FieldElement] => [el.name.slice('shippingAddress.'.length), el]);
  const address1 = !fields.some(([key]) => key === 'address1') && shippingField('address1');
  if (address1) fields.push(['address1', address1]);
  return fields;
}

/** State is a select (stateOrProvinceCode) for countries with subdivisions, otherwise text (stateOrProvince). */
export function shippingStateField(): { key: 'stateOrProvinceCode' | 'stateOrProvince'; el: FieldElement } | null {
  const select = shippingField('stateOrProvinceCode');
  if (select) return { key: 'stateOrProvinceCode', el: select };
  const text = shippingField('stateOrProvince');
  return text ? { key: 'stateOrProvince', el: text } : null;
}

/** Signed-in shoppers: when the current address matches a saved address, the manual fields aren't rendered. */
export function isManualShippingFormVisible(): boolean {
  return !!shippingField('firstName');
}

/** Signed-in shoppers: the saved-address dropdown is showing a saved address, so the manual fields aren't rendered (docs/checkout-internals.md §4a). */
export function isSavedShippingAddressSelected(): boolean {
  return !!shippingAddressRoot()?.querySelector(SELECTORS.addressToggle) && !isManualShippingFormVisible();
}

/** Chooses "Enter a new address" in the saved-address dropdown. This deletes the consignment and resets the form. */
export async function openNewShippingAddressForm(timeout = 8000): Promise<boolean> {
  if (isManualShippingFormVisible()) return true;
  const toggle = shippingAddressRoot()?.querySelector<HTMLElement>(SELECTORS.addressToggle);
  if (!toggle) return false;
  toggle.click();
  const addNew = await waitFor(() => shippingAddressRoot()?.querySelector<HTMLElement>(SELECTORS.addNewAddress), 2000);
  if (!addNew) return false;
  addNew.click();
  return !!(await waitFor(() => isManualShippingFormVisible(), timeout));
}
