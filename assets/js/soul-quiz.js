/**
 * 灵魂契合测试 · 分阶段引擎（v14）
 * ------------------------------------------------------------
 * 题目与分值都在密文里（private/quiz.enc.js），本文件只负责流程：
 *
 *   第一段  5 题  满分 50
 *     ≤30  → 直接出结果：「不算契合，但正好互补」（不再往下问）
 *     =50  → 完全契合，好感 +2，必须继续
 *     其他 → 好感 +1，可选继续；不答则按「中等契合」收尾
 *
 *   第二段  +10 题  累计满分 150
 *     ≤90  → 中等匹配，收尾
 *     =150 → 完全契合，好感 +2，必须继续
 *     其他 → 好感 +1，可选继续；不答则按「高等契合」收尾
 *
 *   第三段  +25 题（其中最后 10 题固定）  累计满分 400
 *     <300      → 高契合，赠奶茶券
 *     300–369   → 请吃饭券
 *     370–399   → 解锁隐藏内容，凭令牌免密钥进入
 *     =400      → 再加一个愿望券
 *
 * 抽题：从 60 题的池里随机抽 5 + 10 + 15（不重复），最后 10 题固定，共 40 题。
 * 进度存在 sessionStorage（关掉标签页即失效），刷新不丢。
 */
(function () {
  "use strict";

  var C = window.CardCrypto;
  var root = document.getElementById("quizRoot");
  if (!root || !C || !window.SoulBank) return;

  var SKEY = "card-quiz-v1";

  var bank = null;
  var rules = null;
  var state = null;

  /* ---------- 结果档位文案 ---------- */
  var TIERS = {
    comp: {
      kicker: "性格互补",
      title: "我们不太像，但正好补得上",
      desc:
        "这几道题几乎每一道，你都选了和我相反的方向。听起来像坏消息，其实未必——" +
        "我慢的时候你可以推我一把，你快的时候我可以拉住你。太像的两个人容易一起走错路，" +
        "互补的两个人至少还有个人看看地图。所以这一轮不算契合，算合适。"
    },
    mid: {
      kicker: "中等契合",
      title: "合得来，但还差一些火候",
      desc:
        "前 5 题里我们有对有错，属于「能聊，但要磨合」的那一类。你选择先停在这里，" +
        "那我也不追问。剩下的题目不会跑，想接着答随时回来。"
    },
    mid15: {
      kicker: "中等匹配",
      title: "中等匹配 · 值得再聊一次",
      desc:
        "15 题下来，我们的答案有一半左右对得上。这个分数不高不低，恰好是" +
        "「相处起来没有大雷，但要认真谈谈价值观」的位置。如果你愿意，带着这份结果来问我吧。"
    },
    high: {
      kicker: "高等契合",
      title: "高等契合 · 已经很少见",
      desc:
        "15 题过了 90 分，说明在多数日常选择和处事方式上，我们的方向是一致的。" +
        "你选择停在这里，我尊重。不过说实话，剩下那 25 题才是我真正在意的问题。"
    },
    tea: {
      kicker: "高契合",
      title: "高契合 · 先请你喝杯奶茶",
      desc:
        "40 题走完，我们的重合度不低。这个分数放在现实里，已经足够支撑一次不尴尬的见面。" +
        "奶茶券在这里，随时可以兑现——但你得先来找我要。",
      coupon: "tea",
      couponLabel: "请喝奶茶",
      couponHint: "见面时出示这串就行，不限门店、不限口味。"
    },
    dinner: {
      kicker: "请吃饭",
      title: "300 分以上 · 这顿我请",
      desc:
        "能答到 300 分以上，说明在钱、家人、边界这些真正会吵架的事情上，我们基本同频。" +
        "这种事不常见，所以值得一顿正经的饭——不是外卖，是坐下来慢慢吃的那种。",
      coupon: "dinner",
      couponLabel: "请吃饭",
      couponHint: "挑个日子，把这串发给我，剩下的我来安排。"
    },
    hidden: {
      kicker: "解锁隐藏内容",
      title: "370 分以上 · 你可以不用密钥进来了",
      desc:
        "这个分数意味着我们在几乎所有要紧的问题上都给了同一个答案。" +
        "所以那扇门对你不需要钥匙——下面这个入口是长期有效的，" +
        "点开就是灵魂契合的完整内容，不用再问我要口令。",
      unlock: true
    },
    wish: {
      kicker: "满分 · 一个愿望",
      title: "400 分 · 你可以提一个愿望",
      desc:
        "全对。40 题一道没错，这件事的概率低到我不太相信是巧合。" +
        "所以除了那份完整内容，你还拿到一个愿望——只要不违法、不过分，我都会认真去做。",
      coupon: "wish",
      couponLabel: "一个愿望",
      couponHint: "想好了再告诉我，这串只用一次。",
      unlock: true
    }
  };

  /* ---------- 判定（纯函数，便于单独测试） ---------- */
  function judge(stage, cum, R) {
    R = R || rules || {};

    if (stage === 1) {
      var stop1 = (R.s1 && R.s1.stopBelow) || 31;
      var perfect1 = (R.s1 && R.s1.perfect) || 50;
      if (cum < stop1) return { end: true, tier: "comp" };
      if (cum >= perfect1) return { affinity: 2, must: true, tier: "perfect" };
      return { affinity: 1, must: false, stopTier: "mid" };
    }

    if (stage === 2) {
      var stop2 = (R.s2 && R.s2.stopBelow) || 91;
      var perfect2 = (R.s2 && R.s2.perfect) || 150;
      if (cum < stop2) return { end: true, tier: "mid15" };
      if (cum >= perfect2) return { affinity: 2, must: true, tier: "perfect" };
      return { affinity: 1, must: false, stopTier: "high" };
    }

    var wish = R.wish || 400;
    var dinner = R.dinner || 370;
    var tea = R.tea || 300;
    if (cum >= wish) return { end: true, tier: "wish" };
    if (cum >= dinner) return { end: true, tier: "hidden" };
    if (cum >= tea) return { end: true, tier: "dinner" };
    return { end: true, tier: "tea" };
  }

  /* ---------- 抽题 ---------- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function buildRun(b) {
    var R = b.rules || {};
    var s1 = (R.s1 && R.s1.size) || 5;
    var s2 = (R.s2 && R.s2.size) || 10;
    var s3 = ((R.s3 && R.s3.size) || 25) - (b.final.length || 10);

    var pool = shuffle(
      b.pool.map(function (item, i) {
        return { id: "p" + i, q: item.q, o: item.o, stage: 0 };
      })
    );

    var picked = [];
    pool.slice(0, s1).forEach(function (x) {
      x.stage = 1;
      picked.push(x);
    });
    pool.slice(s1, s1 + s2).forEach(function (x) {
      x.stage = 2;
      picked.push(x);
    });
    pool.slice(s1 + s2, s1 + s2 + s3).forEach(function (x) {
      x.stage = 3;
      picked.push(x);
    });
    /* 终局 10 题固定出现，内部顺序仍然打乱，避免每次都一样 */
    shuffle(
      b.final.map(function (item, i) {
        return { id: "f" + i, q: item.q, o: item.o, stage: 3 };
      })
    ).forEach(function (x) {
      picked.push(x);
    });

    return {
      ids: picked.map(function (x) {
        return x.id;
      }),
      answers: {},
      idx: 0,
      affinity: 0,
      phase: "question",
      gate: null,
      result: null,
      startedAt: Date.now()
    };
  }

  function questionOf(id) {
    if (!bank) return null;
    var i;
    if (id.charAt(0) === "p") {
      i = Number(id.slice(1));
      var item = bank.pool[i];
      return item ? { id: id, q: item.q, o: item.o } : null;
    }
    i = Number(id.slice(1));
    var f = bank.final[i];
    return f ? { id: id, q: f.q, o: f.o } : null;
  }

  function scoreOf(id, pick) {
    var q = questionOf(id);
    if (!q || !q.o[pick]) return 0;
    return q.o[pick][1];
  }

  function totals() {
    var out = { 5: 0, 15: 0, 40: 0 };
    state.ids.forEach(function (id, i) {
      var pick = state.answers[id];
      if (typeof pick !== "number") return;
      var s = scoreOf(id, pick);
      if (i < 5) out[5] += s;
      if (i < 15) out[15] += s;
      out[40] += s;
    });
    return out;
  }

  /* ---------- 持久化 ---------- */
  function save() {
    try {
      sessionStorage.setItem(SKEY, JSON.stringify(state));
    } catch (e) {
      /* 隐私模式下写不进去，忽略 */
    }
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(SKEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.ids) || s.ids.length !== 40) return null;
      /* 题库换过（抽到的题解不出来）就作废这次进度 */
      for (var i = 0; i < s.ids.length; i++) {
        if (!questionOf(s.ids[i])) return null;
      }
      return s;
    } catch (e) {
      return null;
    }
  }

  function clearSaved() {
    try {
      sessionStorage.removeItem(SKEY);
    } catch (e) {
      /* noop */
    }
  }

  /* ---------- 渲染：题面 ---------- */
  var STAGE_LABEL = ["", "第一段 · 5 题", "第二段 · 10 题", "第三段 · 25 题"];

  function affinityChip() {
    if (!state.affinity) return "";
    return '<span class="affinity">契合 +' + state.affinity + "</span>";
  }

  function render() {
    if (!state) return;
    if (state.phase === "result") return renderResult();
    if (state.phase === "gate") return renderGate();
    renderQuestion();
  }

  function renderQuestion() {
    var idx = state.idx;
    var q = questionOf(state.ids[idx]);
    if (!q) return renderBroken();

    var no = idx + 1;
    var stage = idx < 5 ? 1 : idx < 15 ? 2 : 3;
    var pct = Math.round((idx / state.ids.length) * 100);

    var opts = q.o
      .map(function (o, i) {
        return (
          '<button class="q-choice" type="button" data-pick="' + i + '">' +
          '<span class="q-key">' + "ABCD".charAt(i) + "</span>" +
          "<span>" + C.esc(o[0]) + "</span></button>"
        );
      })
      .join("");

    root.innerHTML =
      '<div class="quiz-shell">' +
      '<header class="quiz-top">' +
      '<p class="gate-kicker">Soul Match · ' + STAGE_LABEL[stage] + "</p>" +
      '<div class="quiz-bar" role="progressbar" aria-valuemin="0" aria-valuemax="40" ' +
      'aria-valuenow="' + no + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="quiz-row"><span>第 ' + no + " / " + state.ids.length + " 题</span>" +
      affinityChip() + "</div>" +
      "</header>" +
      '<section class="q-card">' +
      '<h1 class="q-text">' + C.esc(q.q) + "</h1>" +
      '<div class="q-opts" role="group" aria-label="选项">' + opts + "</div>" +
      "</section>" +
      '<footer class="quiz-foot">' +
      '<button class="back-link" type="button" data-act="back"' +
      (idx === 0 ? " disabled" : "") + ">← 上一题</button>" +
      '<a class="back-link" href="index.html">退出测试</a>' +
      "</footer></div>";

    bindQuestion();
  }

  function bindQuestion() {
    var opts = root.querySelectorAll("[data-pick]");
    var locked = false;

    Array.prototype.forEach.call(opts, function (btn) {
      btn.addEventListener("click", function () {
        if (locked) return;
        locked = true;
        var pick = Number(btn.getAttribute("data-pick"));
        btn.classList.add("is-picked");
        Array.prototype.forEach.call(opts, function (b) {
          if (b !== btn) b.classList.add("is-dim");
        });
        setTimeout(function () {
          commit(pick);
        }, 190);
      });
    });

    var back = root.querySelector('[data-act="back"]');
    if (back) {
      back.addEventListener("click", function () {
        if (state.idx === 0) return;
        /* 只允许在本段内回退，避免跨过已经结算的检查点 */
        var floor = state.idx > 15 ? 15 : state.idx > 5 ? 5 : 0;
        if (state.idx - 1 < floor) return;
        state.idx -= 1;
        delete state.answers[state.ids[state.idx]];
        save();
        renderQuestion();
      });
    }
  }

  /* ---------- 推进 ---------- */
  function commit(pick) {
    var id = state.ids[state.idx];
    state.answers[id] = pick;
    state.idx += 1;

    if (state.idx === 5 || state.idx === 15) {
      var stage = state.idx === 5 ? 1 : 2;
      var cum = state.idx === 5 ? totals()[5] : totals()[15];
      var verdict = judge(stage, cum);
      state.affinity += verdict.affinity || 0;
      state.gate = { stage: stage, cum: cum, verdict: verdict };
      state.phase = verdict.end ? "result" : "gate";
      if (verdict.end) {
        state.result = { tier: verdict.tier, cum: cum, at: state.idx };
      }
    } else if (state.idx === 40) {
      var final = totals()[40];
      state.result = { tier: judge(3, final).tier, cum: final, at: 40 };
      state.phase = "result";
    }

    save();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- 渲染：检查点 ---------- */
  function renderGate() {
    var g = state.gate;
    var v = g.verdict;
    var perfect = !!v.must;
    var max = g.stage === 1 ? 50 : 150;

    root.innerHTML =
      '<div class="gate-card">' +
      '<p class="gate-kicker">' + (perfect ? "完全契合" : "阶段小结") + "</p>" +
      '<p class="gate-score">' + g.cum + '<span>/' + max + "</span></p>" +
      '<h1 class="gate-title">' +
      (perfect ? "一路对到底，那就别停了" : "对得还不错，继续吗？") +
      "</h1>" +
      '<p class="gate-desc">' +
      (perfect
        ? "这一段满分。好感 +2，下一段是必答题——没有「到此为止」这个选项。"
        : "这一段我们合上了不少。好感 +1，接下来还有 " +
          (g.stage === 1 ? "10" : "25") +
          " 题，答完才知道能拿到什么。不想继续也没关系，我会按现在的分数给你一个结果。") +
      "</p>" +
      '<div class="affinity-pop">' + (perfect ? "好感 +2" : "契合 +1") + "</div>" +
      '<div class="gate-actions">' +
      '<button class="btn" type="button" data-act="go">继续答题</button>' +
      (perfect
        ? ""
        : '<button class="btn ghost" type="button" data-act="stop">到此为止</button>') +
      "</div>" +
      '<p class="gate-note">' +
      (perfect
        ? "这一段已经满分，后面才是真正要看的部分。"
        : "停下来不扣分，只是拿不到后面的券。") +
      "</p></div>";

    var go = root.querySelector('[data-act="go"]');
    if (go) {
      go.addEventListener("click", function () {
        state.phase = "question";
        state.gate = null;
        save();
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    var stop = root.querySelector('[data-act="stop"]');
    if (stop) {
      stop.addEventListener("click", function () {
        state.result = { tier: v.stopTier, cum: g.cum, at: g.stage === 1 ? 5 : 15 };
        state.phase = "result";
        save();
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
  }

  /* ---------- 渲染：结果 ---------- */
  function renderResult() {
    var r = state.result || { tier: "comp", cum: 0, at: 5 };
    var tier = TIERS[r.tier] || TIERS.comp;
    var max = r.at === 40 ? 400 : r.at === 15 ? 150 : 50;
    var pct = Math.round((r.cum / max) * 100);

    var coupon = "";
    if (tier.coupon && bank.coupons && bank.coupons[tier.coupon]) {
      coupon =
        '<div class="coupon" data-allow-copy>' +
        '<p class="coupon-label">' + C.esc(tier.couponLabel) + "</p>" +
        '<p class="coupon-code">' + C.esc(bank.coupons[tier.coupon]) + "</p>" +
        '<p class="coupon-hint">' + C.esc(tier.couponHint || "") + "</p>" +
        '<button class="btn ghost" type="button" data-act="copy">复制兑换券</button>' +
        "</div>";
    }

    var unlock = "";
    if (tier.unlock && bank.unlock && bank.unlock.token) {
      unlock =
        '<a class="btn" href="view.html?s=' + encodeURIComponent(bank.unlock.token) + '">' +
        "直接进入灵魂契合</a>";
    }

    root.innerHTML =
      '<div class="quiz-result is-' + r.tier + '">' +
      '<p class="gate-kicker">' + C.esc(tier.kicker) + "</p>" +
      '<p class="score-num">' + r.cum + '<span>/' + max + "</span></p>" +
      '<p class="score-tip">契合度 ' + pct + "% · 答到第 " + r.at + " 题" +
      (state.affinity ? " · 好感 +" + state.affinity : "") + "</p>" +
      '<h1 class="result-title">' + C.esc(tier.title) + "</h1>" +
      '<p class="result-desc">' + C.esc(tier.desc) + "</p>" +
      coupon +
      '<div class="quiz-actions">' +
      unlock +
      '<button class="btn ghost" type="button" data-act="restart">重新答题</button>' +
      '<a class="back-link" href="index.html">← 返回通道列表</a>' +
      "</div></div>";

    var copy = root.querySelector('[data-act="copy"]');
    if (copy) {
      copy.addEventListener("click", function () {
        var code = bank.coupons[tier.coupon];
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(
            function () {
              C.toast("兑换券已复制");
            },
            function () {
              C.toast("复制失败，请手动记下：" + code, 4000);
            }
          );
        } else {
          C.toast("兑换券：" + code, 5000);
        }
      });
    }

    var restart = root.querySelector('[data-act="restart"]');
    if (restart) {
      restart.addEventListener("click", function () {
        clearSaved();
        state = buildRun(bank);
        save();
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
  }

  /* ---------- 异常态 ---------- */
  function renderOffline() {
    root.innerHTML =
      '<div class="offline-card"><p class="offline-title">离线无法使用</p>' +
      '<p class="offline-desc">题库是加密的，需要在线取回并在本机解密。离线时仅可浏览公开名片页。</p>' +
      '<a class="btn ghost" href="../index.html">返回公开名片</a></div>';
  }

  function renderBroken() {
    root.innerHTML =
      '<div class="notice"><p class="notice-title">题库加载失败</p>' +
      '<p class="notice-desc">没能解开题库密文。通常是 private/quiz.enc.js 与 ' +
      "assets/js/quiz-bank.js 里的构建口令不是同一次生成的——" +
      "重新运行 <code>node tools/build-quiz.js</code> 后一起部署即可。</p>" +
      '<a class="btn ghost" href="index.html">返回通道列表</a></div>';
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    if (!C.hasSubtle) return renderBroken();
    if (!C.isOnline()) return renderOffline();

    root.innerHTML =
      '<div class="quiz-loading"><span class="dot-pulse"></span>正在解密题库…</div>';

    try {
      bank = await window.SoulBank.load();
    } catch (e) {
      return renderBroken();
    }

    rules = bank.rules || {};
    document.title = bank.title || "灵魂契合测试";

    var saved = restore();
    if (saved && saved.phase !== "result") {
      state = saved;
    } else if (saved && saved.phase === "result") {
      state = saved; /* 刷新后仍能看结果 */
    } else {
      state = buildRun(bank);
      save();
    }

    render();
  }

  /* 供测试直接调用判定逻辑 */
  window.SoulQuiz = {
    judge: judge,
    get state() {
      return state;
    },
    get bank() {
      return bank;
    }
  };

  window.addEventListener("offline", function () {
    if (!C.isOnline()) renderOffline();
  });

  boot();
})();
