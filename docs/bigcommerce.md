# BigCommerce platform notes

The parts of BigCommerce's public docs this project depends on, in one place. Each section links to the source; go there for detail.
What the running checkout actually does, and why, is in [checkout-internals.md](checkout-internals.md).

## Source code

Both are open source. Links in these docs point at the versions the sandbox ran when we checked (2026-09-25), so line numbers match.

| | What it is | Version we read |
|---|---|---|
| [bigcommerce/checkout-js](https://github.com/bigcommerce/checkout-js) | The Optimized One-Page Checkout app (React + Formik). Shipping is in `packages/core/src/app/shipping/`, address fields in `address/`. | [v1.906.1](https://github.com/bigcommerce/checkout-js/tree/v1.906.1) |
| [bigcommerce/checkout-sdk-js](https://github.com/bigcommerce/checkout-sdk-js) | The SDK checkout-js uses to call the Storefront API. Start at `packages/core/src/shipping/`. | [v1.983.4](https://github.com/bigcommerce/checkout-sdk-js/tree/v1.983.4) |

To search them locally (`reference-code/` is gitignored):

```sh
git clone --depth 1 --branch v1.906.1 https://github.com/bigcommerce/checkout-js reference-code/checkout-js
git clone --depth 1 --branch v1.983.4 https://github.com/bigcommerce/checkout-sdk-js reference-code/checkout-sdk-js
```

The sandbox's live version is in the checkout page's loader URL (`checkout-js/loader-<version>.js`). If it has moved on, compare against the newer tag.

## Checkout options, and why we use stock checkout

BigCommerce offers several ways to customise checkout ([Checkout customizability](https://developer.bigcommerce.com/docs/storefront/cart-checkout)):

- **Optimized One-Page Checkout (OPC):** the stock checkout, built from checkout-js. It is the default for Stencil stores, and BigCommerce updates it automatically.
- **Open Checkout:** fork checkout-js and host your build as a custom checkout ([quick start](https://developer.bigcommerce.com/docs/storefront/cart-checkout/open-checkouts)). You then maintain the fork.
- **Checkout JS SDK:** build your own checkout UI on the SDK ([docs](https://developer.bigcommerce.com/docs/storefront/cart-checkout/checkout-sdk)).
- **Storefront and Management APIs:** headless and server-side checkouts.

This project stays on stock OPC and adds scripts to it, so merchants keep automatic updates. The cost is that we integrate with markup we don't control.
BigCommerce's styling guide says the `optimizedCheckout-*` class names "are subject to change" and warns against changing structure ([OPC styling](https://developer.bigcommerce.com/docs/storefront/cart-checkout/optimized-one-page-checkout)). That's why the adapter avoids styling classes.

## Script Manager and the Scripts API

This is how widgets get onto checkout. Sources: [Scripts API guide](https://developer.bigcommerce.com/docs/integrations/scripts), [Scripts API reference](https://developer.bigcommerce.com/docs/rest-management/scripts), [Using Script Manager](https://support.bigcommerce.com/s/article/Using-Script-Manager).

- **Checkout only works with OPC.** Script location `checkout` targets only the checkout page. `all_pages` also includes checkout. Stores on the legacy Blueprint theme engine can't render scripts at all.
- **Placement** is `head` or `footer`. BigCommerce recommends `footer` for checkout.
- **Type** is an inline `script_tag` or a `src` URL. Inline scripts are limited to 64KB and up to five `<script>` tags.
- **Consent category:** `essential`, `analytics`, `functional` or `targeting`. With the cookie consent banner on, shoppers can opt out of everything except essential scripts.
- **Scripts on checkout (a payment page) need at least one SRI hash** to meet PCI DSS 4.0 requirement 6.4.3. You can add up to five. For `src` scripts, BigCommerce adds `integrity` and `crossorigin="anonymous"`, and a script that doesn't match its hash won't run. Changing a hosted file therefore means supplying a new hash.
- **Limits:** 10 API-created scripts per app, 50 control-panel scripts per channel. Changes take about **20 seconds** to reach shoppers (cache).
- **Ownership:** an API account can only read and edit the scripts it created. Control-panel users can still delete any script or change its consent category.
- **Audit trail:** every create, update or delete posts a control-panel notification that can't be dismissed for 14 days, and appears in Store Logs.
- **Scope:** creating checkout scripts needs the **Checkout Content: modify** scope (`store_content_checkout`) ([OAuth scopes](https://developer.bigcommerce.com/docs/start/authentication/api-accounts#oauth-scopes)).

## Security: CSP and nonces

Source: [Security and Privacy Settings](https://support.bigcommerce.com/s/article/Security-and-Privacy-Settings).

- Merchants can set a custom Content Security Policy header, up to 1,000 characters.
- **Nonce-based script security** (optional) adds a per-request nonce to the CSP on checkout and account pages. Scripts without a matching nonce are blocked. Script Manager scripts get the nonce automatically. Scripts injected any other way don't.
- With nonces on, `eval`-style dynamic code is blocked unless the merchant also enables **Allow dynamic script execution**. The harness doesn't use `eval`.

## Checkout settings that change what widgets see

Source: [Optimized One-Page Checkout (Help Center)](https://support.bigcommerce.com/s/article/Optimized-Single-Page-Checkout). [checkout-internals.md §4b](checkout-internals.md#4b-merchant-settings-that-change-checkout-behaviour) covers how each one shows up in the page.

- **Default shipping option:** least expensive excluding pickup, least expensive, most expensive, or none.
- **Multiple shipping addresses:** adds a mode that swaps the whole shipping form ([details](https://support.bigcommerce.com/s/article/Offering-Shipping-to-Multiple-Addresses)).
- **Google address autocomplete:** changes the street address input and adds a suggestions popover ([details](https://support.bigcommerce.com/s/article/Address-Autocomplete)).
- **Billing same as shipping:** checked by default when enabled.
- **In-line (floating) field labels:** changes markup and styling only.
- **Guest privacy consent checkbox, terms and conditions checkbox, order comments:** extra form fields.
- **Pre-rendering:** Chrome and Edge may pre-render stock checkout when the shopper clicks Check out, so scripts can run before the page is visible. Custom checkouts, including the B2B Edition checkout script, don't pre-render. ([BODL](https://developer.bigcommerce.com/docs/integrations/hosted-analytics) notes how analytics scripts handle it.)

## Storefront REST API (the checkout's own API)

Sources: [Checkouts reference](https://developer.bigcommerce.com/docs/rest-storefront/checkouts), [Consignments](https://developer.bigcommerce.com/docs/rest-storefront/checkouts/checkout-consignments), [Carts](https://developer.bigcommerce.com/docs/rest-storefront/carts), [Carts and checkout tutorial](https://developer.bigcommerce.com/docs/storefront/cart-checkout/guide/rest-storefront).

- Called from the storefront page with same-origin cookies, so no token is needed.
- `GET /api/storefront/carts` gives the cart id, which is also the checkout id.
- `GET /api/storefront/checkouts/{id}?include=consignments.availableShippingOptions` returns addresses, consignments and shipping quotes.
- A **consignment** is a shipping address plus line items. `POST …/consignments` creates one, `PUT …/consignments/{id}` updates its address or selects a shipping option.
- The harness **reads** from this API. It never writes to it, because checkout's UI doesn't pick up the change (see [checkout-internals.md §5](checkout-internals.md#5-network)).

## Customer Login API (signed-in test shoppers)

Source: [Customer Login API](https://developer.bigcommerce.com/docs/start/authentication/customer-login). `npm run login-url` and `npm run dev -- --login=<id>` use it.

- Sign a JWT (HS256) with the API account's client secret. It carries `iss` (client id), `iat`, `jti`, `operation: "customer_login"`, `store_hash`, `customer_id`, and optionally `channel_id` and `redirect_to`.
- Open `https://<store>/login/token/<jwt>`. The token is valid for about **30 seconds**.
- Needs a store-level API account with the **Customers Login** scope.

## WebDAV (for `deploy --hosted`)

Source: [File Access (WebDAV)](https://support.bigcommerce.com/s/article/File-Access-WebDAV). Each store has a WebDAV file area. Files uploaded to `/content/` are served from the storefront domain, which `npm run deploy -- <widget> --hosted` uses for `src` scripts with an SRI hash.

## Credentials (`store-credentials.env`)

The scripts read this file from the project root. Start from `store-credentials.example.env`, and never commit the filled-in copy.

| Key | Used by | Where it comes from |
|---|---|---|
| `store_hash`, `access_token` | deploy (Scripts API), storefront URL lookup | A store-level API account with **Checkout Content: modify** (`store_content_checkout`) and **Information & Settings: read-only** (`store_v2_information_read_only`) ([API accounts](https://developer.bigcommerce.com/docs/start/authentication/api-accounts)) |
| `client_id`, `client_secret` | login-url, dev `--login` | An API account with **Customers Login** (`store_v2_customers_login`). It can be the same account. |
| `store_webdav_path`, `webdav_username`, `webdav_password` | deploy `--hosted` only | Control panel › Settings › File access (WebDAV) |
| `storefront_url` (optional) | dev, smoke | Overrides the storefront origin, which is otherwise read from the store information API (`/v2/store`) |
