# Checkout Widget Harness

Small widgets for the **stock** BigCommerce Optimized One-Page Checkout, added through Script Manager without forking checkout-js.

We integrate with an app we don't control, so some brittleness is unavoidable. The harness **contains** it: the fragile parts are small, observable, tested, and easy to switch off.

## Prerequisites

- **Node.js 24.2+** (it runs the TypeScript scripts directly).
- **A BigCommerce store on Optimized One-Page Checkout**, ideally a sandbox you can break.
- **A store-level API account** (control panel › Settings › Store-level API accounts) with these scopes:
  - **Checkout Content: modify**, to deploy scripts
  - **Information & Settings: read-only**, to look up the storefront URL
  - **Customers Login: login**, only for signed-in testing (`--login`)
- **`store-credentials.env`** in the project root, holding those credentials. It's gitignored; never commit it.

  ```sh
  cp store-credentials.example.env store-credentials.env
  ```

  Fill in `store_hash`, `access_token`, `client_id` and `client_secret` from the API account. The store hash is the part after `/stores/` in its API path. The WebDAV values are only needed for `deploy --hosted`. Details: [docs/bigcommerce.md › Credentials](docs/bigcommerce.md#credentials-store-credentialsenv).
- **A physical product to put in the cart.** `dev` and `smoke` add product 113, which exists on the sandbox. On another store, pass `--product=<id>` to both, using a product that ships.

## Quick start

```sh
npm install && npm run setup     # deps + Playwright's Chromium

npm run dev                      # sandbox checkout with your local widget; save → rebuild → reload
npm run smoke                    # end-to-end check of the local build (headless)
npm run deploy -- <widget>       # publish to Script Manager (inline); live within ~20s
npm run smoke -- --deployed      # check what shoppers get
```

New here? Read **[docs/first-widget.md](docs/first-widget.md)** (about 10 minutes). Using an AI agent? It should read **[AGENTS.md](AGENTS.md)**.

## How it fits together

```
widgets/<name>/index.ts      your widget: registerWidget({ name, slot, mount })
widgets/<name>/smoke.ts      drives your widget's UI in `npm run smoke`
src/harness/
  index.ts                   registerWidget, window.cwh (status, kill switch, debug)
  lifecycle.ts               one MutationObserver → mount / unmount, no duplicates, errors contained
  adapter.ts                 the ONLY file that knows BigCommerce checkout markup
  fill.ts                    fills native inputs so React/Formik see real user input
  checkout.ts                ctx.checkout: fillShippingAddress, readShippingAddress, isSavedAddressSelected, getCheckout, onConsignmentsChange
  net.ts                     read-only: the checkout SDK's API traffic, and Storefront API reads
scripts/                     dev · smoke · deploy · build · login-url
docs/checkout-internals.md   how stock checkout behaves at runtime, with evidence (sandbox + source)
docs/bigcommerce.md          platform crib notes, linking to BigCommerce's public docs
```

## Principles

1. **Drive the UI, don't bypass it.** Change checkout state through the stock form, as a shopper would. Direct Storefront API writes leave the React app stale, and its auto-save overwrites them. Reads are fine.
2. **One adapter owns the markup.** When BigCommerce changes the DOM, `src/harness/adapter.ts` is the only file to fix.
3. **Use the hooks BigCommerce itself tests against:** `name="shippingAddress.*"`, ids, and `data-test`. Never depend on styling classes or DOM depth.
4. **Fail closed.** If something isn't found, do nothing and log it. Checkout must work exactly as it would without us.
5. **Expect remounts.** Checkout destroys the widget whenever the shopper leaves the step. `mount()` runs again every time the slot reappears.
6. **Stay cheap:** no framework, a few KB gzipped, one observer, no polling.
7. **Stay observable:** `cwh.status()`, `?cwh=debug`.
8. **Easy off.** Store-wide: `npm run deploy -- <widget> --disable` (takes up to 20s). Per browser, instantly: `?cwh=off`.

## Switches

| | |
|---|---|
| `?cwh=debug` | verbose logs, including every checkout API call (sticky; `?cwh=on` resets) |
| `?cwh=off` | disable all widgets in this browser (sticky) |
| `cwh.status()` | in DevTools: version, each widget's state and mount count, recent events |
| `cwh.checkout.*` | in DevTools: the widget API (`fillShippingAddress`, `readShippingAddress`, `getCheckout`, …) on any page with the harness loaded (`npm run dev`, `smoke --headed`, or deployed) |
| `npm run deploy -- --list` | what's deployed |
| `npm run deploy -- <widget> --disable / --enable / --remove` | store-wide switch |
| `npm run deploy -- <widget> --hosted` | WebDAV-hosted file with an SRI hash, instead of inline |

## Sandbox

- Storefront: https://supply-yard.mybigcommerce.com (stock OPC, AU shipping zone, B2B Edition present)
- Signed-in shopper: `npm run dev -- --login=1`, or `open "$(npm run -s login-url -- 1)"`

## Reference

- [docs/bigcommerce.md](docs/bigcommerce.md): the BigCommerce platform facts this project relies on (Script Manager, SRI, CSP, checkout settings, APIs, credentials), with links to the public docs.
- [bigcommerce/checkout-js](https://github.com/bigcommerce/checkout-js): the React checkout. Start at `packages/core/src/app/shipping/`.
- [bigcommerce/checkout-sdk-js](https://github.com/bigcommerce/checkout-sdk-js): the SDK. Start at `packages/core/src/shipping/`.
