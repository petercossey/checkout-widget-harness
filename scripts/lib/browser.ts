// Playwright helpers shared by dev and smoke.
import type { BrowserContext, Page } from 'playwright';

/**
 * Serves the local bundle as if Script Manager had added it: an inline <script> in the
 * footer of every /checkout page, carrying the page's CSP nonce if it has one.
 */
export async function injectBundle(context: BrowserContext, storefront: string, getCode: () => string): Promise<void> {
  const isCheckoutPage = (url: URL) => url.origin === storefront && url.pathname === '/checkout';
  await context.route(isCheckoutPage, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    if (!html.includes('</body>')) return route.fulfill({ response, body: html });
    const nonce = html.match(/<script[^>]*\snonce="([^"]*)"/)?.[1];
    const attrs = `data-cwh-dev${nonce ? ` nonce="${nonce}"` : ''}`;
    // The head flag makes any deployed copy of the harness stand down in favour of the local build.
    const flag = `<script ${attrs}>window.cwhDevOverride=true</script>`;
    const bundle = `<script ${attrs}>${getCode().replace(/<\/script/gi, '<\\/script')}</script>`;
    const headers = { ...response.headers() };
    delete headers['content-length'];
    delete headers['content-encoding'];
    // Function replacements: a replacement string would treat "$$" / "$&" inside the bundle as patterns.
    const body = html.replace(/<head[^>]*>/, (head) => `${head}${flag}`).replace(/<\/body>(?![\s\S]*<\/body>)/, () => `${bundle}</body>`);
    await route.fulfill({ status: response.status(), headers, body });
  });
}

/** Adds a product to the cart if it's empty. The checkout redirects to the cart page without one. */
export async function ensureCart(page: Page, storefront: string, productId = 113): Promise<void> {
  if (!page.url().startsWith(storefront)) await page.goto(storefront);
  await page.evaluate(async (productId) => {
    const carts = await (await fetch('/api/storefront/carts', { credentials: 'same-origin' })).json();
    if (carts.length && carts[0].lineItems.physicalItems.length) return;
    const body = JSON.stringify({ lineItems: [{ productId, quantity: 1 }] });
    const url = carts.length ? `/api/storefront/carts/${carts[0].id}/items` : '/api/storefront/carts';
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) throw new Error(`adding product ${productId} to the cart failed (HTTP ${res.status}). On another store, pass --product=<id>.`);
  }, productId);
}

/** From the customer step, continue as a guest (skipped if the shopper is already past it). */
export async function continueAsGuest(page: Page, email = 'cwh-dev@example.com'): Promise<void> {
  const emailInput = '.checkout-step--customer.checkout-step--current #email';
  const pastCustomer = '.checkout-step--current:not(.checkout-step--customer)';
  // The customer step renders lazily. Wait until the email field exists or we're already past it.
  await page.waitForSelector(`${emailInput}, ${pastCustomer}`, { timeout: 30000 });
  if (await page.locator(emailInput).count()) {
    await page.fill(emailInput, email);
    await page.click('#checkout-customer-continue');
    await page.waitForSelector(pastCustomer, { timeout: 30000 });
  }
}

/** Makes the shipping step the active one. */
export async function openShippingStep(page: Page): Promise<void> {
  const active = 'li.checkout-step--shipping.checkout-step--current';
  const edit = 'li.checkout-step--shipping [data-test="step-edit-button"]';
  // Wait until shipping is either the current step or completed (and editable).
  await page.waitForSelector(`${active}, ${edit}`, { timeout: 30000 });
  if (!(await page.locator(active).count())) await page.click(edit);
  await page.waitForSelector('li.checkout-step--shipping.checkout-step--current #checkoutShippingAddress');
}

/** Prints the harness's console output ([cwh…]) and page errors to the terminal. */
export function forwardConsole(page: Page, onLine: (line: string) => void = console.log): void {
  page.on('console', (msg) => {
    if (msg.text().startsWith('[cwh')) onLine(`  browser ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => onLine(`  page error: ${error.message}`));
}
