// esbuild config shared by build, dev, smoke and deploy. One widget folder produces one self-contained IIFE bundle.
import { existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { BuildOptions } from 'esbuild';

export const root = new URL('../../', import.meta.url).pathname;

export function listWidgets(): string[] {
  return readdirSync(`${root}widgets`, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`${root}widgets/${d.name}/index.ts`))
    .map((d) => d.name);
}

export function resolveWidget(name: string | undefined): string {
  const widgets = listWidgets();
  if (name && widgets.includes(name)) return name;
  if (!name && widgets.length === 1) return widgets[0];
  throw new Error(`${name ? `Unknown widget "${name}". ` : ''}Available: ${widgets.join(', ')}`);
}

export function buildOptions(widget: string, { dev = false } = {}): BuildOptions {
  const version = `${widget}@${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}${dev ? '-dev' : ''}`;
  return {
    entryPoints: [`${root}widgets/${widget}/index.ts`],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    write: false,
    define: { __CWH_VERSION__: JSON.stringify(version) },
    banner: { js: `/* checkout-widget-harness ${version} */` },
    // Names the script in DevTools, which matters most for inline Script Manager deploys.
    footer: dev ? undefined : { js: `//# sourceURL=cwh/${widget}.js` },
    logLevel: 'silent',
  };
}

export function sizeReport(code: string): string {
  const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
  return `${kb(Buffer.byteLength(code))} (${kb(gzipSync(code).length)} gzip)`;
}
