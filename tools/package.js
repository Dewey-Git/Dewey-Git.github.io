#!/usr/bin/env node
/**
 * ============================================================
 * tools/package.js —— 打发布包（v1.0.1 起）
 * ------------------------------------------------------------
 * 干什么：
 *   把「线上该有的样子」拼到 dist/business-card-<版本>/，
 *   再压成同名 .zip，可以直接丢给 GitHub Pages 或自己留档。
 *
 * 怎么用：
 *   node tools/package.js            # 目录 + zip
 *   node tools/package.js --no-zip   # 只要目录（部署时用得到）
 *
 * 三条硬规矩（脚本自己检查，过不了就退出码 1）：
 *   1. data/ 一律不进包 —— 那里有主密钥明文、券码明文
 *   2. 包里任何文本文件都不许出现主密钥或券码原文
 *   3. 每个 <img src> / <link href> / <script src> 都必须在包里真实存在，
 *      且大小写完全一致（GitHub Pages 跑在 Linux 上，大小写敏感）
 *
 * 压缩用 store 模式（不压缩）：整站才 300 多 KB，省掉一个第三方依赖更划算。
 * ============================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const WANT_ZIP = !process.argv.includes("--no-zip");

/* 目录级排除：这些永远不该出现在发布包里 */
const SKIP_DIRS = new Set([
  "data",           // 明文内容、keys.json、题库、免密钥令牌
  "node_modules",
  ".git",
  "dist",
  "originals",      // assets/img/originals：4MB 素材原图
  ".workbuddy",
  ".idea",
  ".vscode"
]);

const SKIP_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/* ============================================================
 * 0. 小工具
 * ============================================================ */

function readVersion() {
  const file = path.join(ROOT, "assets/js/config.js");
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(/version\s*:\s*"([^"]+)"/);
  if (!m) throw new Error("assets/js/config.js 里找不到 version 字段");
  return m[1];
}

function human(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

/* CRC32：zip 必需，表驱动，够快 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ============================================================
 * 1. 复制出一份「线上视图」
 * ============================================================ */

const files = [];   // { rel, abs, size }

function copyTree(from, to, relBase) {
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const abs = path.join(from, ent.name);
    const rel = relBase ? relBase + "/" + ent.name : ent.name;

    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      fs.mkdirSync(path.join(to, ent.name), { recursive: true });
      copyTree(abs, path.join(to, ent.name), rel);
      continue;
    }

    if (SKIP_FILES.has(ent.name)) continue;
    if (/\.(log|zip)$/i.test(ent.name)) continue;

    fs.copyFileSync(abs, path.join(to, ent.name));
    files.push({ rel, abs: path.join(to, ent.name), size: fs.statSync(abs).size });
  }
}

/* ============================================================
 * 2. 安全检查
 * ============================================================ */

/* 从本地 data/ 里取出「不该出现在包里」的字符串 */
function forbiddenStrings() {
  const out = [];
  const keysFile = path.join(ROOT, "data/keys.json");
  if (fs.existsSync(keysFile)) {
    const keys = JSON.parse(fs.readFileSync(keysFile, "utf8"));
    for (const [id, key] of Object.entries(keys)) {
      if (typeof key === "string" && key.length >= 8) out.push({ what: "主密钥（" + id + "）", value: key });
    }
  }
  const quizFile = path.join(ROOT, "data/quiz.json");
  if (fs.existsSync(quizFile)) {
    const quiz = JSON.parse(fs.readFileSync(quizFile, "utf8"));
    for (const [name, code] of Object.entries(quiz.coupons || {})) {
      if (typeof code === "string" && code.length >= 6) out.push({ what: "券码（" + name + "）", value: code });
    }
  }
  return out;
}

const TEXT_EXT = /\.(html|js|css|json|md|txt|svg|xml|webmanifest)$/i;

function scanLeaks(list, forbidden) {
  const hits = [];
  if (!forbidden.length) return hits;
  for (const f of list) {
    if (!TEXT_EXT.test(f.rel)) continue;
    const text = fs.readFileSync(f.abs, "utf8");
    for (const item of forbidden) {
      if (text.includes(item.value)) hits.push(f.rel + " ← " + item.what);
    }
  }
  return hits;
}

/* ============================================================
 * 3. 引用校验（存在性 + 大小写）
 * ============================================================ */

function listDirNames(dir) {
  try {
    return new Set(fs.readdirSync(dir, { withFileTypes: true }).map((e) => e.name));
  } catch (e) {
    return new Set();
  }
}

/**
 * 逐段比对真实文件名：Windows 上大小写写错也能读到文件，
 * 但推上 GitHub Pages（Linux）就是 404 —— 只能在这里提前抓。
 */
function resolveExact(rootDir, relPath) {
  const parts = relPath.split("/").filter(Boolean);
  let cur = rootDir;
  for (const part of parts) {
    const names = listDirNames(cur);
    if (!names.has(part)) return { ok: false, at: part, cur };
    cur = path.join(cur, part);
  }
  return { ok: true };
}

function scanRefs(rootDir, list) {
  const problems = [];
  const attrs = /(?:src|href)\s*=\s*"([^"]+)"/gi;

  for (const f of list) {
    if (!/\.html$/i.test(f.rel)) continue;
    const html = fs.readFileSync(f.abs, "utf8");
    const dir = path.posix.dirname(f.rel);

    attrs.lastIndex = 0;
    let m;
    while ((m = attrs.exec(html))) {
      const raw = m[1].trim();
      /* 跳过外链、锚点、协议、站点根绝对路径 */
      if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(raw)) continue;
      const clean = raw.split("#")[0].split("?")[0];
      if (!clean) continue;

      const target = path.posix
        .normalize(path.posix.join(dir === "." ? "" : dir, clean))
        .replace(/^\.\//, "");
      const r = resolveExact(rootDir, target);
      if (!r.ok) {
        problems.push(f.rel + " → " + raw + "（包里找不到 " + r.at + "，或大小写不一致）");
      }
    }
  }
  return problems;
}

/* ============================================================
 * 4. zip（store 模式）
 * ============================================================ */

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function writeZip(pkgDir, pkgName, zipPath, list) {
  const now = new Date();
  const { time, date } = dosTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const item of list) {
    const nameBuf = Buffer.from(pkgName + "/" + item.rel, "utf8");
    const raw = fs.readFileSync(item.abs);
    const crc = crc32(raw);

    /* 先试 deflate，压不下去（图片之类）就退回 store */
    let payload = zlib.deflateRawSync(raw, { level: 9 });
    let method = 8;
    if (payload.length >= raw.length) {
      payload = raw;
      method = 0;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);         // version needed
    local.writeUInt16LE(0x0800, 6);     // UTF-8 文件名
    local.writeUInt16LE(method, 8);     // 0 = store, 8 = deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);       // version made by
    central.writeUInt16LE(20, 6);       // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);       // extra
    central.writeUInt16LE(0, 32);       // comment
    central.writeUInt16LE(0, 34);       // disk
    central.writeUInt16LE(0, 36);       // internal attr
    central.writeUInt32LE(0, 38);       // external attr
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(list.length, 8);
  eocd.writeUInt16LE(list.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralBuf, eocd]));
}

/* ============================================================
 * 主流程
 * ============================================================ */

function main() {
  const version = readVersion();
  const pkgName = "business-card-" + version;
  const pkgDir = path.join(DIST, pkgName);

  /* 不整目录删除：同版本重打就覆盖写，多余文件留到下面提示，避免误删 */
  fs.mkdirSync(pkgDir, { recursive: true });

  copyTree(ROOT, pkgDir, "");
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  /* 包根放一个版本戳，线上访问 /VERSION.txt 就能确认是哪一版 */
  const stamp = "business-card v" + version + "\nbuilt " + new Date().toISOString() + "\n";
  fs.writeFileSync(path.join(pkgDir, "VERSION.txt"), stamp);
  files.push({ rel: "VERSION.txt", abs: path.join(pkgDir, "VERSION.txt"), size: Buffer.byteLength(stamp) });

  /* --- 检查 --- */
  const errors = [];

  if (fs.existsSync(path.join(pkgDir, "data"))) {
    errors.push("包里出现了 data/ 目录 —— 主密钥和券码都在里面，绝对不能上传");
  }

  const leaked = scanLeaks(files, forbiddenStrings());
  for (const h of leaked) errors.push("明文泄漏： " + h);

  const refProblems = scanRefs(pkgDir, files);
  for (const p of refProblems) errors.push("引用异常： " + p);

  /* 包内是否残留「上一版有、这一版没有」的文件（脚本不删，只把话说清楚） */
  const expected = new Set(files.map((f) => f.rel));
  const extras = [];
  (function walk(dir, base) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? base + "/" + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (!expected.has(rel)) extras.push(rel);
    }
  })(pkgDir, "");

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const biggest = files.slice().sort((a, b) => b.size - a.size)[0];

  const line = "─".repeat(56);

  if (errors.length) {
    console.error(line);
    console.error("✗ 打包失败，先修下面这几条：");
    console.error(line);
    errors.forEach((e) => console.error("  · " + e));
    console.error("");
    process.exit(1);
  }

  let zipPath = "";
  let zipSize = 0;
  if (WANT_ZIP) {
    zipPath = path.join(DIST, pkgName + ".zip");
    writeZip(pkgDir, pkgName, zipPath, files);
    zipSize = fs.statSync(zipPath).size;
  }

  console.log(line);
  console.log("✓ 发布包已生成 · v" + version);
  console.log(line);
  console.log("  目录       : " + path.relative(ROOT, pkgDir));
  if (zipPath) console.log("  压缩包     : " + path.relative(ROOT, zipPath) + "（" + human(zipSize) + "）");
  console.log("  文件数     : " + files.length + " 个 / " + human(totalBytes));
  console.log("  最大文件   : " + biggest.rel + "（" + human(biggest.size) + "）");
  console.log("  引用校验   : " + "全部命中，大小写一致");
  console.log("  泄漏检查   : " + "未发现主密钥 / 券码明文");
  console.log("  排除       : data/ · assets/img/originals/ · node_modules/ · .git/ · dist/");
  if (extras.length) {
    console.log("  ⚠ 残留     : " + extras.length + " 个上次打进包、这次源目录里已经没有的文件：");
    extras.slice(0, 8).forEach((e) => console.log("              " + e));
    if (extras.length > 8) console.log("              …还有 " + (extras.length - 8) + " 个");
    console.log("              确认不需要就手动删掉（脚本不自动删文件）");
  }
  console.log(line);
  console.log("下一步：把目录内容推成一个仓库，Pages 指向 main / root。");
  console.log("步骤见 docs/deploy-v1.0.1.md（含 gh 命令与自检清单）。");
  console.log("");
}

try {
  main();
} catch (err) {
  console.error("✗ 打包中断：" + err.message);
  process.exit(1);
}
