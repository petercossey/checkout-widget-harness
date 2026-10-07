// npm run dev [widget] [-- --login=<customerId>] [--product=<id>]
//
// Opens a browser on the sandbox checkout with your local build injected as if it came from
// Script Manager. Every time you save a file, the widget is rebuilt and the page reloads.
// The browser profile is kept in .dev-profile/ so the cart and session persist between runs.
import { context as esbuildContext } from 'esbuild';
import { chromium } from 'playwright';
import { buildOptions, resolveWidget, root, sizeReport } from './lib/bundle.ts';
import { continueAsGuest, ensureCart, forwardConsole, injectBundle } from './lib/browser.ts';
import { storefrontUrl } from './lib/env.ts';
import { loginUrl } from './lib/login.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const widget = resolveWidget(args.find((a) => !a.startsWith('--')));
const customerId = flag('login');
const productId = Number(flag('product') ?? 113);

const storefront = await storefrontUrl();
let code = '';

const browser = await chromium.launchPersistentContext(`${root}.dev-profile`, { headless: false, viewport: null });
const page = browser.pages()[0] ?? (await browser.newPage());
forwardConsole(page);
await injectBundle(browser, storefront, () => code);

let firstBuild: () => void;
const built = new Promise<void>((resolve) => (firstBuild = resolve));
const builder = await esbuildContext({
  ...buildOptions(widget, { dev: true }),
  plugins: [{
    name: 'reload',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length) return console.error(`✗ build failed: ${result.errors[0].text}`);
        const first = !code;
        code = result.outputFiles![0].text;
        console.log(`✓ built ${widget} ${sizeReport(code)}`);
        if (first) firstBuild();
        else if (new URL(page.url()).pathname === '/checkout') await page.reload().catch(() => {});
      });
    },
  }],
});
await builder.watch();
await built;

if (customerId) await page.goto(await loginUrl(Number(customerId), '/'));
await ensureCart(page, storefront, productId);
await page.goto(`${storefront}/checkout`);
if (!customerId) await continueAsGuest(page).catch(() => {});

console.log(`\nDev loop running for "${widget}" on ${storefront}/checkout`);
console.log('  edit the widget or src/ → rebuild + reload');
console.log('  in DevTools: cwh.status() · add ?cwh=debug to the URL for verbose logs');
console.log('  close the browser window to stop\n');

browser.on('close', async () => {
  await builder.dispose();
  process.exit(0);
});
