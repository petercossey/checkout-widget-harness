# AGENTS.md

Guidance for AI agents (and humans) working in this repo. Read `README.md` first, then `docs/first-widget.md`.

## What this is

A harness for small widgets injected into the **stock** BigCommerce Optimized One-Page Checkout via Script Manager. We don't control the checkout app (checkout-js, React + Formik). The job is to integrate safely from outside it.

## Commands

| Task | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| Build (size report) | `npm run build [widget]` |
| End-to-end check, local build, headless | `npm run smoke -- <widget>` |
| Check the deployed version | `npm run smoke -- <widget> --deployed` (wait ~20s after deploy) |
| Deploy / switch off | `npm run deploy -- <widget>` · `--disable` · `--enable` · `--remove` · `--list` |
| Interactive dev browser (for humans; headed, blocks) | `npm run dev -- <widget> [--login=<customerId>]` |
| Signed-in shopper URL (30s) | `npm run -s login-url -- <customerId>` |

Verify every change with `npm run typecheck && npm run smoke -- <widget>`. Give every widget a `widgets/<widget>/smoke.ts` that drives its UI (see `scripts/lib/widget-smoke.ts`); without one, smoke only tests the harness. Deploying only affects the dedicated sandbox store, but still tell the user when you do it.

## Rules

1. **Writes go through the stock form.** Use `ctx.checkout.fillShippingAddress()` or `setNativeValue()`. Never `el.value = x` (React ignores it). Never write the address or shipping via the Storefront/GraphQL API or a second checkout-sdk instance: the UI won't update and its auto-save overwrites you. Reads via `ctx.checkout.getCheckout()` are fine.
2. **Checkout markup knowledge lives only in `src/harness/adapter.ts`.** Widgets must not query checkout DOM directly. If a widget needs a new hook, add it to the adapter with a comment citing evidence (a checkout-js source link at a release tag, or "verified on sandbox <date>").
3. **Use stable hooks only:** ids, `name="shippingAddress.*"`, `data-test`. No `optimizedCheckout-*` or other styling classes, no nth-child or deep descendant chains. Scope queries to `#checkoutShippingAddress`, because the billing form reuses the same ids.
4. **Fail closed.** Anything not found → return and log. Never throw into the page. Never block checkout.
5. **Widgets render only inside `ctx.host`**, clean up via the returned function or `ctx.signal`, and assume `mount()` runs many times.
6. **Keep it small:** no runtime dependencies or frameworks without asking. Check the gzip size in the build output; the harness plus a widget should stay under about 10KB gzip.
7. **The host sits inside checkout's `<form>`.** Buttons need `type="button"`, and pressing Enter in a text input must be prevented (`keydown` → `preventDefault()`), or it submits checkout's form.

## Where to look

- Why checkout behaves the way it does (timings, traps, selectors, settings): `docs/checkout-internals.md`. Update it when you verify something new, marked **[verified]** or **[source]**.
- BigCommerce platform facts (Script Manager, SRI, CSP, checkout settings, Storefront API, credentials): `docs/bigcommerce.md`, which links to the public docs for detail.
- Checkout source: [bigcommerce/checkout-js](https://github.com/bigcommerce/checkout-js), under `packages/core/src/app/`. Shipping lives in `shipping/`, address fields in `address/`.
- SDK source (endpoints, request flow): [bigcommerce/checkout-sdk-js](https://github.com/bigcommerce/checkout-sdk-js), under `packages/core/src/`.
- To grep the source, clone both into `reference-code/` (gitignored) at the tags given in `docs/bigcommerce.md`. Cite source as a GitHub link at that tag, with line numbers.

## Debugging in a browser

- `cwh.status()`: widget state (`waiting`, `mounted` or `failed`), mount count, and recent events. If a widget is `waiting` while its step is open, the adapter isn't finding its slot.
- `?cwh=debug`: logs every checkout API call. `?cwh=off`: disables widgets in this browser. `?cwh=on`: back to normal. All three are sticky via localStorage.
- Non-browser HTTP requests to `/checkout` get 406 from bot protection, so inspect pages with Playwright pages, not `request`.
