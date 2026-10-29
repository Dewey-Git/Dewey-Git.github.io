/**
 * 共享加密与工具层（v9）
 * 所有私密页（hub / view / quiz / admin）复用，保证行为一致。
 *
 * 密钥体系一共三层：
 *   1. 内容层：AES-256-GCM，密钥 = PBKDF2(数据密钥 DEK, 每通道随机 salt, 200k)
 *   2. 数据密钥 DEK：每通道一把 32 字节（64 位十六进制），长期不变，只在自己手里
 *   3. 分享层：把 DEK 用「分享密钥」派生的密钥流异或封装，附带过期时间与一次性标记
 *
 * v9 令牌 = base64url(二进制)，见 buildShareToken 的布局注释。
 * 旧版（v8）JSON 票据仍可解开，见 legacy* 函数。
 */
(function () {
  "use strict";

  var CFG = window.CARD_CONFIG || {
    sessionMinutes: 15,
    rotationHours: 24,
    oneTimeHours: 1,
    iterations: 200000,
    adminMaxAttempts: 5,
    adminLockSeconds: 30,
    adminVaultPath: "admin.vault.js"
  };

  /* ---------- 编码 ---------- */
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  /* base64url：令牌要放进 URL，不能出现 + / = */
  function b64uToBytes(s) {
    var t = String(s == null ? "" : s).replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    return b64ToBytes(t);
  }

  function bytesToB64u(bytes) {
    return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }

  function xorBytes(a, b) {
    var out = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] ^ b[i % b.length];
    return out;
  }

  function concatBytes() {
    var total = 0, i;
    for (i = 0; i < arguments.length; i++) total += arguments[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < arguments.length; i++) {
      out.set(arguments[i], off);
      off += arguments[i].length;
    }
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 内容层：PBKDF2 → AES-256-GCM ---------- */
  async function deriveKey(password, salt, iterations, usage) {
    var baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: iterations || CFG.iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      usage || ["decrypt"]
    );
  }

  async function decryptPayload(payload, password) {
    var key = await deriveKey(password, b64ToBytes(payload.salt), payload.iter || CFG.iterations, ["decrypt"]);
    var plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(payload.iv) },
      key,
      b64ToBytes(payload.ct)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /* ---------- 分享层：HMAC-SHA256 密钥流 ----------
   * 分享密钥（128 位）→ 密钥流 → 与 DEK 逐字节异或，得到「封装的 DEK」。
   * 过期时间、一次性标记、通道码都参与密钥流派生，改动任意一位都会解出错误的
   * DEK，进而在内容层 AES-GCM 校验时失败——即令牌自带完整性。
   */
  var KEK_SALT = "card.v9.kek";

  async function keyBytesOf(str) {
    var s = String(str == null ? "" : str);
    if (/^[0-9a-f]{32}$/i.test(s)) return hexToBytes(s);
    /* 非规范分享密钥（例如自定义口令）：先做 PBKDF2 拉伸，避免口令过弱 */
    var base = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(s),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    var bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode(KEK_SALT),
        iterations: 100000,
        hash: "SHA-256"
      },
      base,
      256
    );
    return new Uint8Array(bits);
  }

  async function hmacKey(bytes) {
    return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign"
    ]);
  }

  /** 由密钥流展开任意长度（HKDF-Expand 同形） */
  async function expandStream(keyBytes, info, len) {
    var hk = await hmacKey(keyBytes);
    var out = new Uint8Array(0);
    var i = 1;
    while (out.length < len) {
      var block = new Uint8Array(await crypto.subtle.sign("HMAC", hk, concatBytes(info, [i])));
      out = concatBytes(out, block);
      i += 1;
    }
    return out.subarray(0, len);
  }

  async function tagOf(keyBytes, info, wrapped) {
    var hk = await hmacKey(keyBytes);
    var buf = await crypto.subtle.sign("HMAC", hk, concatBytes(new TextEncoder().encode("T"), info, wrapped));
    return new Uint8Array(buf).subarray(0, 4);
  }

  /* ---------- v9 令牌 ----------
   * 0        : 0xB0 | flags
   *            bit0    一次性
   *            bit1-2  通道码（0 面试 / 1 相亲 / 2 测试 / 3 内联通道名）
   *            bit3    内嵌分享密钥
   * 1..4     : 过期时间（Unix 分钟，32 位大端；0 表示不限期）
   * [1 + n]  : 内联通道名（仅通道码 3）
   * 1        : DEK 长度；最高位 1 表示 DEK 是十六进制字符串
   * n        : 封装的 DEK
   * [4]      : 校验标签（仅「不内嵌密钥」时，用来区分「密钥不对」和「密文不对」）
   * [16]     : 分享密钥（仅内嵌时，固定 16 字节）
   */
  var CH_CODES = ["interview", "dating", "soul"];
  var TOKEN_MAGIC = 0xb0;

  function chCodeOf(id) {
    var i = CH_CODES.indexOf(id);
    return i === -1 ? 3 : i;
  }

  function minutesOf(ms) {
    return Math.max(0, Math.min(0xffffffff, Math.round(ms / 60000)));
  }

  async function buildShareToken(opt) {
    var c = opt.c || "dating";
    var dekStr = String(opt.dek || "");
    if (!dekStr) throw new Error("缺少数据密钥");

    var dekHex = /^[0-9a-f]{64}$/i.test(dekStr);
    var dekBytes = dekHex ? hexToBytes(dekStr) : new TextEncoder().encode(dekStr);
    if (!dekBytes.length || dekBytes.length > 64) throw new Error("数据密钥长度异常");

    var embed = opt.embed !== false;
    var keyStr = opt.key || "";
    if (!keyStr) throw new Error("缺少分享密钥");
    var keyBytes = await keyBytesOf(keyStr);
    if (embed && keyBytes.length !== 16) throw new Error("内嵌分享密钥必须是 128 位（32 位十六进制）");

    var ttlHours = Number(opt.ttlHours) || 0;
    /* 一次性令牌必须有硬性到期时间：未指定时按 1 小时签发，杜绝「永久有效的一次性链接」 */
    if (opt.oneTime && !(ttlHours > 0)) ttlHours = CFG.oneTimeHours || 1;
    var expiresAt = ttlHours > 0 ? Date.now() + Math.round(ttlHours * 3600 * 1000) : 0;
    var expMin = expiresAt ? minutesOf(expiresAt) : 0;

    var chCode = chCodeOf(c);
    var flags = (opt.oneTime ? 1 : 0) | (chCode << 1) | (embed ? 8 : 0);
    var head = [
      TOKEN_MAGIC | flags,
      (expMin >>> 24) & 0xff,
      (expMin >>> 16) & 0xff,
      (expMin >>> 8) & 0xff,
      expMin & 0xff
    ];

    var parts = [new Uint8Array(head)];
    if (chCode === 3) {
      var idBytes = new TextEncoder().encode(c);
      parts.push(new Uint8Array([idBytes.length]), idBytes);
    }
    parts.push(new Uint8Array([dekBytes.length | (dekHex ? 0x80 : 0)]));

    var info = concatBytes.apply(null, parts);
    var ks = await expandStream(keyBytes, info, dekBytes.length);
    var wrapped = xorBytes(dekBytes, ks);
    parts.push(wrapped);

    if (embed) {
      parts.push(keyBytes);
    } else {
      parts.push(await tagOf(keyBytes, info, wrapped));
    }

    var token = bytesToB64u(concatBytes.apply(null, parts));

    return {
      token: token,
      channel: c,
      expiresAt: expMin * 60000,
      ttlHours: ttlHours,
      oneTime: !!opt.oneTime,
      length: token.length
    };
  }

  /** 解开令牌。返回 {c, dek, expiresAt, oneTime}；缺密钥时抛 need-key */
  async function openShareToken(token, keyStr) {
    var bytes;
    try {
      bytes = b64uToBytes(token);
    } catch (e) {
      throw new Error("bad-token");
    }
    if (!bytes || bytes.length < 7) throw new Error("bad-token");

    var b0 = bytes[0];
    if ((b0 & 0xf0) !== TOKEN_MAGIC) throw new Error("bad-token");

    var flags = b0 & 0x0f;
    var oneTime = !!(flags & 1);
    var chCode = (flags >> 1) & 3;
    var hasKey = !!(flags & 8);
    var expMin = ((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0;

    var off = 5;
    var c = CH_CODES[chCode] || "";
    if (chCode === 3) {
      if (off >= bytes.length) throw new Error("bad-token");
      var idLen = bytes[off];
      off += 1;
      if (off + idLen > bytes.length) throw new Error("bad-token");
      c = new TextDecoder().decode(bytes.subarray(off, off + idLen));
      off += idLen;
    }

    if (off >= bytes.length) throw new Error("bad-token");
    var lenByte = bytes[off];
    off += 1;
    var dekHex = !!(lenByte & 0x80);
    var dekLen = lenByte & 0x7f;
    if (!dekLen || off + dekLen > bytes.length) throw new Error("bad-token");

    var info = bytes.subarray(0, off);
    var wrapped = bytes.subarray(off, off + dekLen);
    off += dekLen;

    var keyBytes = null;
    if (hasKey) {
      if (off + 16 > bytes.length) throw new Error("bad-token");
      keyBytes = bytes.subarray(off, off + 16);
    } else {
      if (!keyStr) {
        /* 把通道名带出去，页面可以在「补密钥」时显示正确的通道标题 */
        var needErr = new Error("need-key");
        needErr.channel = c;
        throw needErr;
      }
      keyBytes = await keyBytesOf(keyStr);
      var tag = bytes.subarray(off, off + 4);
      var want = await tagOf(keyBytes, info, wrapped);
      if (tag.length !== 4) throw new Error("bad-token");
      for (var i = 0; i < 4; i++) {
        if (tag[i] !== want[i]) throw new Error("bad-key");
      }
    }

    var ks = await expandStream(keyBytes, info, dekLen);
    var raw = xorBytes(wrapped, ks);
    var dek = dekHex ? bytesToHex(raw) : new TextDecoder().decode(raw);

    return { c: c || "dating", dek: dek, expiresAt: expMin * 60000, oneTime: oneTime };
  }

  /* ---------- v8 兼容：旧 JSON 票据 ---------- */
  function legacyUnpack(token) {
    try {
      var o = JSON.parse(new TextDecoder().decode(b64uToBytes(token)));
      if (!o || o.v !== 2) return null;
      if (!o.c && !o.k && !o.p) return null;
      return { c: o.c || "", k: o.k || "", p: o.p || "" };
    } catch (e) {
      return null;
    }
  }

  async function legacyOpenTicket(ticketStr, shareKey) {
    var t;
    try {
      t = JSON.parse(new TextDecoder().decode(b64uToBytes(ticketStr)));
    } catch (e) {
      throw new Error("bad-ticket");
    }
    if (!t || t.v !== 1 || !t.s || !t.i || !t.c) throw new Error("bad-ticket");

    var key = await deriveKey(shareKey, b64ToBytes(t.s), CFG.iterations, ["decrypt"]);
    var plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(t.i) },
      key,
      b64ToBytes(t.c)
    );

    return {
      dek: new TextDecoder().decode(plain),
      issuedAt: Number(t.t) || 0,
      expiresAt: Number(t.e) || 0,
      oneTime: !!t.o
    };
  }

  /* 令牌标识：只取摘要前 12 位，用于「已使用」标记（不落原文） */
  async function tokenId(str) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    var arr = new Uint8Array(buf).slice(0, 6);
    return bytesToHex(arr);
  }

  /* ---------- 资源加载 ---------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("load-failed")); };
      document.head.appendChild(s);
    });
  }

  async function ensureChannel(id) {
    if (window.PRIVATE_CHANNELS && window.PRIVATE_CHANNELS[id]) return window.PRIVATE_CHANNELS[id];
    await loadScript("channels/" + encodeURIComponent(id) + ".enc.js");
    var p = window.PRIVATE_CHANNELS && window.PRIVATE_CHANNELS[id];
    if (!p) throw new Error("missing");
    return p;
  }

  async function ensureVault() {
    if (window.ADMIN_VAULT) return window.ADMIN_VAULT;
    await loadScript(CFG.adminVaultPath);
    if (!window.ADMIN_VAULT) throw new Error("no-vault");
    return window.ADMIN_VAULT;
  }

  /* ---------- 轮换记录 ---------- */
  function rotationInfo(id) {
    var rec = (window.CHANNEL_ROTATION || {})[id];
    if (!rec) {
      return { configured: false, keyId: null, issuedAt: 0, scheme: null };
    }
    var issued = new Date(rec.issuedAt).getTime();
    return {
      configured: true,
      keyId: rec.keyId || null,
      issuedAt: isFinite(issued) ? issued : 0,
      scheme: rec.scheme || "dek"
    };
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function fmtDuration(ms) {
    if (!isFinite(ms)) return "—";
    if (ms <= 0) return "00:00";
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : pad2(m) + ":" + pad2(s);
  }

  /* ---------- 在线状态 ---------- */
  function isOnline() {
    return navigator.onLine !== false;
  }

  /** 离线拦截：返回 true 表示已处理（页面应停止后续逻辑） */
  function guardOffline(host) {
    if (isOnline()) return false;
    if (host) {
      host.innerHTML =
        '<div class="offline-card">' +
        '<p class="offline-title">离线无法使用</p>' +
        '<p class="offline-desc">检测到当前处于离线状态。私密内容全部加密且需要在线解密校验，' +
        "离线时仅可浏览公开名片页。</p>" +
        '<a class="btn ghost" href="../index.html">返回公开名片</a></div>';
    }
    return true;
  }

  /* ---------- 一次性链接的「已使用」标记 ---------- */
  function usedKeyId(keyId) {
    try {
      return localStorage.getItem("card-used:" + keyId) ? true : false;
    } catch (e) {
      return false;
    }
  }

  function markUsed(keyId) {
    try {
      localStorage.setItem("card-used:" + keyId, String(Date.now()));
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- 数据渲染（通用） ---------- */
  function renderPayload(data) {
    var sections = (data.sections || []).map(function (sec) {
      var rows = (sec.fields || []).map(function (f) {
        return '<div class="data-row"><dt>' + esc(f.label) + "</dt><dd>" + esc(f.value) + "</dd></div>";
      }).join("");
      return (
        '<section class="data-section">' +
        (sec.heading ? "<h3>" + esc(sec.heading) + "</h3>" : "") +
        '<dl class="data-rows">' + rows + "</dl></section>"
      );
    }).join("");

    var notes = (data.notes || []).map(function (n) {
      return "<li>" + esc(n) + "</li>";
    }).join("");

    return (
      (data.title ? '<h1 class="view-title">' + esc(data.title) + "</h1>" : "") +
      (data.updated ? '<p class="view-updated">更新于 ' + esc(data.updated) + "</p>" : "") +
      (data.intro ? '<p class="viewer-intro">' + esc(data.intro) + "</p>" : "") +
      sections +
      (notes ? '<ul class="data-notes">' + notes + "</ul>" : "")
    );
  }

  /* ---------- Toast ---------- */
  function toast(msg) {
    if (window.CardUI && window.CardUI.toast) window.CardUI.toast(msg);
  }

  window.CardCrypto = {
    b64ToBytes: b64ToBytes,
    bytesToB64: bytesToB64,
    b64uToBytes: b64uToBytes,
    bytesToB64u: bytesToB64u,
    hexToBytes: hexToBytes,
    bytesToHex: bytesToHex,
    esc: esc,
    deriveKey: deriveKey,
    decryptPayload: decryptPayload,
    buildShareToken: buildShareToken,
    openShareToken: openShareToken,
    legacyUnpack: legacyUnpack,
    legacyOpenTicket: legacyOpenTicket,
    tokenId: tokenId,
    loadScript: loadScript,
    ensureChannel: ensureChannel,
    ensureVault: ensureVault,
    rotationInfo: rotationInfo,
    fmtDuration: fmtDuration,
    isOnline: isOnline,
    guardOffline: guardOffline,
    usedKeyId: usedKeyId,
    markUsed: markUsed,
    renderPayload: renderPayload,
    toast: toast,
    cfg: CFG,
    hasSubtle: !!(window.crypto && window.crypto.subtle)
  };
})();
