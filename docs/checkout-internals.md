# How stock checkout works

What the stock Optimized One-Page Checkout actually does at runtime, seen from a script running inside it: lifecycle, markup hooks, form behaviour, and network calls. `src/harness/adapter.ts` and `fill.ts` are built on it.
For what BigCommerce's public docs say (platform rules, APIs, settings), see [bigcommerce.md](bigcommerce.md).

Each point is marked **[verified]** (seen on the sandbox) or **[source]** (read in checkout-js). These are implementation details, not a public API, so any checkout-js release can change them. Recheck them when the version moves.
Source links point at [checkout-js v1.906.1](https://github.com/bigcommerce/checkout-js/tree/v1.906.1) and [checkout-sdk-js v1.983.4](https://github.com/bigcommerce/checkout-sdk-js/tree/v1.983.4). Sandbox observed on checkout-js **1.906.1**, 2026-09-25.

---

## 1. What's on the page

- **[verified]** The loader is `microapps.bigcommerce.com/checkout-js/loader-<ver>.js`. It calls `checkoutLoader.loadFiles().then(app => app.renderCheckout({ containerId: 'checkout-app', initialState }))`. The initial checkout, config, and form fields are **inlined in the page** (`initialState`), so the first render needs no XHR.
- **[verified]** Globals: `window.checkout` (render functions only), `checkoutLoader`, `checkoutVariantIdentificationToken`. There is **no `checkoutService` on window.** It exists only in React context ([`CheckoutApp.tsx:56-65`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/checkout/CheckoutApp.tsx#L56-L65)), and reaching it means walking React fiber internals. Don't.
- **[verified]** Other scripts already run on checkout:
  - BigCommerce's CSRF script already wraps `fetch` and `XMLHttpRequest`. Our wrappers wrap theirs.
  - The B2B Buyer Portal (`b3CheckoutConfig`) initially hides the body.
  - The Makeswift runtime.
- **[verified]** The response has no CSP header by default. If the merchant enables the nonce CSP, Script Manager scripts get a nonce automatically. Scripts we inject ourselves would not.
- **[source]** checkout-js dispatches **no DOM or custom events** and has no URL routing. The active step is React state. BODL (`window.bodlEvents`) and `analytics.track` exist, but they're analytics signals, not lifecycle signals.

## 2. Steps and lifecycle

- **[verified]** Steps are `li.checkout-step.checkout-step--{customer|shipping|billing|payment}`, and the active one has `.checkout-step--current`.
- **[source]** Step content mounts **only while that step is active** (`CSSTransition unmountOnExit`, [`CheckoutStep.tsx:197-214`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/checkout/CheckoutStep.tsx#L197-L214)).
- **[verified]** A widget inserted next to `#checkoutShippingAddress` survives in-form re-renders, such as a postcode change or a quote refresh. It is destroyed when the shopper moves to another step, so it must be re-mounted every time the step reopens.
- **[source]** Other things that unmount or swap the form:
  - the multi-shipping toggle
  - the saved-address selection loading overlay
  - a signed-in shopper whose server address matches a saved address (the manual form is not rendered at all)
  - Stripe Link, Fastlane, and Amazon Pay alternate shipping UIs
- **[source]** Initialisation trap: while loading, the real form is rendered **offscreen** inside `.loading-skeleton`, then `resetForm()` runs when the initial values arrive ([`withFormikExtended.tsx:25-35`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/common/form/withFormikExtended.tsx#L25-L35)). Anything filled before that is wiped. Ready means `.address-form-skeleton` has gone.
  - **[verified]** Once ready, `.loading-skeleton` stays with an **empty** `style=""`. Test for `style*="absolute"`, not `[style]`. Getting this wrong kept the widget from ever mounting.

## 3. Shipping form hooks (adapter candidates)

| What | Hook | Stability |
|---|---|---|
| Shipping step | `li.checkout-step--shipping` (+ `--current`) | good |
| Address fieldset | `fieldset#checkoutShippingAddress` | good (used by BigCommerce's own e2e tests) |
| Fields | `[name="shippingAddress.<field>"]` scoped to the fieldset | **best**: mirrors the SDK address model |
| State | `stateOrProvinceCode` (select) **or** `stateOrProvince` (text), depending on country | depends on country |
| Shipping options | `fieldset#checkout-shipping-options` | good |
| Continue | `#checkout-shipping-continue` (disabled while busy) | good |
| Extension slots | `#extension-region-shipping-shippingaddressform-before/after` | only when an extension is registered |

**Scope every query to `#checkoutShippingAddress`.** The billing form and the multi-shipping modal reuse the same ids.
With Google autocomplete enabled, `address1` has **no `name`**, only `id="addressLine1Input"` ([`GoogleAutocompleteFormField.tsx:49-59`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/address/googleAutocomplete/GoogleAutocompleteFormField.tsx#L49-L59)).

## 4. React / Formik interop

**[verified] on the sandbox:**

```js
el.value = 'Naive';                        // ❌ shows in the field; Formik: "First Name is required"
const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
set.call(el, 'Setter');
el.dispatchEvent(new Event('input', { bubbles: true }));   // ✅ Formik accepts it
```

- Selects need the `HTMLSelectElement.prototype` setter plus a bubbling `change` event, and the value must match an option exactly. For checkboxes, use `el.click()`.
- **Auto-save** is a lodash debounce, `SHIPPING_AUTOSAVE_DELAY = 1700`ms ([`SingleShippingForm.tsx:67`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/SingleShippingForm.tsx#L67)).
  - It only fires when **the whole form is valid** ([`SingleShippingForm.tsx:233-235`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/SingleShippingForm.tsx#L233-L235)).
  - **[source]** It also skips the save when the new address equals the current consignment address ([`SingleShippingForm.tsx:215`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/SingleShippingForm.tsx#L215)).
  - **[verified]** The PUT started about 1.7s after the last input.
  - **[verified] 2026-09-25** So "no save coming" can't be observed directly; there's no event for it. The harness treats "no consignment write has *started* 2.5s after the last change" as incomplete. On the sandbox that returned in about 2.5s, and real saves still completed in 2.7–4s.
- **[verified]** A full programmatic fill led to:
  1. `POST …/consignments` with the full address (about 3s round trip on the sandbox)
  2. shipping quotes rendered
  3. a default option auto-selected (`PUT …/consignments/{id}` with `shippingOptionId`)

  This is the same sequence a real user triggers.
- **Ordering rule:** set the country first. Then wait for the state field to swap to a different node, and for the effect that clears state ([`SingleShippingForm.tsx:225-228`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/SingleShippingForm.tsx#L225-L228)). Then set state and phone. Blur isn't needed to save, but touched plus submitted is needed for errors to show.
- Traps:
  - Phone with `isPhoneNumberValidationEnabled` uses intl-tel-input, which is not driven by `onChange`.
  - Date custom fields use react-datepicker.
  - Required custom fields (`customFields.field_NN`) block auto-save.

## 4a. Signed-in shoppers with saved addresses

- **[verified]** On arrival with no consignment, the dropdown (`#addressToggle`) reads **"Enter a new address"**. The manual fields are present, plus a `shippingAddress.shouldSaveAddress` checkbox.
  - Saved addresses are **not** pre-selected for normal (B2C) customers.
  - **[source]** Pre-selection only happens for B2B company users with `hasCompanyAddressBook`, using the address flagged `isDefaultShipping` ([`setDefaultAddress.ts`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/address/setDefaultAddress.ts), called from [`Shipping.tsx:91-99`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/Shipping.tsx#L91-L99)).
- **[source]** A saved address shows as selected whenever the **current consignment address equals a saved address**. The comparison covers names, company, phone, address lines, city, postcode, country, and state ([`isEqualAddress.ts`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/address/isEqualAddress.ts), [`ShippingAddressForm.tsx:86-124`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/ShippingAddressForm.tsx#L86-L124)). In that case the manual form is **not rendered**.
- **[verified]** When we filled the form with values identical to the saved address:
  1. auto-save sent `POST` then `PUT` to consignments
  2. the manual fields **disappeared**
  3. the dropdown showed the saved address
  4. after a reload, the saved address was still selected and there was still no manual form
- Implications for widgets:
  - Anchor widgets to `#checkoutShippingAddress`, which is always present, **not** to the manual fields, which can vanish mid-session.
  - To change the address again after that, first choose **"Enter a new address"** (`[data-test="add-new-address"]`). This deletes the consignment and resets the form. Only then fill.
    - **[source]** The reset uses the SDK's shipping address after the delete, which is empty ([`handleUseNewAddress`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/SingleShippingForm.tsx#L259), [`deleteConsignmentsSelector`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/hooks/useShipping.ts#L22-L34)).
    - **[verified] 2026-09-25** So `fillShippingAddress` reads the selected address first (Storefront API consignment) and fills it back with the update applied. With customer 1, a city/state/postcode update kept name, street, and phone, and saved.
  - Picking a saved address via the dropdown saves **immediately**, without the 1.7s debounce. It could be a faster path when the target is a known saved address.

## 4b. Merchant settings that change checkout behaviour

Widgets may depend on these, and some can be detected at runtime.

- **Default Shipping Option** (control panel: Settings › Checkout › Shipping): least expensive excl. pickup, least expensive, most expensive, or **None**.
  - **[source]** The server applies the setting by flagging one option `isRecommended: true`. The client then selects the recommended option, **or the only option when there's just one, even with None** ([`ShippingOptionsForm.tsx:49-71`](https://github.com/bigcommerce/checkout-js/blob/v1.906.1/packages/core/src/app/shipping/shippingOption/ShippingOptionsForm.tsx#L49-L71)).
  - This runs once per consignment that has no selected option.
  - Detect at runtime: `consignments[].availableShippingOptions[].isRecommended` in the consignment response. The setting is not in `/v3/checkouts/settings`.
  - **[verified]** The sandbox auto-selects an option, so it is not set to None.
- **Billing same as shipping** (checked by default). This affects whether Continue also writes the billing address.
- **Multi-address shipping** (`hasMultiShippingEnabled`, false on the sandbox). This adds the mode toggle, which swaps the whole form.
- **Google address autocomplete** (`googleMapsApiKey`, empty on the sandbox). It changes the `address1` input (no `name`) and adds a suggestion popover.
- **Phone number validation** (`isPhoneNumberValidationEnabled`, false on the sandbox). With it on, phone becomes intl-tel-input and needs a different fill strategy.
- **Floating labels** (`checkoutUserExperienceSettings.floatingLabelEnabled`, true on the sandbox). This affects markup and styling only.
- **Enhanced checkout theme** (`enhancedCheckoutThemeV1`, false). It moves country to the top and removes the billing step.
- **Form fields** (control panel: Advanced Settings › Account Signup Form). Custom or required address fields change what makes the form valid.
- Most of these live in `initialState.config.storeConfig.checkoutSettings`. That object is **not a global**: it's a literal inside the inline `renderCheckout(...)` bootstrap script. The adapter can read it from that script's text (fragile), or infer it from DOM and network traffic.
  - Either way, expose it as one `settings` object, so a widget can declare what it requires and refuse to mount otherwise.

## 5. Network

- **[source]** The SDK uses **XHR only** (`@bigcommerce/request-sender`). It never uses `fetch`.
  - Patching `XMLHttpRequest.prototype.open/send` catches every SDK request made after the patch.
  - The initial loads are missed, but they're inlined anyway.
- **[verified]** Shipping calls:
  - `POST /api/storefront/checkouts/{id}/consignments?include=consignments.availableShippingOptions,…`
  - `PUT …/consignments/{cid}`
- On subfolder stores, the writes are prefixed with the base path, so match on path suffix.
- **Direct Storefront API writes are not reflected in the UI.** The SDK store only changes through its own dispatches. Formik has `enableReinitialize: false`, and the next auto-save sends the form values over our change. The only supported refresh is a Checkout Extension command (`RELOAD_CHECKOUT` / `RE_RENDER_SHIPPING_FORM`), and those are accepted only from the registered extension's origin.
- **Reads** from the Storefront API are fine. For example, `GET /api/storefront/checkouts/{id}` with same-origin credentials is fine for widget data.

## 6. Script Manager in practice

The documented rules (SRI for PCI 6.4.3, limits, 20s cache, scopes, consent categories) are in [bigcommerce.md › Script Manager](bigcommerce.md#script-manager-and-the-scripts-api). What we saw when using it:

- `scripts/deploy.ts` uses `POST/PUT/DELETE /v3/content/scripts` with `visibility: checkout`, `location: footer`, `consent_category: essential`, and `enabled: false` to switch a widget off.
- Browser-side injection (dev and smoke) skips Script Manager entirely. That keeps the inner loop fast and avoids new hashes and control-panel notifications on every save.
- **[verified] 2026-09-25 probes:**
  - The API accepts `visibility: checkout` scripts with **no** `integrity_hashes`, both `script_tag` and `src`. **SRI is not enforced**; it's the merchant's PCI responsibility.
  - An inline `script_tag` renders in `<body>` near the end, as `<script nonce="">…</script>`, and runs. The nonce is empty because nonce CSP is off.
  - A `src` script renders as `<script src defer nonce="">`. No `integrity` attribute is added when no hash is supplied.
  - Enabling or disabling reaches shoppers in **0.5–20s**, measured over 4 toggles via real page loads. That matches the documented 20s cache.
  - For an instant, per-browser switch, use the runtime `?cwh=off`.
- **[verified] deploy details:**
  - Script names can't contain `:`, so we use `cwh-<widget>`.
  - A `PUT` can't switch an entry between `script_tag` and `src` ("Invalid html update"). `scripts/deploy.ts` deletes and recreates the entry instead.
  - Hosted `src` + `integrity_hashes` renders as `<script src defer integrity="sha384-…" crossorigin="anonymous" nonce="">`, and the widget runs, so SRI is honoured.
  - WebDAV is at `https://store-<hash>.mybigcommerce.com/dav` (Digest auth).
  - `/content/<path>` is served from the storefront domain as `application/javascript` with `access-control-allow-origin: *` and `max-age=10`. So use content-hashed filenames and never overwrite one.
- **[verified]** Non-browser HTTP requests to `/checkout` (Playwright `request`, curl without a session) get **406** from bot protection. Verify pages in a real browser page.

## 7. The supported alternative: Checkout Extensions

- checkout-js has iframe or worker "extensions" in fixed regions:
  - `shipping.shippingAddressForm.before/after`
  - `shipping.selectedShippingMethod`
  - `payment.paymentMethodList.before`
  - `summary.after`, `summary.lastItem.after`
  - `global` (worker)
- They talk over `postMessage`:
  - commands: `RELOAD_CHECKOUT`, `RE_RENDER_SHIPPING_FORM`, `SET_IFRAME_STYLE`, `SHOW_LOADING_INDICATOR`
  - query: `GET_CONSIGNMENTS`
  - event: `CONSIGNMENTS_CHANGED`
- The sandbox's feature flag `PROJECT-5029.checkout_extension` is on, and `extensions: []`.
- Source: [`packages/checkout-extension`](https://github.com/bigcommerce/checkout-js/tree/v1.906.1/packages/checkout-extension) in checkout-js.
- **Not in BigCommerce's developer docs** (checked 2026-09-25). The registration API and availability are unknown. Worth a follow-up, because it's the one sanctioned way to write server-side and then make the form reload.

## 8. Known unknowns

Not yet investigated. Worth checking before relying on the related behaviour.

- Is Checkout Extension registration available to us (API, plan)? Could an extension iframe served from our origin complement the DOM widget?
- B2B Edition on checkout: the company address book and `restrictManualAddressEntry` change the shipping form a lot. Which B2B states do we support?
- When a widget's address matches a saved address, should it select it via the dropdown (instant save, §4a) or fill the form (the current behaviour)?
- How does checkout pre-rendering (Chrome speculation rules) affect widget init timing?
