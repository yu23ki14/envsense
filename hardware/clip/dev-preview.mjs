// envsense クリップ筐体 — ホットリロード dev サーバ（Node 標準モジュールのみ）
//
// 役割:
//   1) clip/ 配下の *.scad 変更を監視し、保存のたびに STL を再書き出し
//   2) clip/ を静的配信。ブラウザの preview.html が変更を検知してジオメトリだけ差し替え
//
// 使い方（OpenSCAD のパスは環境に合わせて）:
//   OPENSCAD=/tmp/squashfs-root/usr/bin/openscad node dev-preview.mjs
//   → http://localhost:8787/ を開く
//   → 任意のエディタで .scad を保存すると 3D が自動更新（カメラ位置は保持）
//
// 環境変数: OPENSCAD（既定 "openscad"） / PORT（既定 8787） / VARIANT（既定 "box"。"pebble" で石外形）

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import http from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const exportDir = join(here, 'export');
const PORT = process.env.PORT || 8787;
const OPENSCAD = process.env.OPENSCAD || 'openscad';
const VARIANT = process.env.VARIANT || 'box';

const TARGETS = [
  { mode: 'shell', out: 'clip_shell.stl' },
  { mode: 'parts', out: 'clip_parts.stl' },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.stl': 'model/stl',
  '.scad': 'text/plain; charset=utf-8',
  '.js': 'text/javascript',
};

function exportOne({ mode, out }) {
  return new Promise((res) => {
    const tmp = join(exportDir, `.tmp_${out}`);
    const args = [
      '-D',
      `variant="${VARIANT}"`,
      '-D',
      `mode="${mode}"`,
      '-o',
      tmp,
      join(here, 'clip.scad'),
    ];
    const p = spawn(OPENSCAD, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('error', (e) => {
      console.error(`openscad 起動失敗: ${e.message}`);
      res(1);
    });
    p.on('close', async (code) => {
      if (code === 0) {
        try {
          await rename(tmp, join(exportDir, out));
        } catch {}
      }
      res(code);
    });
  });
}

let running = false;
let pending = false;
async function rebuild() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const t0 = Date.now();
  process.stdout.write('書き出し中… ');
  for (const t of TARGETS) await exportOne(t);
  console.log(`完了 (${Date.now() - t0}ms)`);
  running = false;
  if (pending) {
    pending = false;
    rebuild();
  }
}

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/preview.html';
  const file = join(here, p);
  if (!resolve(file).startsWith(resolve(here))) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const st = await stat(file);
    res.setHeader('Last-Modified', st.mtime.toUTCString());
    res.setHeader('Content-Length', st.size);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') {
      res.writeHead(200);
      return res.end();
    }
    res.writeHead(200);
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await mkdir(exportDir, { recursive: true });
await rebuild();
let timer = null;
watch(here, (_ev, fn) => {
  if (fn && fn.endsWith('.scad')) {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 200);
  }
});
server.listen(PORT, () => {
  console.log(`preview: http://localhost:${PORT}/  (.scad を保存すると自動更新)`);
});
