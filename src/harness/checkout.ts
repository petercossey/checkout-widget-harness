// The checkout API widgets get as `ctx.checkout`.
// Writes go through the stock form (fill.ts). Reads use the form, the public Storefront API, or the SDK's own traffic.

import { API, isSavedShippingAddressSelected } from './adapter.ts';
import { fillShippingAddress, readShippingAddress } from './fill.ts';
import { getCheckout, onRequest, type Checkout, type Consignment } from './net.ts';

export type { Checkout, Consignment, ShippingOption } from './net.ts';

/** Called with the consignments every time the checkout SDK gets them back from the server (address saved, option selected, etc.). */
export function onConsignmentsChange(fn: (consignments: Consignment[]) => void): () => void {
  return onRequest(API.consignments, (e) => {
    const consignments = (e.response as Checkout | undefined)?.consignments;
    if (e.status < 300 && Array.isArray(consignments)) fn(consignments);
  });
}

export const checkout = {
  fillShippingAddress,
  readShippingAddress,
  /** Signed-in shoppers: true when a saved address is selected, so the manual shipping fields aren't shown. */
  isSavedAddressSelected: isSavedShippingAddressSelected,
  getCheckout,
  onConsignmentsChange,
};
export type CheckoutApi = typeof checkout;
