// esbuild config shared by build, dev, smoke and deploy. One widget folder produces one self-contained IIFE bundle.
import { existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { BuildOptions } from 'esbuild';

export const root = new URL('../../', import.meta.url).pathname;

// Your widgets live in widgets/ (gitignored); examples/ holds the tracked examples. A name can be in either, not both.
const DIRS = ['widgets', 'examples'] as const;

function widgetsIn(dir: string): string[] {
  if (!existsSync(`${root}${dir}`)) return [];
  return readdirSync(`${root}${dir}`, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`${root}${dir}/${d.name}/index.ts`))
    .map((d) => d.name);
}

export function listWidgets(): string[] {
  return DIRS.flatMap(widgetsIn);
}

// Path of the widget's folder relative to the project root, e.g. "widgets/my-widget".
export function widgetDir(widget: string): string {
  const dirs = DIRS.filter((dir) => widgetsIn(dir).includes(widget));
  if (dirs.length > 1) throw new Error(`Widget "${widget}" exists in both ${dirs.join('/ and ')}/. Rename one.`);
  if (!dirs.length) throw new Error(`Unknown widget "${widget}". Available: ${listWidgets().join(', ')}`);
  return `${dirs[0]}/${widget}`;
}

// With no name: the only widget in widgets/, or the only example when widgets/ is empty (a fresh clone).
export function resolveWidget(name: string | undefined): string {
  if (name) {
    widgetDir(name); // throws if unknown or ambiguous
    return name;
  }
  const own = widgetsIn('widgets');
  const fallback = own.length ? own : widgetsIn('examples');
  if (fallback.length === 1) return fallback[0];
  throw new Error(`Name a widget. Available: ${listWidgets().join(', ')}`);
}

export function buildOptions(widget: string, { dev = false } = {}): BuildOptions {
  const version = `${widget}@${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}${dev ? '-dev' : ''}`;
  return {
    entryPoints: [`${root}${widgetDir(widget)}/index.ts`],
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
