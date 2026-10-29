/**
 * 统一解锁层（v14 起）
 * ------------------------------------------------------------
 * 背景：v13 之前「输入密钥」是一个独立页面（view.html 的整页表单），
 * 打开任何通道都先撞上一堵墙，看不到里面有什么，也不知道该不该进来。
 *
 * v14：密钥输入挂在「点击具体条目」上。
 * v15：入口页连条目名都不展示，改成「点那个打码的内容框，输入框在框里就地展开」，
 *      所以 private.js 只用本文件的 verify / session / lock，不再调用 open()。
 *      这里的模态框仅保留给 view.html 的两条边角链路：
 *        · 分享链接里没有内嵌密钥 → 补分享密钥
 *        · v8 及更早的 JSON 票据 → 补分享密钥
 *
 * 素材来源：64 位主密钥、v9 分享令牌、整条分享链接都能喂进来。
 * 解出来的明文只存在内存里，按 CARD_CONFIG.sessionMinutes 到期自动清掉。
 *
 * 对外接口（window.CardUnlock）：
 *   verify(channel, raw)                     校验并建会话（不弹框）
 *   session(channel)                         取当前会话（含 data / 剩余时间）
 *   lock(channel)                            手动锁定
 *   open({channel, mode, onDone, onChoice})  打开模态框（仅 view.html 用）
 *   close()                                  关闭模态框
 *   onChange(fn)                             订阅「解锁 / 过期 / 锁定」
 *   messageFor(code)                         错误码 → 中文文案
 */
(function () {
  "use strict";

  var C = window.CardCrypto;
  var CFG = window.CARD_CONFIG || { sessionMinutes: 15 };
  if (!C) return;

  var sessions = Object.create(null);
  var listeners = [];
  var current = null; /* 当前打开的模态框实例 */

  /* ---------- 会话 ---------- */
  function emit(id, type) {
    listeners.forEach(function (fn) {
      try {
        fn(id, type);
      } catch (e) {
        /* 单个订阅者出错不影响其它人 */
      }
    });
  }

  function sessionOf(id) {
    var s = sessions[id];
    if (!s) return null;
    if (s.expiresAt && Date.now() >= s.expiresAt) {
      drop(id, "expire");
      return null;
    }
    return s;
  }

  function drop(id, type) {
    var s = sessions[id];
    if (!s) return null;
    if (s.timer) clearInterval(s.timer);
    delete sessions[id];
    emit(id, type || "locked");
    return s;
  }

  function keep(id, data, dek, info) {
    drop(id);
    var s = {
      data: data,
      dek: dek,
      info: info || {},
      expiresAt: Date.now() + CFG.sessionMinutes * 60 * 1000,
      timer: null
    };
    s.timer = setInterval(function () {
      if (Date.now() >= s.expiresAt) drop(id, "expire");
      else emit(id, "tick");
    }, 1000);
    sessions[id] = s;
    emit(id, "unlocked");
    return s;
  }

  /* ---------- 输入解析 ---------- */
  function isHexKey(s) {
    return /^[0-9a-f]{64}$/i.test(s);
  }

  function looksShareKey(s) {
    return /^[0-9a-f]{32}$/i.test(s);
  }

  /** 把用户粘的东西认出来：整条链接 / 裸令牌 / 主密钥 */
  function parseRaw(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return null;

    if (s.indexOf("view.html") !== -1 || s.indexOf("?") !== -1 || s.indexOf("#s=") !== -1) {
      var qs = s.indexOf("?") !== -1 ? s.split("?")[1] : s.replace(/^[^#]*#/, "");
      qs = (qs || "").split("#")[0];
      var q = new URLSearchParams(qs);
      var tk = q.get("s") || "";
      if (!tk) {
        var frag = (s.split("#")[1] || "").replace(/^s=/, "");
        if (/^[A-Za-z0-9_-]{40,}$/.test(frag)) tk = frag;
      }
      if (!tk) return { kind: "bad-link" };
      return { kind: "token", token: tk, key: q.get("k") || "" };
    }

    if (isHexKey(s)) return { kind: "master", value: s.toLowerCase() };

    if (/^[A-Za-z0-9_-]{40,}$/.test(s)) return { kind: "token", token: s, key: "" };

    /* 32 位十六进制是分享密钥，必须配合令牌，单独给没用 */
    if (looksShareKey(s)) return { kind: "share-only", value: s };

    return { kind: "unknown" };
  }

  /* ---------- 校验 ---------- */
  /** 返回 {ok, data, dek, channel, info} 或 {ok:false, code, extra} */
  async function verify(channelId, raw) {
    var parsed = parseRaw(raw);
    if (!parsed) return { ok: false, code: "empty" };
    if (parsed.kind === "bad-link") return { ok: false, code: "bad-link" };
    if (parsed.kind === "unknown") return { ok: false, code: "format" };
    if (parsed.kind === "share-only") return { ok: false, code: "share-only" };

    var channel = channelId;

    if (parsed.kind === "token") {
      var t;
      try {
        t = await C.openShareToken(parsed.token, parsed.key || "");
      } catch (err) {
        var m = err && err.message;
        if (m === "need-key") {
          return { ok: false, code: "need-share-key", token: parsed.token, channel: err.channel || channel };
        }
        if (m === "bad-key") return { ok: false, code: "bad-share-key" };
        return { ok: false, code: "broken-link" };
      }
      channel = t.c || channel;
      if (t.expiresAt && Date.now() > t.expiresAt) return { ok: false, code: "link-expired" };

      var tid = t.oneTime ? await C.tokenId(parsed.token) : "";
      if (t.oneTime && C.usedKeyId(tid)) return { ok: false, code: "link-used" };

      var d1 = await decryptChannel(channel, t.dek);
      if (!d1.ok) return d1;

      /* 解密成功才记「已使用」，解不开不能把链接白白报废 */
      if (t.oneTime) C.markUsed(tid);

      var info1 = { via: "token", expiresAt: t.expiresAt, oneTime: !!t.oneTime };
      keep(channel, d1.data, t.dek, info1);
      return { ok: true, channel: channel, data: d1.data, dek: t.dek, info: info1 };
    }

    /* 主密钥：直接拿它当 AES 口令去解内容，解不开就是错的 */
    var d2 = await decryptChannel(channel, parsed.value);
    if (!d2.ok) {
      d2.code = d2.code === "no-payload" ? "no-payload" : "wrong-key";
      return d2;
    }
    keep(channel, d2.data, parsed.value, { via: "master", master: true });
    return { ok: true, channel: channel, data: d2.data, dek: parsed.value, info: { master: true } };
  }

  async function decryptChannel(channel, dek) {
    var payload;
    try {
      payload = await C.ensureChannel(channel);
    } catch (e) {
      return { ok: false, code: "no-payload" };
    }
    try {
      var data = await C.decryptPayload(payload, dek);
      return { ok: true, data: data };
    } catch (e) {
      return { ok: false, code: "wrong-key" };
    }
  }

  /* ---------- 文案 ---------- */
  function metaOf(id) {
    var list = window.PRIVATE_CHANNELS_META || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return { id: id, name: "私密通道", desc: "" };
  }

  var CODES = {
    empty: "还没输入内容。",
    format: "认不出这段内容。请输入 64 位主密钥，或直接粘贴整条分享链接。",
    "bad-link": "这段链接里没有可用的令牌，请整条复制，不要只截一半。",
    "share-only": "32 位的这是分享密钥，它必须配合同一条分享链接一起用。请改用完整链接。",
    "bad-share-key": "分享密钥和这条链接不是同一次签发的，对不上。",
    "need-share-key": "这条链接没有内嵌密钥，需要再补上分享密钥。",
    "broken-link": "链接不完整，可能在聊天软件里被截断了。",
    "link-expired": "这条链接已经过期，请向本人要一条新的。",
    "link-used": "这是一次性链接，已经在本设备用过了。",
    "wrong-key": "密钥不对，这段内容和它解不开。",
    "no-payload": "这个通道还没有生成密文，请先运行 tools/rotate.js。",
    offline: "当前离线，私密内容需要在线解密。"
  };

  function msgOf(code) {
    return CODES[code] || "解锁失败，请再试一次。";
  }

  /* ---------- 模态框 ---------- */
  var ESC_HANDLER = null;

  function close() {
    if (!current) return;
    var inst = current;
    if (inst.el && inst.el.parentNode) inst.el.parentNode.removeChild(inst.el);
    if (ESC_HANDLER) document.removeEventListener("keydown", ESC_HANDLER);
    if (inst.returnFocus && inst.returnFocus.focus) {
      try {
        inst.returnFocus.focus();
      } catch (e) {
        /* noop */
      }
    }
    current = null;
    document.documentElement.classList.remove("is-modal-open");
    if (!inst.succeeded && typeof inst.opts.onClose === "function") {
      try {
        inst.opts.onClose();
      } catch (e) {
        /* noop */
      }
    }
  }

  /**
   * @param {object} opts
   *   channel  通道 id
   *   mode     "key" | "sharekey" | "choice"
   *   token    分享令牌（mode=sharekey 时必填）
   *   reason   触发原因文案（例如「想看「期望薪资」」）
   *   onDone   解锁成功回调 ({channel, data})
   *   onChoice 选择「答题」回调（mode=choice）
   */
  function open(opts) {
    close();
    var o = opts || {};
    var channel = o.channel || "dating";
    var meta = metaOf(channel);
    var mode = o.mode || "key";
    var token = o.token || "";
    var failures = 0;
    var frozenUntil = 0;
    var timer = null;

    var veil = document.createElement("div");
    veil.className = "modal-veil";
    veil.setAttribute("data-modal", "");
    document.body.appendChild(veil);
    document.documentElement.classList.add("is-modal-open");

    current = { el: veil, returnFocus: document.activeElement, opts: o };
    ESC_HANDLER = function (ev) {
      if (ev.key === "Escape") close();
    };
    document.addEventListener("keydown", ESC_HANDLER);

    veil.addEventListener("click", function (ev) {
      if (ev.target === veil) close();
    });

    /* ---- 选答题 / 输密钥 ---- */
    function renderChoice() {
      veil.innerHTML =
        '<div class="modal modal-choice" role="dialog" aria-modal="true" aria-labelledby="mTitle">' +
        '<button class="modal-x" type="button" aria-label="关闭" data-act="close">×</button>' +
        '<p class="gate-kicker">Soul Match · ' + C.esc(meta.name) + "</p>" +
        '<h2 class="modal-title" id="mTitle">两条路，任选一条</h2>' +
        '<p class="modal-desc">' + C.esc(meta.desc || "") + "</p>" +
        '<div class="choice-grid">' +
        '<button class="choice-card" type="button" data-act="quiz">' +
        '<span class="choice-kicker">约 5 分钟</span>' +
        '<strong>先做契合测试</strong>' +
        '<span class="choice-desc">40 道题分三段，答到 370 分就能免密钥进来，还带券。</span>' +
        '<span class="choice-go">开始答题 →</span></button>' +
        '<button class="choice-card" type="button" data-act="key">' +
        '<span class="choice-kicker">已有口令</span>' +
        '<strong>直接输入密钥</strong>' +
        '<span class="choice-desc">朋友给了你主密钥或分享链接，那就跳过答题。</span>' +
        '<span class="choice-go">输入密钥 →</span></button>' +
        "</div>" +
        '<p class="modal-note">两条路只影响你怎么进来，进来之后看到的内容完全一样。</p>' +
        "</div>";
      bindCommon();
      var first = veil.querySelector(".choice-card");
      if (first) first.focus();
    }

    function renderKey(state) {
      var shareMode = !!token;
      var title = shareMode ? "补上分享密钥" : "输入访问密钥";
      var desc = shareMode
        ? "链接已经就位，只差配套的分享密钥（32 位十六进制）。它在链接之外单独发给你。"
        : (o.reason
            ? "你点了「" + o.reason + "」。这个通道的每个字都是加密的，解开后本机保留 " +
              CFG.sessionMinutes + " 分钟，然后自动清掉。"
            : "这个通道的每个字都是加密的。解开后本机保留 " + CFG.sessionMinutes + " 分钟，然后自动清掉。");

      veil.innerHTML =
        '<div class="modal modal-key" role="dialog" aria-modal="true" aria-labelledby="mTitle">' +
        '<button class="modal-x" type="button" aria-label="关闭" data-act="close">×</button>' +
        '<p class="gate-kicker">Unlock · ' + C.esc(meta.name) + "</p>" +
        '<h2 class="modal-title" id="mTitle">' + C.esc(title) + "</h2>" +
        '<p class="modal-desc">' + C.esc(desc) + "</p>" +
        '<ul class="modal-facts">' +
        "<li><span>通道</span><b>" + C.esc(meta.name) + "</b></li>" +
        (shareMode ? "<li><span>链接</span><b>已就位</b></li>" : "") +
        "<li><span>本次查看</span><b>" + CFG.sessionMinutes + " 分钟</b></li>" +
        "<li><span>解密</span><b>仅在你的浏览器本地</b></li>" +
        "</ul>" +
        '<form class="unlock-form modal-form" id="unlockForm" autocomplete="off">' +
        '<label class="sr-only" for="unlockInput">' +
        (shareMode ? "分享密钥" : "主密钥或分享链接") +
        "</label>" +
        '<input id="unlockInput" type="text" name="k" spellcheck="false" autocapitalize="off" ' +
        'autocorrect="off" placeholder="' +
        (shareMode ? "分享密钥（32 位十六进制）" : "64 位主密钥，或直接粘贴整条分享链接") +
        '" aria-describedby="unlockMsg">' +
        '<button class="btn" type="submit" id="unlockBtn">解锁</button>' +
        "</form>" +
        '<p class="form-msg" id="unlockMsg" role="status">' +
        (state && state.msg ? C.esc(state.msg) : "") +
        "</p>" +
        '<details class="modal-help">' +
        "<summary>密钥从哪来？</summary>" +
        '<div class="modal-help-body"><p>' +
        (shareMode
          ? "分享密钥不会写在链接里。找发链接给你的人要，通常和链接分开两条消息发。"
          : "三种都能用：① 本人给你的 64 位主密钥；② 一条 <code>view.html?s=…</code> 的完整链接；" +
            "③ 链接 + 分享密钥。分享链接自带有效期，过期要重新要。") +
        "</p></div></details>" +
        '<p class="modal-note" id="unlockNote">' +
        (shareMode ? "解除分享密钥后仍需在有效期内查看。" : "内容不会上传，也不会写进浏览器存储。") +
        "</p>" +
        "</div>";

      bindCommon();

      var form = veil.querySelector("#unlockForm");
      var input = veil.querySelector("#unlockInput");
      var msg = veil.querySelector("#unlockMsg");
      var btn = veil.querySelector("#unlockBtn");

      if (state && state.error) msg.classList.add("is-error");
      input.focus();

      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (frozenUntil > Date.now()) return;
        submit(input.value);
      });

      if (frozenUntil > Date.now()) freeze();

      function freeze() {
        btn.disabled = true;
        var left = Math.ceil((frozenUntil - Date.now()) / 1000);
        msg.className = "form-msg is-error";
        msg.textContent = "连续 " + CFG.adminMaxAttempts + " 次不对，等 " + left + " 秒再试。";
        if (timer) clearInterval(timer);
        timer = setInterval(function () {
          var l = Math.ceil((frozenUntil - Date.now()) / 1000);
          if (l <= 0) {
            clearInterval(timer);
            timer = null;
            btn.disabled = false;
            msg.className = "form-msg";
            msg.textContent = "可以再试了。";
            return;
          }
          msg.textContent = "连续 " + CFG.adminMaxAttempts + " 次不对，等 " + l + " 秒再试。";
        }, 500);
      }

      async function submit(value) {
        var raw = String(value || "").trim();
        if (!raw) {
          msg.className = "form-msg is-error";
          msg.textContent = msgOf("empty");
          input.focus();
          return;
        }
        if (!C.isOnline()) {
          msg.className = "form-msg is-error";
          msg.textContent = msgOf("offline");
          return;
        }

        btn.disabled = true;
        btn.textContent = "解密中…";
        msg.className = "form-msg";
        msg.textContent = "";

        var res;
        try {
          if (typeof o.onSubmit === "function") {
            /* 旧格式票据等特殊链路：校验逻辑由调用方提供，模态框只管界面 */
            res = await o.onSubmit(raw);
          } else {
            /* 分享密钥模式下，把令牌和密钥拼成一条合成查询串再走同一套校验 */
            res = shareMode
              ? await verify(channel, "?s=" + encodeURIComponent(token) + "&k=" + encodeURIComponent(raw))
              : await verify(channel, raw);
          }
        } catch (e) {
          res = { ok: false, code: "format" };
        }

        btn.disabled = false;
        btn.textContent = "解锁";

        if (res.ok) {
          if (current) current.succeeded = true;
          close();
          if (typeof o.onDone === "function") o.onDone(res);
          return;
        }

        /* 令牌需要分享密钥 → 切到分享密钥模式，不丢用户粘的内容 */
        if (res.code === "need-share-key") {
          token = res.token;
          renderKey({ msg: msgOf("need-share-key") });
          return;
        }

        failures += 1;
        var limit = CFG.adminMaxAttempts || 5;
        if (failures >= limit) {
          frozenUntil = Date.now() + (CFG.adminLockSeconds || 30) * 1000;
          failures = 0;
          freeze();
          return;
        }

        var left = limit - failures;
        msg.className = "form-msg is-error";
        msg.textContent = msgOf(res.code) + (left <= 3 ? "（还可以试 " + left + " 次）" : "");
        input.select();
      }
    }

    function bindCommon() {
      var x = veil.querySelector('[data-act="close"]');
      if (x) x.addEventListener("click", close);

      var quiz = veil.querySelector('[data-act="quiz"]');
      if (quiz) {
        quiz.addEventListener("click", function () {
          if (typeof o.onChoice === "function") {
            close();
            o.onChoice("quiz");
          } else {
            close();
            location.href = "quiz.html?c=" + encodeURIComponent(channel);
          }
        });
      }

      var key = veil.querySelector('[data-act="key"]');
      if (key) {
        key.addEventListener("click", function () {
          token = "";
          renderKey({ focus: true });
        });
      }
    }

    if (mode === "choice") renderChoice();
    else renderKey({ focus: true });

    return { close: close };
  }

  window.CardUnlock = {
    open: open,
    close: close,
    verify: verify,
    session: sessionOf,
    lock: function (id) {
      return drop(id);
    },
    isUnlocked: function (id) {
      return !!sessionOf(id);
    },
    onChange: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
    },
    messageFor: msgOf,
    metaOf: metaOf
  };
})();
