#!/usr/bin/env node
/**
 * tools/encrypt.js —— 兼容入口
 * ------------------------------------------------------------
 * 加密逻辑已统一到 tools/rotate.js（同时维护密钥轮换记录）。
 * 本文件仅做转发，保证旧命令仍然可用：
 *
 *   node tools/encrypt.js data/dating.json dating "口令"
 *     ↓
 *   node tools/rotate.js dating "口令" --in=data/dating.json
 * ============================================================
 */

"use strict";

const args = process.argv.slice(2);

if (args.length < 3) {
  console.log(`
encrypt.js 已并入 rotate.js，推荐直接用：

  node tools/rotate.js <通道id> ["密钥"]

旧式用法仍可用：
  node tools/encrypt.js <明文json> <通道id> <密钥>
`);
  process.exit(1);
}

const [inputPath, channelId, password] = args;

console.log("→ 转发到 tools/rotate.js\n");

process.argv = [
  process.argv[0],
  process.argv[1],
  channelId,
  password,
  `--in=${inputPath}`
];

require("./rotate.js");
