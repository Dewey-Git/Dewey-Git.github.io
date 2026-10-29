/**
 * 私密通道入口页（Hub）v16
 * ------------------------------------------------------------
 * v14：先列出条目名（分组标题 + 字段名），点某一条再弹窗输密钥。
 * v15：连字段名也不给了。未解锁时整页只有一个「加密内容框」，
 *      它既不知道里面有几条、也不知道字段叫什么——点一下，
 *      密钥输入框就在这个框里就地展开（不弹对话框）。
 * v16：点框先给两个去处（和契合那栏一样的两张卡），都在这块里展开：
 *        工作 → 工作（要密钥）/ 技术（公开的技术与能力范围）
 *        交友 → 认真交往（要密钥）/ 交流（留联系方式）
 *        契合 → 输入密钥 / 契合测试（完全契合免密钥）
 *
 * 三条约束：
 *   1. 未解锁时页面拿不到任何条目信息（private/outline.js 已废弃），
 *      取材只剩 AES-256-GCM 密文。
 *   2. 「技术」「交流」两个出口是独立静态页（tech.html / contact.html），
 *      不碰密文、也不在公开名片页给入口。
 *   3. 明文只在内存里存 CARD_CONFIG.sessionMinutes 分钟，到期自动打回加密框。
 */
(function () {
  "use strict";

  var C = window.CardCrypto;
  var U = window.CardUnlock;
  var tabsEl = document.getElementById("channelTabs");
  var panel = document.getElementById("channels");
  if (!tabsEl || !panel || !C || !U) return;

  var ICONS = {
    heart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<path d="M12 20s-7-4.5-7-9.2A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.8C19 15.5 12 20 12 20z"/></svg>',
    briefcase:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<rect x="3" y="7.5" width="18" height="12" rx="2"/>' +
      '<path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3 12.8h18"/></svg>',
    spark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9L5.2 10.3l4.9-1.9z"/>' +
      '<path d="M18.5 16.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
    lock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
      '<rect x="5" y="10.4" width="14" height="9.4" rx="2.2"/>' +
      '<path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4"/></svg>',
    open:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M5 12.5l4.2 4.2L19 7"/></svg>'
  };

  /* ---------- 每个通道点开后的两个去处（v16） ----------
   * 文案按通道写死在这里，不放 channels.js——那份是公开元数据，
   * 只需要「标签叫什么」，不需要知道点开后有哪两条路。
   * act：key = 就地展开密钥输入；quiz/tech/talk = 跳页。
   */
  var MENUS = {
    interview: [
      {
        act: "key",
        label: "工作",
        hint: "履历、职责、到岗时间这些，要密钥才能看。",
        go: "输入密钥 →"
      },
      {
        act: "tech",
        label: "技术",
        hint: "这个站用到什么，我会到哪个份上。",
        go: "看看 →"
      }
    ],
    dating: [
      {
        act: "key",
        label: "认真交往",
        hint: "家庭、生活与择偶这些，只有密钥能开。",
        go: "输入密钥 →"
      },
      {
        act: "talk",
        label: "交流",
        hint: "想先随便聊聊，留个联系方式。",
        go: "联系方式 →"
      }
    ],
    soul: [
      {
        act: "key",
        label: "输入密钥",
        hint: "手上有主密钥或分享链接就走这条。",
        go: "输入密钥 →"
      },
      {
        act: "quiz",
        label: "契合测试",
        hint: "完全契合的话，不需要密钥也能进。",
        go: "开始 →"
      }
    ]
  };

  function menuOf(meta) {
    return (meta && MENUS[meta.id]) || null;
  }

  var list =
    (window.PRIVATE_CHANNELS_META ||
      (typeof PRIVATE_CHANNELS_META !== "undefined" ? PRIVATE_CHANNELS_META : []) ||
      []).slice();

  var tickTimer = null;
  var flashTimer = null;
  var freezeTimer = null;

  /* 加密框的就地状态：sealed（打码）/ choice（两个去处）/ key（输入中） */
  var vault = freshVault();

  function freshVault() {
    return { mode: "sealed", msg: "", err: false, draft: "", attempts: 0, frozenUntil: 0 };
  }

  function find(id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function tabLabel(meta) {
    return meta.tab || meta.name;
  }

  /* ---------- 初始标签：?c= → #hash → 第一个 ---------- */
  var activeId = list.length ? list[0].id : null;
  (function pickInitial() {
    var params = new URLSearchParams(location.search);
    var want = [params.get("c"), (location.hash || "").replace("#", "")];
    for (var i = 0; i < want.length; i++) {
      if (want[i] && find(want[i])) {
        activeId = want[i];
        break;
      }
    }
  })();

  /* ---------- 离线拦截 ---------- */
  var offline = document.getElementById("offlineNotice");
  function syncOnline() {
    var on = C.isOnline();
    if (offline) offline.hidden = on;
    tabsEl.hidden = !on;
    panel.hidden = !on;
  }
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);

  /* ---------- 标签栏 ---------- */
  function renderTabs() {
    var out = list
      .map(function (meta) {
        var on = meta.id === activeId;
        return (
          '<button class="tab" type="button" role="tab"' +
          ' id="tab-' + C.esc(meta.id) + '"' +
          ' data-id="' + C.esc(meta.id) + '"' +
          ' aria-selected="' + (on ? "true" : "false") + '"' +
          ' aria-controls="channels"' +
          ' tabindex="' + (on ? "0" : "-1") + '">' +
          C.esc(tabLabel(meta)) +
          "</button>"
        );
      })
      .join("");
    tabsEl.innerHTML = out;
  }

  /* ---------- 加密框（未解锁） ----------
   * 只给「有东西、但看不见」这一个信息：标题、占位条、怎么打开。
   * 条数、分组名、字段名一概不透露。
   */
  function sealHTML(meta) {
    return (
      '<button class="vault-seal" type="button" data-act="seal"' +
      ' aria-label="' + C.esc(meta.name) + "：内容已加密，点击选择入口" + '">' +
      '<span class="vault-icon">' + ICONS.lock + "</span>" +
      '<span class="vault-main">' +
      '<span class="vault-title">内容已加密</span>' +
      '<span class="vault-bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="vault-hint">点击打开 · 解锁后本机保留 ' +
      C.cfg.sessionMinutes + " 分钟</span>" +
      "</span>" +
      '<span class="vault-go">解锁 →</span>' +
      "</button>"
    );
  }

  function choiceHTML(meta) {
    var menu = menuOf(meta) || [];
    var cards = menu
      .map(function (m) {
        return (
          '<button class="vault-choice" type="button" data-act="' + C.esc(m.act) + '">' +
          "<b>" + C.esc(m.label) + "</b>" +
          "<em>" + C.esc(m.hint) + "</em>" +
          '<span class="vault-choice-go">' + C.esc(m.go) + "</span></button>"
        );
      })
      .join("");

    return (
      '<div class="vault-head"><span class="vault-title">从哪边进？</span>' +
      '<button class="vault-cancel" type="button" data-act="cancel">取消</button></div>' +
      '<div class="vault-choices' + (menu.length ? "" : " is-single") + '">' +
      cards +
      "</div>"
    );
  }

  function keyHTML() {
    return (
      '<div class="vault-head">' +
      '<span class="vault-title">输入访问密钥</span>' +
      '<button class="vault-cancel" type="button" data-act="cancel">取消</button>' +
      "</div>" +
      '<form class="vault-form" id="vaultForm" autocomplete="off">' +
      '<label class="sr-only" for="vaultInput">主密钥或分享链接</label>' +
      '<input id="vaultInput" type="text" name="k" spellcheck="false" ' +
      'autocapitalize="off" autocorrect="off" ' +
      'placeholder="粘贴 64 位主密钥，或整条分享链接" aria-describedby="vaultMsg">' +
      '<button class="btn" type="submit" id="vaultBtn">解锁</button>' +
      "</form>" +
      '<p class="form-msg' + (vault.err ? " is-error" : "") + '" id="vaultMsg" role="status">' +
      C.esc(vault.msg) + "</p>" +
      '<details class="vault-help">' +
      "<summary>密钥从哪来？</summary>" +
      '<div class="vault-help-body"><p>三种都能用：① 本人给你的 64 位主密钥；' +
      "② 一条 <code>view.html?s=…</code> 的完整链接；③ 链接 + 分享密钥。" +
      "分享链接自带有效期，过期要重新要。</p></div></details>"
    );
  }

  function vaultHTML(meta) {
    var body =
      vault.mode === "choice" ? choiceHTML(meta) : vault.mode === "key" ? keyHTML() : sealHTML(meta);
    return (
      '<div class="vault" id="vault" data-mode="' + vault.mode + '">' + body + "</div>"
    );
  }

  /* ---------- 已解锁内容 ----------
   * 每一条都直接铺开（不再有「点开某一行」这一步），因为整扇门已经开了。
   */
  function buildContent(sections) {
    if (!sections.length) {
      return '<p class="lock-empty">这个通道里暂时没有内容。</p>';
    }

    return sections
      .map(function (sec, si) {
        var fields = sec.fields || sec.items || [];
        var rows = fields
          .map(function (row, ri) {
            var label = row && row.label != null ? row.label : row;
            var value = row && row.value != null ? row.value : "";
            return (
              '<li class="lock-row" style="--d:' + Math.min((si * 6 + ri) * 22, 360) + 'ms">' +
              '<div class="lock-item is-open">' +
              '<span class="lock-label">' + C.esc(label) + "</span>" +
              '<span class="lock-value">' + C.esc(value) + "</span>" +
              '<span class="lock-mark">' + ICONS.open + "</span>" +
              "</div></li>"
            );
          })
          .join("");

        return (
          '<section class="lock-group">' +
          '<p class="lock-heading"><span>' + C.esc(sec.heading || "") + "</span>" +
          "<em>" + fields.length + " 条</em></p>" +
          '<ul class="lock-list">' + rows + "</ul></section>"
        );
      })
      .join("");
  }

  /* ---------- 整块面板 ---------- */
  function renderPanel() {
    var meta = find(activeId);
    if (!meta) {
      panel.innerHTML = "";
      return;
    }

    panel.setAttribute("aria-labelledby", "tab-" + meta.id);

    var session = U.session(meta.id);
    var body = session
      ? '<div class="lock-wrap" data-open="1">' +
        buildContent((session.data && session.data.sections) || []) +
        "</div>"
      : vaultHTML(meta);

    var foot = session
      ? '<footer class="panel-foot">' +
        '<p class="channel-state" data-state>' + stateLine(session) + "</p>" +
        '<div class="panel-actions">' +
        '<button class="btn ghost" type="button" data-act="lock">锁定</button>' +
        (meta.quiz
          ? '<a class="btn ghost" href="quiz.html?c=' + encodeURIComponent(meta.id) +
            '">契合测试</a>'
          : "") +
        "</div></footer>"
      : "";

    panel.innerHTML =
      '<article class="channel-panel" data-id="' + C.esc(meta.id) + '">' +
      '<header class="panel-head">' +
      '<span class="channel-icon">' + (ICONS[meta.icon] || ICONS.spark) + "</span>" +
      '<div class="panel-title"><h2>' + C.esc(meta.name) + "</h2>" +
      '<p class="channel-desc">' + C.esc(meta.desc || "") + "</p></div>" +
      "</header>" +
      body +
      foot +
      "</article>";

    panel.classList.remove("is-fade");
    void panel.offsetWidth;
    panel.classList.add("is-fade");

    bindPanel();
    bindVault();
    focusFlash();
    startTick();
  }

  function stateLine(session) {
    return '<span class="pulse"></span>已解锁 · 剩余 <b data-left>' +
      C.fmtDuration(session.expiresAt - Date.now()) + "</b> · 关闭页面即清除";
  }

  /* ---------- 加密框：就地展开 / 收起 ---------- */
  function setMode(mode) {
    vault.mode = mode;
    vault.msg = "";
    vault.err = false;
    if (mode === "sealed") vault.draft = "";
    renderVault();
  }

  /** 只重画加密框，避免整块面板重绘把用户输入冲掉 */
  function renderVault() {
    var meta = find(activeId);
    if (!meta) return;
    var box = panel.querySelector("#vault");
    if (!box) {
      renderPanel();
      return;
    }
    box.setAttribute("data-mode", vault.mode);
    box.innerHTML =
      vault.mode === "choice" ? choiceHTML(meta) : vault.mode === "key" ? keyHTML() : sealHTML(meta);
    bindVault();
  }

  function bindVault() {
    var box = panel.querySelector("#vault");
    if (!box) return;

    var form = box.querySelector("#vaultForm");
    var input = box.querySelector("#vaultInput");
    if (!form || !input) return;

    input.value = vault.draft;
    input.addEventListener("input", function () {
      vault.draft = input.value;
    });
    form.addEventListener("submit", onSubmit);

    if (vault.frozenUntil > Date.now()) freeze();
    else input.focus({ preventScroll: true });
  }

  function showMsg(text, isErr) {
    var box = panel.querySelector("#vault");
    var msg = box && box.querySelector("#vaultMsg");
    if (!msg) return;
    msg.className = "form-msg" + (isErr ? " is-error" : "");
    msg.textContent = text;
    vault.msg = text;
    vault.err = !!isErr;
  }

  async function onSubmit(ev) {
    ev.preventDefault();

    var meta = find(activeId);
    var box = panel.querySelector("#vault");
    if (!meta || !box) return;

    var input = box.querySelector("#vaultInput");
    var btn = box.querySelector("#vaultBtn");
    if (!input || !btn) return;
    if (vault.frozenUntil > Date.now()) return;

    var raw = String(input.value || "").trim();
    if (!raw) {
      showMsg(U.messageFor("empty"), true);
      input.focus();
      return;
    }
    if (!C.isOnline()) {
      showMsg(U.messageFor("offline"), true);
      return;
    }

    btn.disabled = true;
    btn.textContent = "解密中…";
    showMsg("", false);

    var res;
    try {
      res = await U.verify(meta.id, raw);
    } catch (e) {
      res = { ok: false, code: "format" };
    }

    btn.disabled = false;
    btn.textContent = "解锁";

    if (res.ok) {
      vault = freshVault();
      afterUnlock(res);
      return;
    }

    /* 链接缺分享密钥：这是唯一一种「还需要另一段东西」的情况，单独提示 */
    if (res.code === "need-share-key") {
      showMsg(U.messageFor(res.code), true);
      return;
    }

    vault.attempts += 1;
    var limit = C.cfg.adminMaxAttempts || 5;
    if (vault.attempts >= limit) {
      vault.attempts = 0;
      vault.frozenUntil = Date.now() + (C.cfg.adminLockSeconds || 30) * 1000;
      freeze();
      return;
    }

    var left = limit - vault.attempts;
    showMsg(U.messageFor(res.code) + (left <= 3 ? "（还可以试 " + left + " 次）" : ""), true);
    input.select();
  }

  function freeze() {
    var box = panel.querySelector("#vault");
    if (!box) return;
    var btn = box.querySelector("#vaultBtn");
    if (btn) btn.disabled = true;

    function tick() {
      var left = Math.ceil((vault.frozenUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(freezeTimer);
        freezeTimer = null;
        var b = panel.querySelector("#vaultBtn");
        if (b) b.disabled = false;
        showMsg("可以再试了。", false);
        return;
      }
      showMsg("连续 " + (C.cfg.adminMaxAttempts || 5) + " 次不对，等 " + left + " 秒再试。", true);
    }

    if (freezeTimer) clearInterval(freezeTimer);
    tick();
    freezeTimer = setInterval(tick, 500);
  }

  /* ---------- 解锁 / 锁定 ---------- */
  function afterUnlock(res) {
    if (res.channel && find(res.channel) && res.channel !== activeId) {
      activeId = res.channel;
      renderTabs();
      try {
        history.replaceState(null, "", "#" + encodeURIComponent(activeId));
      } catch (e) {
        /* file:// 下会抛错 */
      }
    }
    renderPanel();
    C.toast("已解锁，本机保留 " + C.cfg.sessionMinutes + " 分钟");
  }

  /* ---------- 事件 ---------- */
  function bindPanel() {
    var card = panel.querySelector(".channel-panel");
    if (!card) return;

    card.addEventListener("click", function (ev) {
      var meta = find(activeId);
      if (!meta) return;

      var act = ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!act) return;

      switch (act.getAttribute("data-act")) {
        case "seal":
          setMode(menuOf(meta) ? "choice" : "key");
          break;
        case "key":
          setMode("key");
          break;
        case "quiz":
          location.href = "quiz.html?c=" + encodeURIComponent(meta.id);
          break;
        case "tech":
          location.href = "tech.html";
          break;
        case "talk":
          location.href = "contact.html";
          break;
        case "cancel":
          setMode("sealed");
          break;
        case "lock":
          U.lock(meta.id);
          vault = freshVault();
          renderPanel();
          C.toast("已锁定，内容已从页面清除");
          break;
      }
    });
  }

  /** 解锁后给内容区一个短暂高亮，说明「刚打开的就是这里」 */
  function focusFlash() {
    var wrap = panel.querySelector('.lock-wrap[data-open="1"]');
    if (!wrap) return;
    wrap.classList.add("is-flash");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      wrap.classList.remove("is-flash");
    }, 1600);
  }

  /* ---------- 倒计时 ---------- */
  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      var meta = find(activeId);
      if (!meta) return;
      var s = U.session(meta.id);
      var node = panel.querySelector("[data-left]");
      if (!s) {
        if (panel.querySelector('.lock-wrap[data-open="1"]')) renderPanel();
        return;
      }
      if (node) node.textContent = C.fmtDuration(s.expiresAt - Date.now());
    }, 1000);
  }

  /* ---------- 切换 ---------- */
  function activate(id, focusTab) {
    if (!find(id)) return;
    if (id === activeId) {
      if (focusTab) focusTabEl(id);
      return;
    }
    activeId = id;
    vault = freshVault();
    if (freezeTimer) {
      clearInterval(freezeTimer);
      freezeTimer = null;
    }

    Array.prototype.forEach.call(tabsEl.querySelectorAll(".tab"), function (btn) {
      var on = btn.dataset.id === id;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    });

    try {
      history.replaceState(null, "", "#" + encodeURIComponent(id));
    } catch (e) {
      /* noop */
    }

    renderPanel();
    if (focusTab) focusTabEl(id);
  }

  function focusTabEl(id) {
    var btn = tabsEl.querySelector('.tab[data-id="' + id + '"]');
    if (btn) btn.focus();
  }

  tabsEl.addEventListener("click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest(".tab") : null;
    if (btn) activate(btn.dataset.id, false);
  });

  tabsEl.addEventListener("keydown", function (ev) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(ev.key) === -1) return;
    ev.preventDefault();

    var idx = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === activeId) idx = i;
    }
    if (ev.key === "ArrowLeft") idx = (idx - 1 + list.length) % list.length;
    if (ev.key === "ArrowRight") idx = (idx + 1) % list.length;
    if (ev.key === "Home") idx = 0;
    if (ev.key === "End") idx = list.length - 1;

    if (list[idx]) activate(list[idx].id, true);
  });

  /* 会话到期 / 被别处锁定 → 重画 */
  U.onChange(function (id) {
    if (id !== activeId) return;
    var s = U.session(id);
    if (!s) {
      vault = freshVault();
      renderPanel();
    }
  });

  renderTabs();
  renderPanel();
  syncOnline();

  if (!C.hasSubtle) {
    var warn = document.getElementById("envWarn");
    if (warn) warn.hidden = false;
  }
})();
