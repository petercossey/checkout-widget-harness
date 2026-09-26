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
  // Radios: id="shippingOptionRadio-<consignmentId>-<optionId>", name="shippingOptionIds.<consignmentId>", value=<optionId>
  // (ShippingOptionsList.tsx:43-47, ShippingOptionsForm.tsx:122 at v1.906.1; verified on sandbox 2026-09-26).
  shippingOptionRadio: 'input[type="radio"][name^="shippingOptionIds."]',
  // Outside #checkoutShippingAddress, in the same step (BillingSameAsShippingField.tsx:20-27 at v1.906.1).
  // The payment step reuses the component, so always scope it to the shipping step.
  billingSameAsShipping: 'input[name="billingSameAsShipping"]',
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

/** A shipping option's radio in the stock list, by option id. Only rendered once checkout has quotes for a valid address. */
export function shippingOptionRadio(optionId: string): HTMLInputElement | null {
  if (!shippingAddressRoot()) return null;
  const radios = document.querySelectorAll<HTMLInputElement>(`${SELECTORS.shippingStepActive} ${SELECTORS.shippingOptions} ${SELECTORS.shippingOptionRadio}`);
  return [...radios].find((radio) => radio.value === optionId) ?? null;
}

/** The "My billing address is the same as my shipping address" checkbox. Checkout only applies it when Continue is clicked. */
export function billingSameAsShippingCheckbox(): HTMLInputElement | null {
  if (!shippingAddressRoot()) return null;
  return document.querySelector<HTMLInputElement>(`${SELECTORS.shippingStepActive} ${SELECTORS.billingSameAsShipping}`);
}

export interface HiddenShippingParts {
  /** The whole address fieldset, including the saved-address dropdown. */
  address?: boolean;
  /** The whole shipping method list. */
  options?: boolean;
  /** The billing-same-as-shipping checkbox and its label. */
  billingSameAsShipping?: boolean;
  /** Individual shipping methods, by option id. */
  optionIds?: string[];
}

/**
 * Hides parts of the stock shipping step with a stylesheet, so elements checkout re-renders stay hidden.
 * Hidden fields still work: fills and clicks through fill.ts / checkout.ts reach them. Returns a function that shows them again.
 * Option rows use :has(). Browsers without it show the row, so callers must not rely on hiding alone.
 */
export function hideShippingParts(parts: HiddenShippingParts): () => void {
  const step = 'li.checkout-step--shipping';
  const rules: string[] = [];
  if (parts.address) rules.push(`${step} ${SELECTORS.shippingAddress}`);
  if (parts.options) rules.push(`${step} ${SELECTORS.shippingOptions}`);
  if (parts.billingSameAsShipping) rules.push(`${step} ${SELECTORS.billingSameAsShipping}`, `${step} label[for="sameAsBilling"]`);
  // Each option is an <li> (AccordionItem.tsx:51 at v1.906.1) holding its radio.
  for (const id of parts.optionIds ?? []) rules.push(`${step} ${SELECTORS.shippingOptions} li:has(input[value="${CSS.escape(id)}"])`);
  if (!rules.length) return () => {};
  const style = document.createElement('style');
  style.dataset.cwhHide = '';
  style.textContent = `${rules.join(',')}{display:none!important}`;
  document.head.appendChild(style);
  return () => style.remove();
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
