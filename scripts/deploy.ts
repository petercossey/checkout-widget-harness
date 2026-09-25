// npm run deploy -- <widget>             build + create/update its Script Manager entry (inline)
// npm run deploy -- <widget> --hosted    upload to WebDAV /content/ and reference it with an SRI hash
// npm run deploy -- <widget> --disable | --enable | --remove
// npm run deploy -- --list
//
// Each widget maps to one Script Manager entry named "cwh-<widget>": visibility checkout, footer, essential.
// Changes reach shoppers within ~20s (Script Manager cache). Each change also posts a control-panel notification.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWidget } from './build.ts';
import { resolveWidget, sizeReport } from './lib/bundle.ts';
import { api, credentials, storefrontUrl } from './lib/env.ts';

interface Script {
  uuid: string;
  name: string;
  kind: 'src' | 'script_tag';
  src: string;
  enabled: boolean;
  integrity_hashes: string[];
  date_modified: string;
  visibility: string;
}

const INLINE_LIMIT = 65536;
const HOSTED_DIR = 'content/checkout-widget-harness';
const args = process.argv.slice(2);
const has = (flag: string) => args.includes(`--${flag}`);

const listScripts = async () => (await api<{ data: Script[] }>('/v3/content/scripts?limit=250')).data;
const scriptName = (widget: string) => `cwh-${widget}`;

if (has('list')) {
  const scripts = (await listScripts()).filter((s) => s.name.startsWith('cwh-'));
  if (!scripts.length) console.log('no cwh-* scripts on this store');
  for (const s of scripts) console.log(`${s.enabled ? '●' : '○'} ${s.name}  ${s.kind === 'src' ? 'hosted' : 'inline'}  ${s.visibility}  modified ${s.date_modified}  ${s.uuid}`);
  process.exit(0);
}

const widget = resolveWidget(args.find((a) => !a.startsWith('--')));
const existing = (await listScripts()).find((s) => s.name === scriptName(widget));

if (has('disable') || has('enable') || has('remove')) {
  if (!existing) throw new Error(`No Script Manager entry "${scriptName(widget)}" to change.`);
  if (has('remove')) {
    await api(`/v3/content/scripts/${existing.uuid}`, { method: 'DELETE' });
    console.log(`removed ${existing.name}`);
  } else {
    await api(`/v3/content/scripts/${existing.uuid}`, { method: 'PUT', body: JSON.stringify({ enabled: has('enable') }) });
    console.log(`${has('enable') ? 'enabled' : 'disabled'} ${existing.name}`);
  }
  process.exit(0);
}

const code = await buildWidget(widget);
console.log(`built ${widget} ${sizeReport(code)}`);

const common = {
  name: scriptName(widget),
  description: `checkout-widget-harness · ${code.match(/checkout-widget-harness (\S+)/)?.[1] ?? widget}`,
  location: 'footer',
  visibility: 'checkout',
  consent_category: 'essential',
  enabled: true,
  channel_id: 1,
};

const body = has('hosted') ? { ...common, ...(await uploadHosted(code)) } : { ...common, ...inline(code) };
// The API can't switch an entry between inline and hosted, so switching modes replaces the entry.
const replace = existing && existing.kind !== body.kind;
if (replace) await api(`/v3/content/scripts/${existing.uuid}`, { method: 'DELETE' });
const saved = existing && !replace
  ? await api<{ data: Script }>(`/v3/content/scripts/${existing.uuid}`, { method: 'PUT', body: JSON.stringify(body) })
  : await api<{ data: Script }>('/v3/content/scripts', { method: 'POST', body: JSON.stringify(body) });

console.log(`${replace ? 'replaced' : existing ? 'updated' : 'created'} ${saved.data.name} (${saved.data.kind === 'src' ? `hosted: ${saved.data.src}` : 'inline'}) ${saved.data.uuid}`);
console.log(`live on ${await storefrontUrl()}/checkout within ~20s · verify: npm run smoke -- ${widget} --deployed`);

function inline(code: string) {
  const html = `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
  if (html.length > INLINE_LIMIT) throw new Error(`Inline script is ${html.length} chars (limit ${INLINE_LIMIT}). Use --hosted.`);
  return { kind: 'script_tag', html, load_method: 'default', integrity_hashes: [] as string[] };
}

/** Uploads an immutable, content-hashed file and returns the Script Manager fields with an SRI hash. */
async function uploadHosted(code: string) {
  const digest = (algo: string, encoding: 'hex' | 'base64') => createHash(algo).update(code).digest(encoding);
  const file = `${widget}.${digest('sha256', 'hex').slice(0, 10)}.js`;
  const dav = credentials.required('store_webdav_path').replace(/\/$/, '');
  const auth = `${credentials.required('webdav_username')}:${credentials.required('webdav_password')}`;
  const tmp = join(tmpdir(), file);
  writeFileSync(tmp, code);
  const curl = (...curlArgs: string[]) => execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--digest', '-u', auth, ...curlArgs]).toString();
  curl('-X', 'MKCOL', `${dav}/${HOSTED_DIR}/`); // 201 created or 405 already exists; both are fine
  const status = curl('-T', tmp, `${dav}/${HOSTED_DIR}/${file}`);
  if (!['200', '201', '204'].includes(status)) throw new Error(`WebDAV upload failed: HTTP ${status}`);

  const src = `${await storefrontUrl()}/${HOSTED_DIR}/${file}`;
  const served = await (await fetch(src)).text();
  if (served !== code) throw new Error(`Uploaded file at ${src} doesn't match the build. Not updating Script Manager.`);
  return { kind: 'src', src, load_method: 'defer', integrity_hashes: [`sha384-${digest('sha384', 'base64')}`] };
}
