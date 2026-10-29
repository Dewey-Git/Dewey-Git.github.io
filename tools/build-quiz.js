#!/usr/bin/env node
/**
 * ============================================================
 * tools/build-quiz.js —— 构建加密题库（v14）
 * ------------------------------------------------------------
 * 把 data/quiz.json（70 题：60 随机池 + 10 终局固定）连同
 *   · 每题每个选项的分值
 *   · 三档结果对应的券码
 *   · 40 题达到 370 分后才给的「免密钥」令牌
 * 一起加密成 private/quiz.enc.js，页面上一个字都看不到明文。
 *
 * 用法：
 *   node tools/build-quiz.js                 # 重新加密（令牌保持不变则复用）
 *   node tools/build-quiz.js --new-token     # 同时换一枚新的免密钥令牌
 *   node tools/build-quiz.js --dry           # 只校验，不写文件
 *
 * 说明：
 *   · 令牌内嵌 soul 通道的数据密钥，有效期不限（expiresAt = 0）。
 *     它是「答到 370 分才发给你」的入场券，等价于一条长期分享链接。
 *   · 构建口令取自 assets/js/quiz-bank.js 里的 BUILD-SEAL 字符码，两处自动对齐。
 *   · 换题库/换券码/换令牌后，都需要重新跑本命令并一起提交产物。
 * ============================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const lib = require("./lib");

const ROOT = lib.ROOT;
const SRC = path.join(ROOT, "data", "quiz.json");
const BANK_JS = path.join(ROOT, "assets", "js", "quiz-bank.js");
const OUT = path.join(ROOT, "private", "quiz.enc.js");
/* 奖励令牌必须存在密文之外才能复用：密文里的 token 取不出来。
 * 这里放本地旁路文件（data/ 已在 .gitignore 里，不会进仓库）。 */
const TOKEN_FILE = path.join(ROOT, "data", "quiz-token.txt");

const ITER = 120000; /* 页面启动时只解一次，比内容层低一些，兼顾手机 */

const args = process.argv.slice(2);
const flags = {};
args.forEach((a) => {
  if (a.startsWith("--")) flags[a.replace(/^--/, "")] = true;
});

const bar = "─".repeat(56);

function readSeal() {
  const src = fs.readFileSync(BANK_JS, "utf8");
  const m = src.match(/var SEAL = \[([0-9,\s]+)\]/);
  if (!m) throw new Error("没在 assets/js/quiz-bank.js 里找到 BUILD-SEAL");
  const codes = m[1]
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (codes.length < 8) throw new Error("构建口令太短");
  return String.fromCharCode.apply(null, codes);
}

function validate(bank) {
  const problems = [];
  const warnings = [];
  if (bank.pool.length !== 60) problems.push(`随机池应为 60 题，实际 ${bank.pool.length}`);
  if (bank.final.length !== 10) problems.push(`终局固定题应为 10 题，实际 ${bank.final.length}`);

  let totalOptions = 0;
  const texts = new Set();

  const walk = (list, tag) => {
    list.forEach((item, i) => {
      if (!item || typeof item.q !== "string" || !item.q.trim()) {
        problems.push(`${tag}#${i + 1} 缺少题干`);
        return;
      }
      if (texts.has(item.q)) problems.push(`${tag}#${i + 1} 题干重复：${item.q.slice(0, 14)}`);
      texts.add(item.q);

      if (!Array.isArray(item.o) || item.o.length !== 4) {
        problems.push(`${tag}#${i + 1} 应为 4 个选项`);
        return;
      }
      const used = new Set();
      item.o.forEach((o, j) => {
        if (!Array.isArray(o) || typeof o[0] !== "string" || !o[0].trim()) {
          problems.push(`${tag}#${i + 1} 选项 ${j + 1} 缺少文案`);
          return;
        }
        const s = o[1];
        if (!Number.isInteger(s) || s < 0 || s > 10) {
          problems.push(`${tag}#${i + 1} 选项 ${j + 1} 分值应为 0–10 的整数`);
        }
        /* 同一题里两个选项同分是允许的（两种回答同样合拍），只提示不拦 */
        if (used.has(s)) warnings.push(`${tag}#${i + 1} 有两项同为 ${s} 分`);
        used.add(s);
        totalOptions += 1;
      });
      const max = Math.max.apply(null, item.o.map((o) => o[1]));
      if (max !== 10) problems.push(`${tag}#${i + 1} 满分应为 10，实际 ${max}`);
    });
  };

  walk(bank.pool, "池");
  walk(bank.final, "终局");

  const rules = bank.rules || {};
  const s1 = rules.s1 || {};
  const s2 = rules.s2 || {};
  if (s1.size !== 5 || s2.size !== 10 || (rules.s3 && rules.s3.size !== 25)) {
    problems.push("rules 里的分段题数应为 5 / 10 / 25");
  }
  /* 40 题满分必须正好等于 400，否则 370 / 400 的门槛没有意义 */
  const full = (s1.size || 5) * 10 + (s2.size || 10) * 10 + ((rules.s3 && rules.s3.size) || 25) * 10;
  if (full !== 400) problems.push(`40 题满分应为 400，实际 ${full}`);

  const coupons = bank.coupons || {};
  ["tea", "dinner", "wish"].forEach((k) => {
    if (!coupons[k]) problems.push(`缺少券码：${k}`);
  });

  return { problems, warnings, totalOptions };
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`✗ 找不到 ${path.relative(ROOT, SRC)}`);
    process.exit(1);
  }

  const bank = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const { problems, warnings, totalOptions } = validate(bank);

  if (problems.length) {
    console.error(`${bar}\n✗ 题库校验未通过（${problems.length} 项）\n${bar}`);
    problems.forEach((p) => console.error("  · " + p));
    process.exit(1);
  }

  /* ---------- 免密钥令牌 ----------
   * 复用上一枚（除非 --new-token），避免每次构建都把奖励链接换掉。
   */
  let token = "";
  if (!flags["new-token"] && fs.existsSync(TOKEN_FILE)) {
    token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) token = "";
  }
  if (!token) {
    const dek = lib.ensureDek("soul");
    const shareKey = lib.generateKey();
    token = lib.buildShareToken({
      c: "soul",
      dek,
      key: shareKey,
      ttlHours: 0, /* 不限时：奖品不该过期 */
      oneTime: false,
      embed: true
    }).token;
    fs.writeFileSync(TOKEN_FILE, token + "\n", "utf8");
  }

  const payload = {
    v: 1,
    title: bank.title,
    intro: bank.intro,
    rules: bank.rules,
    coupons: bank.coupons,
    unlock: {
      token: token,
      label: "测试解锁 · 长期有效"
    },
    pool: bank.pool,
    final: bank.final
  };

  const pass = readSeal();
  const enc = lib.encryptJSON(JSON.stringify(payload), pass, {
    iter: ITER,
    kind: "soul-quiz"
  });

  if (flags.dry) {
    console.log(`${bar}\n✓ 校验通过（未写文件）\n${bar}`);
    console.log(`  题量       : 60 + 10 = 70（每次抽 5 + 10 + 15 随机 + 10 固定 = 40）`);
    console.log(`  选项总数   : ${totalOptions}`);
    console.log(`  密文大小   : ${Buffer.byteLength(JSON.stringify(enc))} 字节\n`);
    return;
  }

  fs.writeFileSync(
    OUT,
    `/* AUTO-GENERATED by tools/build-quiz.js — 请勿手工编辑 */\n` +
      `/* 70 题 · ${new Date().toISOString()} · iter ${ITER} */\n` +
      `window.SOUL_QUIZ_ENC = ` +
      JSON.stringify(enc, null, 2) +
      ";\n",
    "utf8"
  );

  const size = fs.statSync(OUT).size;
  console.log(`${bar}
✓ 题库已加密 · 灵魂契合
${bar}
  题库       : ${bank.pool.length} 随机 + ${bank.final.length} 固定 = ${bank.pool.length + bank.final.length} 题
  选项总数   : ${totalOptions}
  分段       : 5 → 10 → 25（其中最后 10 题为固定题）
  券码       : 奶茶 ${bank.coupons.tea} / 吃饭 ${bank.coupons.dinner} / 愿望 ${bank.coupons.wish}
  免密钥令牌 : ${token.slice(0, 18)}…（${token.length} 字符，不限时，存在 ${path.relative(ROOT, TOKEN_FILE)}）
  密文文件   : ${path.relative(ROOT, OUT)}（${(size / 1024).toFixed(1)} KB）
${bar}
换题库 / 换分值 / 换券码后都要重跑本命令；--new-token 会重新签发奖励令牌。
${warnings.length ? "（提示：同题同分 " + warnings.length + " 处，属正常）\n" : ""}`);
}

try {
  main();
} catch (err) {
  console.error(`✗ 失败：${err.message}`);
  process.exit(1);
}
