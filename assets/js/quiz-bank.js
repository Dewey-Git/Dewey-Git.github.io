/**
 * 灵魂契合题库 · 加载与解密（v14）
 * ------------------------------------------------------------
 * 题库、每题分值、券码、免密钥令牌全部在 private/quiz.enc.js 里，
 * 由 tools/build-quiz.js 用下面的构建口令做 PBKDF2 + AES-256-GCM 加密。
 *
 * 安全边界（务必如实理解）：
 *   这是「防随手窥探」级别的保护——打开查看源代码看不到题目、看不到每个选项
 *   值多少分、也拿不到券码；但口令本身必须随页面下发，能读 JS 并耐心还原的人
 *   终究解得开。它的作用是抬高成本，不是密码学意义上的不可破解。
 *   真正的私密内容仍然由主密钥 / 分享令牌保护，与本题库无关。
 *
 * 改题库 / 改分值 / 换券码：
 *   1. 编辑 data/quiz.json
 *   2. node tools/build-quiz.js
 */
(function () {
  "use strict";

  var C = window.CardCrypto;

  /* BUILD-SEAL：构建口令（字符码形式，不写成明文字符串）。
   * tools/build-quiz.js 会解析这一行做加密；改动后必须重新构建，否则解不开。 */
  var SEAL = [
    115, 111, 117, 108, 46, 113, 117, 105, 122, 46, 118, 49, 46, 55, 99, 52, 101, 57, 97, 50, 98
  ];

  var PASS = String.fromCharCode.apply(null, SEAL);
  var cache = null;

  function bad(msg) {
    var e = new Error(msg || "bad-bank");
    e.bank = true;
    return e;
  }

  function check(bank) {
    if (!bank || !Array.isArray(bank.pool) || !Array.isArray(bank.final)) {
      throw bad("missing");
    }
    if (bank.pool.length < 60 || bank.final.length < 10) throw bad("size");

    [bank.pool, bank.final].forEach(function (list) {
      list.forEach(function (item) {
        if (!item || typeof item.q !== "string" || !Array.isArray(item.o) || item.o.length < 2) {
          throw bad("shape");
        }
        item.o.forEach(function (opt) {
          if (!Array.isArray(opt) || typeof opt[0] !== "string" || typeof opt[1] !== "number") {
            throw bad("option");
          }
        });
      });
    });
    return bank;
  }

  async function load() {
    if (cache) return cache;
    if (!C || !C.hasSubtle) throw bad("no-crypto");

    if (!window.SOUL_QUIZ_ENC) {
      await C.loadScript("quiz.enc.js");
    }
    if (!window.SOUL_QUIZ_ENC) throw bad("missing");

    var data;
    try {
      data = await C.decryptPayload(window.SOUL_QUIZ_ENC, PASS);
    } catch (e) {
      throw bad("decrypt");
    }

    cache = check(data);
    return cache;
  }

  window.SoulBank = {
    load: load,
    /** 单题满分（每题四个选项，最高 10 分） */
    maxScore: 10
  };
})();
