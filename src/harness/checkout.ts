// The checkout API widgets get as `ctx.checkout`.
// Writes go through the stock form (fill.ts). Reads use the form, the public Storefront API, or the SDK's own traffic.

import { API, billingSameAsShippingCheckbox, hideShippingParts, isSavedShippingAddressSelected, shippingOptionRadio } from './adapter.ts';
import { waitFor } from './dom.ts';
import { fillShippingAddress, readShippingAddress } from './fill.ts';
import { getCheckout, onRequest, type Checkout, type Consignment } from './net.ts';

export type { Checkout, Consignment, ShippingOption } from './net.ts';
export type { HiddenShippingParts } from './adapter.ts';

/** Called with the consignments every time the checkout SDK gets them back from the server (address saved, option selected, etc.). */
export function onConsignmentsChange(fn: (consignments: Consignment[]) => void): () => void {
  return onRequest(API.consignments, (e) => {
    const consignments = (e.response as Checkout | undefined)?.consignments;
    if (e.status < 300 && Array.isArray(consignments)) fn(consignments);
  });
}

export interface SelectOptionResult {
  ok: boolean;
  /** 'unchanged': it was already selected, so nothing was sent. */
  notSent?: 'unchanged';
  error?: string;
}

/**
 * Selects a shipping option by id by clicking its radio in the stock list, as a shopper would, and waits for checkout to save it.
 * The list only renders once checkout has quotes for a valid address, so this waits briefly for the radio to appear.
 */
async function selectShippingOption(optionId: string, { timeout = 10000 } = {}): Promise<SelectOptionResult> {
  const radio = await waitFor(() => shippingOptionRadio(optionId), 5000);
  if (!radio) return { ok: false, error: 'shipping option not shown' };
  if (radio.checked) return { ok: true, notSent: 'unchanged' };

  let off = () => {};
  const saved = new Promise<SelectOptionResult>((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeout);
    // The SDK sends PUT …/consignments/{id} with { shippingOptionId } (checkout-sdk-js consignment-action-creator.ts).
    off = onRequest(API.consignments, (e) => {
      if (e.method !== 'PUT' || (e.requestBody as { shippingOptionId?: string } | undefined)?.shippingOptionId !== optionId) return;
      clearTimeout(timer);
      const selected = (e.response as Checkout | undefined)?.consignments?.some((c) => c.selectedShippingOption?.id === optionId);
      resolve(e.status < 300 && selected ? { ok: true } : { ok: false, error: `rejected (HTTP ${e.status})` });
    });
  });
  radio.click(); // React treats a click as the radio's change event
  const result = await saved;
  off();
  return result;
}

/**
 * Checks or unchecks "My billing address is the same as my shipping address". Checkout applies it on Continue:
 * unchecked sends the shopper to the billing step. 'missing' when the checkbox isn't shown (e.g. the store hides it).
 */
function setBillingSameAsShipping(checked: boolean): 'set' | 'unchanged' | 'missing' {
  const box = billingSameAsShippingCheckbox();
  if (!box) return 'missing';
  if (box.checked === checked) return 'unchanged';
  box.click(); // React treats a click as the checkbox's change event
  return box.checked === checked ? 'set' : 'missing';
}

export const checkout = {
  fillShippingAddress,
  readShippingAddress,
  /** Signed-in shoppers: true when a saved address is selected, so the manual shipping fields aren't shown. */
  isSavedAddressSelected: isSavedShippingAddressSelected,
  getCheckout,
  onConsignmentsChange,
  selectShippingOption,
  setBillingSameAsShipping,
  /** Hides parts of the stock shipping step (address, options list, billing checkbox, single options). Returns a function that shows them again. */
  hideShipping: hideShippingParts,
};
export type CheckoutApi = typeof checkout;
