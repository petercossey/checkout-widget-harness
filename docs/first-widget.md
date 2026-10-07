# Build your first widget

About 10 minutes. You'll build `shipping-hint`: a line under the shipping address form that shows the cheapest delivery quote once checkout has one. Then you'll ship it to the sandbox.

## 0. Setup (once)

```sh
npm install && npm run setup
cp store-credentials.example.env store-credentials.env   # then fill it in: see README › Prerequisites
```

## 1. Create the widget

Each widget is one folder in `widgets/` with an `index.ts`, and the folder name matches the widget's `name`. It's built into one self-contained script, harness included. `widgets/` is gitignored, so your widgets stay out of the harness repo and pulling harness updates never touches them ([widgets/README.md](../widgets/README.md)). For a complete example, see `examples/address-picker/`.

`widgets/shipping-hint/index.ts`:

```ts
import { registerWidget } from '../../src/harness/index.ts';

registerWidget({
  name: 'shipping-hint',              // unique, kebab-case
  slot: 'shipping.address.after',     // or 'shipping.address.before'

  mount({ host, checkout, log }) {
    host.textContent = 'Enter your address to see delivery options.';

    const off = checkout.onConsignmentsChange((consignments) => {
      const options = consignments[0]?.availableShippingOptions ?? [];
      const cheapest = [...options].sort((a, b) => a.cost - b.cost)[0];
      host.textContent = cheapest ? `Delivery from $${cheapest.cost.toFixed(2)} (${cheapest.description})` : '';
      log.debug('options', options.length);
    });

    return off; // cleanup: runs when checkout removes the widget
  },
});
```

Key ideas:

- **`host`** is your element. Render into it and nothing else.
- **`mount` runs again whenever the slot reappears.** The shopper leaving and returning to the shipping step creates a fresh `host`. Don't keep DOM references between mounts.
- **Clean up** by returning a function, or pass `{ signal }` to `addEventListener`. Both run on unmount.
- **Never throw into the page.** The harness catches errors, and it disables a widget after 3 failed mounts.

## 2. Run it

```sh
npm run dev -- shipping-hint
```

A browser opens on the sandbox checkout (a guest cart is created for you), with your widget injected where Script Manager would put it. Save a file and it rebuilds and reloads. Terminal output includes the widget's warnings and errors, and in debug mode its logs too.

- DevTools: `cwh.status()` shows whether your widget is `waiting`, `mounted` or `failed`, and how many times it has mounted.
- Add `?cwh=debug` to the URL to see harness logs and every checkout API call.
- Signed-in shopper: `npm run dev -- shipping-hint --login=1`.

## 3. Change checkout state (the important part)

Checkout is a React app. You change it **the way a shopper would**, through its form:

```ts
const result = await checkout.fillShippingAddress(
  { countryCode: 'AU', city: 'Melbourne', stateOrProvince: 'VIC', postalCode: '3000' },
  { waitForSave: true },
);
// result: { ok, filled, missing, saved, notSaved?, error? }
```

It's a **partial update** by default: fields you don't supply keep what the shopper typed. Pass `replace: true` to clear them.

Checkout only saves the address once the **whole form is valid**, about 1.7s after the last change. With `waitForSave: true`, `saved` tells you what happened:

| Result | When | Typical time |
|---|---|---|
| `saved: true` | checkout saved it and is quoting shipping | 2–5s |
| `notSaved: 'unchanged'` | the form already had these values | instant |
| `notSaved: 'incomplete'` | no save started, so a required field (e.g. name or street) is probably still empty | about 2.5s |
| `notSaved: 'rejected'` or `'timeout'` | the save failed, or didn't finish within `timeout` (10s) | |

It handles the traps for you:
- React ignores plain `input.value = …`, so it uses the native value setter plus an event.
- It sets the country before the state.
- It supports state as a dropdown or as text.
- **Signed-in shoppers with a saved address selected:** the manual fields are hidden. It switches to "Enter a new address", which empties the form, then fills in the saved address with your changes applied, so a partial update still keeps their name and street. To leave a saved address alone, check `checkout.isSavedAddressSelected()` first.

To see what's in the form right now (typed, maybe not saved yet): `checkout.readShippingAddress()`. It returns empty fields as `''`, and `null` while a saved address is selected.

**Don't** write to the Storefront API to change the address or shipping. The checkout UI won't notice, and its next auto-save overwrites you. Reading is fine: `checkout.getCheckout()`.

## 4. Check it

```sh
npm run smoke -- shipping-hint
```

This runs headless as a new guest shopper. It checks that the widget mounts once, that a fill saves and quotes shipping, that the widget unmounts and remounts across step changes with no duplicates, that `?cwh=off` works, and that the harness logs no errors.

Those checks don't touch your widget's UI. For that, add `widgets/shipping-hint/smoke.ts`. Smoke runs it after the shopper has left the shipping step and come back, so it also covers "billing → Edit shipping":

```ts
import type { WidgetSmoke } from '../../scripts/lib/widget-smoke.ts';

// Checkout has already saved a complete address (175 Pitt St, Sydney NSW 2000).
export default (async ({ page, host }) => {
  // Change the postcode so checkout quotes again, then look for the hint.
  await page.evaluate(() => window.cwh!.checkout.fillShippingAddress({ city: 'Melbourne', stateOrProvince: 'VIC', postalCode: '3000' }, { waitForSave: true }));
  await host.getByText('Delivery from').waitFor();
}) satisfies WidgetSmoke;
```

Use `host` (a Playwright locator) to click your own UI, and `expectSavedAddress({ city: 'Melbourne' })` to check what checkout saved.

## 5. Ship it

```sh
npm run deploy -- shipping-hint                  # inline Script Manager entry "cwh-shipping-hint"
npm run smoke -- shipping-hint --deployed        # after ~20s: test what shoppers get
npm run deploy -- shipping-hint --disable        # store-wide off switch (up to 20s)
```

## When something breaks

- **Widget never mounts:** run `cwh.status()`. If it says `waiting`, the adapter can't find its slot, so check `src/harness/adapter.ts` against the live DOM. If it says `failed`, look for errors in the console.
- **Fill doesn't stick** (the field shows your value but validation says it's empty): something set `.value` directly. Use `checkout.fillShippingAddress` or `setNativeValue`.
- **Checkout DOM changed after a BigCommerce release:** fix `adapter.ts` only, then run `npm run smoke`.
- **Why does checkout behave like that?** See `docs/checkout-internals.md`, which links to the exact checkout-js source lines. For BigCommerce platform facts (Script Manager, SRI, settings), see `docs/bigcommerce.md`.
