// npm run build [widget]   builds dist/<widget>.js (all widgets if none is named)
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { buildOptions, listWidgets, resolveWidget, root, sizeReport } from './lib/bundle.ts';

export async function buildWidget(widget: string): Promise<string> {
  const result = await build(buildOptions(widget));
  const code = result.outputFiles![0].text;
  mkdirSync(`${root}dist`, { recursive: true });
  writeFileSync(`${root}dist/${widget}.js`, code);
  return code;
}

if (import.meta.main) {
  const arg = process.argv[2];
  for (const widget of arg ? [resolveWidget(arg)] : listWidgets()) {
    const code = await buildWidget(widget);
    console.log(`dist/${widget}.js  ${sizeReport(code)}`);
  }
}
