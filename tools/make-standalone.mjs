// Make a single HTML file of the whole app that opens by double-click, with no server, internet or
// Claude account: the app code, its styles and every file in public/originals/ are embedded, and a
// small loader answers the app's requests for those files from the embedded copies.
//
//   npm run standalone            -> VisADLs-demo.html
//
// The file contains the MetaHuman assets and research participants' motion capture from
// public/originals/ – share it only where the participants' consent and the MetaHuman licence allow.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'VisADLs-demo.html';
execSync('npx vite build --config vite.standalone.config.ts', { stdio: 'inherit', env: { ...process.env, VITE_STANDALONE: '1' } });

const dist = 'dist-standalone';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
const js = assets.filter((f) => f.endsWith('.js'));
const css = assets.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected one script, got ${js.join(', ')}`);
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

// embedded files, keyed by the path the app asks for
const files = {};
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const key = p.replace(/^public\//, '');
    if (f.endsWith('.json')) files[key] = readFileSync(p, 'utf8');
    else files[`${key}.b64.json`] = JSON.stringify({ b64: readFileSync(p).toString('base64') });
  }
};
walk('public/originals');

const loader = `
window.__VISADLS_FILES__ = ${safe(JSON.stringify(files))};
(function () {
  var F = window.__VISADLS_FILES__, real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var i = url.indexOf('originals/');
    var key = i >= 0 ? url.slice(i).split('?')[0] : null;
    if (key && Object.prototype.hasOwnProperty.call(F, key)) {
      var head = init && init.method === 'HEAD';
      return Promise.resolve(new Response(head ? null : F[key], { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (key) return Promise.resolve(new Response('', { status: 404 }));
    return real ? real(input, init) : Promise.reject(new Error('offline'));
  };
})();`;

let page = html
  .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, '')
  .replace(/<link rel="stylesheet"[^>]*>/g, '');
const head = `<style>${css.map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n')}</style>\n<script>${loader}</script>`;
const body = `<script type="module">${safe(readFileSync(join(dist, 'assets', js[0]), 'utf8'))}</script>`;
// (functions as replacements, so '$&' and friends inside the code are left alone)
page = page.replace('</head>', () => `${head}\n</head>`).replace('</body>', () => `${body}\n</body>`);
writeFileSync(out, page);
console.log(`${out}: ${(Buffer.byteLength(page) / 1048576).toFixed(1)} MB, ${Object.keys(files).length} embedded files`);
