#!/usr/bin/env node
/**
 * ============================================================
 * tools/rotate.js —— 加密通道内容 / 生成限时分享链接
 * ------------------------------------------------------------
 * 模型（v9）：
 *   · 内容用「数据密钥 DEK」加密，DEK 每通道一把、长期不变，存 data/keys.json
 *   · 分享链接用「分享密钥 + 令牌」：令牌里装着被分享密钥封装的 DEK，
 *     外加有效期与一次性标记，整体 base64url 后只有 72 字符
 *   · 因此换分享密钥 / 改有效期 **不需要** 重新加密，也不需要重新部署
 *
 * 用法：
 *   node tools/rotate.js <通道id>                        # 用现有 DEK 重新加密内容
 *   node tools/rotate.js <通道id> --ticket               # 再生成 24 小时分享链接
 *   node tools/rotate.js <通道id> --ticket --ttl=0.25 --one-time
 *   node tools/rotate.js <通道id> --ticket --ttl=1 --label="给张阿姨"
 *   node tools/rotate.js <通道id> --in=other.json        # 指定明文文件
 *
 * 说明：
 *   · 只想发一条临时链接，不必跑本命令——管理台（private/admin.html）
 *     输入管理员密码即可在浏览器里直接生成，立刻可用。
 *   · 本命令用于：内容改动后重新加密、或需要在终端批量生成链接。
 *
 * 安全提醒：
 *   · DEK 是主钥匙，泄露等于内容泄露；不要提交 data/keys.json
 *   · 分享密钥请通过安全渠道单独告知，不要和链接发在同一个公开渠道
 * ============================================================
 */

"use strict";

const lib = require("./lib");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = {};
args
  .filter((a) => a.startsWith("--"))
  .forEach((a) => {
    /* 只按第一个 = 切分：--link / --label 的值里可能还有 = */
    const body = a.replace(/^--/, "");
    const eq = body.indexOf("=");
    flags[eq === -1 ? body : body.slice(0, eq)] = eq === -1 ? true : body.slice(eq + 1);
  });

const channelId = positional[0];
const overrideKey = positional[1];

if (!channelId) {
  console.log(`
用法：
  node tools/rotate.js <通道id> [--ticket] [--ttl=24] [--one-time] [--label=备注]

示例：
  node tools/rotate.js dating                       重新加密（数据密钥不变）
  node tools/rotate.js dating --ticket --ttl=0.25 --one-time
`);
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-_]*$/i.test(channelId)) {
  console.error("✗ 通道 id 只能包含字母、数字、连字符和下划线。");
  process.exit(1);
}

if (overrideKey && overrideKey.length < 8) {
  console.error("✗ 数据密钥太短（至少 8 位，建议直接用自动生成的 256 位密钥）。");
  process.exit(1);
}

const bar = "─".repeat(56);

try {
  const result = lib.rotateChannel({
    channelId,
    key: overrideKey || null,
    inputPath: flags.in || undefined
  });

  console.log(`
${bar}
✓ 内容已加密 · 通道 ${result.channelId}
${bar}
  数据密钥   : ${result.dek}
  ${result.dekCreated ? "（本次新建，已写入 " + result.keysFile + "）" : "（沿用 " + result.keysFile + "）"}
  keyId      : ${result.keyId}
  密文文件   : ${result.outFile}
  轮换记录   : ${result.rotationFile}
${bar}
数据密钥是长期主钥匙：内容更新时用它重新加密，日常分享**不要**把
它发出去——请改用「分享链接」（下方或管理台生成）。
`);

  if (overrideKey) {
    console.log("⚠ 你手动指定了数据密钥，旧密文与旧链接已失效。\n");
  }

  /* ---------- 可选：同时生成一条分享链接 ---------- */
  if (flags.ticket) {
    const shareKey = lib.generateKey(); // 128 位随机分享密钥
    const oneTime = flags["one-time"] === true || flags.oneTime === true;
    /* 一次性默认 1 小时（可被 --ttl 覆盖）；限时默认 24 小时 */
    const ttlHours = flags.ttl ? Number(flags.ttl) : oneTime ? 1 : 24;

    const full = lib.buildShareToken({
      c: result.channelId,
      dek: result.dek,
      key: shareKey,
      ttlHours,
      oneTime,
      embed: true
    });
    const split = lib.buildShareToken({
      c: result.channelId,
      dek: result.dek,
      key: shareKey,
      ttlHours,
      oneTime,
      embed: false
    });

    console.log(`${bar}
✓ 分享链接已生成${oneTime ? "（一次性）" : "（限时）"}
${bar}
  有效期     : ${ttlHours} 小时，至 ${new Date(full.expiresAt).toLocaleString("zh-CN")}
  ${flags.label ? "备注       : " + flags.label + "\n  " : ""}链接地址   : private/view.html?s=${full.token}
  令牌长度   : ${full.length} 字符
${bar}
整条链接直接发给对方即可，打开就能看（密钥已包含在链接里）。

若需要「链接与密钥分开走两条渠道」，改用下面这组：
  链接 : private/view.html?s=${split.token}
  密钥 : ${shareKey}
`);
  } else {
    console.log(`需要一条临时分享链接？加 --ticket 即可：
  node tools/rotate.js ${result.channelId} --ticket --ttl=0.25 --one-time
或直接打开 private/admin.html 在浏览器里生成。
`);
  }
} catch (err) {
  console.error(`✗ 失败：${err.message}`);
  process.exit(1);
}
