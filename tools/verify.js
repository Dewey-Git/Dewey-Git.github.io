#!/usr/bin/env node
/**
 * ============================================================
 * tools/verify.js —— 校验通道能否被解开（本地自检，不依赖浏览器）
 * ------------------------------------------------------------
 * 使用与浏览器完全相同的 Web Crypto 路径，因此这里能解开，
 * 浏览器里就一定能解开。
 *
 * 用法：
 *   node tools/verify.js <通道id>                        # 用 data/keys.json 的数据密钥
 *   node tools/verify.js <通道id> <口令>                  # 用指定口令
 *   node tools/verify.js <通道id> --link="<分享链接>"           # 校验 v9 令牌（含密钥）
 *   node tools/verify.js <通道id> --link="<链接>" --key=<密钥>   # 分离模式：补上分享密钥
 *   node tools/verify.js <通道id> --ticket=<令牌> --key=<密钥>   # 只给令牌本体
 *
 * 示例：
 *   node tools/verify.js dating
 *   node tools/verify.js dating --link="https://x.github.io/card/private/view.html?s=.."
 * ============================================================
 */

"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const lib = require("./lib");

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
argv.forEach((a) => {
  if (a.startsWith("--")) {
    /* 只按第一个 = 切分：--link 的值里可能还有 = 与 & */
    const body = a.replace(/^--/, "");
    const eq = body.indexOf("=");
    flags[eq === -1 ? body : body.slice(0, eq)] = eq === -1 ? true : body.slice(eq + 1);
  } else {
    positional.push(a);
  }
});

const id = positional[0];
if (!id) {
  console.log('用法：node tools/verify.js <通道id> [口令] [--link="<分享链接>"]');
  process.exit(1);
}

const file = path.resolve(__dirname, "..", "private", "channels", `${id}.enc.js`);
if (!fs.existsSync(file)) {
  console.error(`✗ 找不到密文文件：${file}`);
  process.exit(1);
}

/* 在沙箱中执行 .enc.js，取出 payload */
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(file, "utf8"), sandbox);
const payload = sandbox.window.PRIVATE_CHANNELS && sandbox.window.PRIVATE_CHANNELS[id];

if (!payload) {
  console.error("✗ 密文文件中没有该通道的数据。");
  process.exit(1);
}

const b64ToBytes = (b64) => Uint8Array.from(Buffer.from(b64, "base64"));
const b64uToBytes = (s) => {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return b64ToBytes(t);
};

/* ---------- 取出口令 ---------- */
let mode = "raw";
let secret = positional[1] || "";
let token = "";
let shareKey = flags.key && flags.key !== true ? String(flags.key) : "";
if (!shareKey && (flags.ticket || flags.link)) shareKey = "";

if (flags.link && flags.link !== true) {
  const raw = String(flags.link).trim();

  /* 单参数令牌：?s=... 或直接粘贴令牌本体 */
  if (raw.indexOf("?") !== -1) {
    token = new URLSearchParams(raw.split("?")[1].split("#")[0]).get("s") || "";
  } else if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) {
    token = raw;
  }

  if (token) {
    mode = "token";
  } else {
    const q = new URLSearchParams(raw.split("?")[1] || "");
    secret = q.get("k") || "";
    const tk = q.get("p") || "";
    if (tk) {
      token = tk;
      mode = "token";
    }
  }
} else if (flags.ticket && flags.ticket !== true) {
  token = flags.ticket;
  shareKey = flags.key && flags.key !== true ? String(flags.key) : "";
  mode = "token";
} else if (!secret) {
  const keys = lib.loadKeys();
  if (keys[id]) {
    secret = keys[id];
    mode = "raw";
    console.log("（使用 data/keys.json 中的数据密钥）");
  }
}

if (!secret && !token) {
  console.error("✗ 没有可用的口令：请传入口令/链接，或先用 rotate.js 生成数据密钥。");
  process.exit(1);
}

/** 解析令牌（v9 优先，v8 兜底），返回 {dek, expiresAt, oneTime} */
function resolveToken(tk, typed) {
  if (tk.indexOf("eyJ") === 0) {
    const legacy = lib.legacyUnpack(tk);
    if (!legacy) throw new Error("旧版链接令牌不完整（很可能被截断）");
    if (legacy.c && legacy.c !== id) console.log(`（注意：链接里的通道是 ${legacy.c}）`);
    const key = typed || shareKey || legacy.k;
    if (!key) throw new Error("这是旧版分支链接，还需要分享密钥（--key=）");
    const t = lib.legacyOpenTicket(legacy.p, key);
    if (t.expiresAt && Date.now() > t.expiresAt) throw new Error("票据已过期");
    console.log(`（旧版 v8 票据 · ${t.oneTime ? "一次性" : "限时"}）`);
    return t;
  }

  let t;
  try {
    t = lib.openShareToken(tk, typed || shareKey || "");
  } catch (e) {
    if (e.message === "need-key") throw new Error("这条链接没有内嵌密钥，请用 --key=<分享密钥> 补上");
    if (e.message === "bad-key") throw new Error("分享密钥与这条链接不匹配");
    throw new Error("链接令牌不完整（很可能被截断），请整条复制");
  }
  if (t.c && t.c !== id) console.log(`（注意：链接里的通道是 ${t.c}，与命令参数 ${id} 不同）`);
  if (t.expiresAt && Date.now() > t.expiresAt) throw new Error("链接已过期");
  console.log(
    `令牌信息：${t.oneTime ? "一次性" : "限时"} · 到期 ${
      t.expiresAt ? new Date(t.expiresAt).toLocaleString("zh-CN") : "不限期"
    } · 长度 ${tk.length} 字符`
  );
  return t;
}

(async () => {
  const { subtle } = globalThis.crypto;
  const enc = new TextEncoder();

  async function derive(password, salt, usage) {
    const baseKey = await subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, [
      "deriveKey"
    ]);
    return subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: payload.iter || 200000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      usage
    );
  }

  try {
    let dek = secret;

    /* 令牌模式：先解开分享令牌拿到 DEK，再解密内容 */
    if (mode === "token") {
      dek = resolveToken(token, "").dek;
    }

    const key = await derive(dek, b64ToBytes(payload.salt), ["decrypt"]);
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(payload.iv) },
      key,
      b64ToBytes(payload.ct)
    );

    const data = JSON.parse(new TextDecoder().decode(plain));
    const sectionCount = (data.sections || []).length;
    const fieldCount = (data.sections || []).reduce((n, s) => n + (s.fields || []).length, 0);

    console.log(`
✓ 解密成功
  通道      : ${id}
  方式      : ${mode === "token" ? "分享链接（v9 令牌）" : "数据密钥 / 口令"}
  标题      : ${data.title || "(未命名)"}
  更新日期  : ${data.updated || "-"}
  分节 / 字段: ${sectionCount} / ${fieldCount}
  明文大小  : ${Buffer.byteLength(JSON.stringify(data), "utf8")} 字节
`);
  } catch (err) {
    console.error(`
✗ 解密失败：${err.message || "口令不正确，或密文已损坏"}
  通道      : ${id}
`);
    process.exit(2);
  }
})();
