/**
 * 管理员控制台（独立页面，仅通过 URL 访问，不在任何界面留入口）
 * 职责：校验管理员密码 → 自检密钥 → 签发一次性 / 限时分享链接
 *
 * v9：
 *   · 分享令牌改成紧凑二进制（base64url），一条链接约 70 字符，仍无 & 可截断。
 *   · 链接里内嵌 128 位分享密钥；「分开传送」模式则只给令牌，对方补输密钥。
 *   · 登录后自动自检：用封装的 DEK 试解每个通道的密文，
 *     直接暴露「站点上的密文和密钥文件不是同一批」这类部署问题。
 */
(function () {
  "use strict";

  var C = window.CardCrypto;
  var root = document.getElementById("adminRoot");
  if (!root || !C) return;

  var state = { fails: 0, lockUntil: 0, keys: null, audit: {} };

  document.title = "管理控制台";

  function randomKey() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map
      .call(bytes, function (b) { return b.toString(16).padStart(2, "0"); })
      .join("");
  }

  function fmtTime(ms) {
    var d = new Date(ms);
    function p(n) { return n < 10 ? "0" + n : n; }
    return (
      d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes())
    );
  }

  /* 以 admin.html 所在目录为基准，避免用字符串裁剪 href 出错 */
  function baseDir() {
    var u = new URL(location.href);
    u.search = "";
    u.hash = "";
    u.pathname = u.pathname.replace(/[^/]*$/, "");
    return u.href;
  }

  /* 把 ttl（小时）写成「15 分钟 / 1 小时 / 7 天」 */
  function ttlLabel(h) {
    var m = Math.round(Number(h) * 60);
    if (m < 60) return m + " 分钟";
    if (h < 24) return h + " 小时";
    return h / 24 + " 天";
  }

  /* ---------- 自检：封装的 DEK 能否解开当前密文 ---------- */
  async function auditKeys() {
    var channels = window.PRIVATE_CHANNELS_META || [];
    var out = {};
    for (var i = 0; i < channels.length; i++) {
      var id = channels[i].id;
      var dek = state.keys && state.keys[id];
      if (!dek) { out[id] = "nokey"; continue; }
      try {
        var payload = await C.ensureChannel(id);
        await C.decryptPayload(payload, dek);
        out[id] = "ok";
      } catch (e) {
        out[id] = "mismatch";
      }
    }
    state.audit = out;
    return out;
  }

  function gateForm() {
    root.innerHTML =
      '<div class="gate-kicker">Admin</div>' +
      '<h1 class="view-title">管理控制台</h1>' +
      '<p class="lead">需要管理员密码验证。该密码仅用于确认操作权限，不参与任何数据解密。</p>' +
      '<form class="unlock-form" id="adminForm" autocomplete="off" style="margin-top:18px">' +
      '<input type="password" name="pwd" placeholder="管理员密码" aria-label="管理员密码" required>' +
      '<button class="btn" type="submit">验证</button></form>' +
      '<p class="form-msg" id="adminMsg"></p>';

    var form = document.getElementById("adminForm");
    var msg = document.getElementById("adminMsg");

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();

      if (Date.now() < state.lockUntil) {
        msg.className = "form-msg is-error";
        msg.textContent = "尝试次数过多，请 " + Math.ceil((state.lockUntil - Date.now()) / 1000) + " 秒后再试。";
        return;
      }

      msg.className = "form-msg";
      msg.textContent = "正在验证…";

      try {
        var vault = await C.ensureVault();
        var data = await C.decryptPayload(vault, form.querySelector("input").value);
        state.keys = (data && data.keys) || {};
        state.fails = 0;
        msg.textContent = "正在自检密钥…";
        await auditKeys();
        renderConsole();
      } catch (err) {
        state.fails += 1;
        if (state.fails >= C.cfg.adminMaxAttempts) {
          state.lockUntil = Date.now() + C.cfg.adminLockSeconds * 1000;
          state.fails = 0;
          msg.className = "form-msg is-error";
          msg.textContent = "连续失败，已锁定 " + C.cfg.adminLockSeconds + " 秒。";
        } else {
          msg.className = "form-msg is-error";
          msg.textContent =
            err && err.message === "no-vault"
              ? "尚未设置管理员密码，请先运行 tools/set-admin.js。"
              : "管理员密码错误。";
        }
      }
    });
  }

  var AUDIT_TEXT = {
    ok: { cls: "is-ok", text: "✓ 密钥与密文匹配" },
    mismatch: { cls: "is-bad", text: "⚠ 密文与密钥不匹配" },
    nokey: { cls: "is-bad", text: "⚠ 未封装数据密钥" }
  };

  function renderConsole() {
    var channels = window.PRIVATE_CHANNELS_META || [];

    var rows = channels.map(function (m) {
      var r = C.rotationInfo(m.id);
      var a = AUDIT_TEXT[state.audit[m.id]] || { cls: "", text: "—" };
      return (
        '<div class="key-row"><span class="name">' + C.esc(m.name) + "</span>" +
        '<span class="val ' + a.cls + '">' +
        (r.configured ? "已加密 · #" + C.esc(r.keyId || "—") : "未加密") +
        " · " + a.text +
        "</span></div>"
      );
    }).join("");

    var bad = channels.filter(function (m) { return state.audit[m.id] !== "ok"; });

    var options = channels.map(function (m) {
      return '<option value="' + C.esc(m.id) + '">' + C.esc(m.name) + "</option>";
    }).join("");

    root.innerHTML =
      '<div class="gate-kicker">Admin</div>' +
      '<h1 class="view-title">管理控制台</h1>' +
      '<p class="lead">签发一次性或限时分享链接。链接生成后即可直接打开，无需执行命令或重新部署。</p>' +

      (bad.length
        ? '<div class="notice" style="margin-top:18px">' +
          '<p class="notice-title">密钥自检未通过</p>' +
          '<p class="notice-desc">通道「' + C.esc(bad.map(function (m) { return m.name; }).join("、")) +
          "」的密文与封装的数据密钥不一致，签发出的链接会解不开内容。" +
          "请在本地重新执行 <code>node tools/rotate.js &lt;通道&gt;</code>，" +
          '再执行 <code>node tools/set-admin.js "管理员密码"</code>，' +
          "并把 private/channels/、private/admin.vault.js、private/rotation.js 一起推送。</p></div>"
        : "") +

      '<section class="admin-block"><h3 class="admin-h">当前通道</h3>' +
      '<div class="admin-rows">' + rows + "</div>" +
      '<details style="margin-top:14px"><summary class="back-link" style="cursor:pointer">' +
      "查看主密钥（内容钥匙，只给自己看）</summary>" +
      '<p class="pop-hint" style="padding:0;margin-top:10px">每个通道有一把 64 位十六进制的' +
      "主密钥，长期不变，是内容的真正钥匙。忘记链接时可用它直连：" +
      "<code>view.html?c=通道&amp;k=主密钥</code>。发给别人一律用下面的分享链接，" +
      "不要给主密钥。</p>" +
      '<div class="admin-rows">' +
      channels
        .map(function (m) {
          var k = state.keys && state.keys[m.id];
          return (
            '<div class="key-row"><span class="name">' + C.esc(m.name) + "</span>" +
            '<span class="val key-mono">' + C.esc(k || "—") + "</span></div>"
          );
        })
        .join("") +
      "</div></details></section>" +

      '<section class="admin-block"><h3 class="admin-h">签发分享链接</h3>' +
      '<div class="admin-form">' +
      '<label class="admin-field"><span>通道</span>' +
      '<select id="ch">' + options + "</select></label>" +

      '<label class="admin-field"><span>类型</span>' +
      '<select id="kind">' +
      '<option value="timed" selected>限时 · 有效期内可多次打开</option>' +
      '<option value="once">一次性 · 首次查看后作废</option>' +
      "</select></label>" +

      '<label class="admin-field"><span>有效期</span>' +
      '<select id="ttl">' +
      '<option value="0.25">15 分钟</option>' +
      '<option value="1">1 小时</option>' +
      '<option value="6">6 小时</option>' +
      '<option value="24" selected>24 小时</option>' +
      '<option value="168">7 天</option>' +
      "</select>" +
      '<span class="admin-tip" id="ttlTip">到期后链接自动失效，与是否被打开过无关。</span></label>' +

      '<label class="admin-field"><span>备注（可选）</span>' +
      '<input id="label" type="text" placeholder="例如：给张阿姨" maxlength="24"></label>' +

      '<button class="btn" type="button" id="gen">生成密钥并签发链接</button>' +
      "</div><div id=\"genOut\"></div></section>" +

      '<p class="pop-hint" style="padding:0">链接是单一参数令牌，整条复制粘贴即可，中途被截断会明确提示「链接不完整」。' +
      "一次性链接在首次成功查看后失效（含本机预览），请勿自己先点开测试。" +
      "内容更新后需在本地运行 <code>node tools/rotate.js &lt;通道&gt;</code> 重新加密并推送。</p>";
  }

  /* ---------- 签发 ---------- */
  document.addEventListener("click", async function (ev) {
    if (!ev.target.closest("#gen")) return;

    var ch = document.getElementById("ch").value;
    var kind = document.getElementById("kind").value;
    var ttl = Number(document.getElementById("ttl").value);
    var label = document.getElementById("label").value.trim();
    var oneTime = kind === "once";
    /* 一次性必须有硬性到期时间：没选或选成 0 一律按 1 小时，杜绝「永久有效的一次性链接」 */
    if (oneTime && !(ttl > 0)) ttl = 1;
    var dek = state.keys && state.keys[ch];
    var out = document.getElementById("genOut");

    if (!dek) {
      out.innerHTML =
        '<p class="form-msg is-error" style="margin-top:14px">该通道没有封装数据密钥，' +
        "请先在本地运行 <code>node tools/rotate.js " + C.esc(ch) + "</code>，" +
        "再运行 <code>node tools/set-admin.js \"管理员密码\"</code> 重新封装。</p>";
      return;
    }

    if (state.audit[ch] !== "ok") {
      out.innerHTML =
        '<p class="form-msg is-error" style="margin-top:14px">该通道密文与密钥不匹配，' +
        "现在签发的链接一定打不开。请先在本地重跑 <code>node tools/rotate.js " + C.esc(ch) +
        "</code> 与 <code>node tools/set-admin.js</code>，并把三个文件一起推送。</p>";
      return;
    }

    var shareKey = randomKey();
    var issuedAt = Date.now();
    var full, split;
    try {
      full = await C.buildShareToken({
        c: ch,
        dek: dek,
        key: shareKey,
        ttlHours: ttl,
        oneTime: oneTime,
        embed: true
      });
      split = await C.buildShareToken({
        c: ch,
        dek: dek,
        key: shareKey,
        ttlHours: ttl,
        oneTime: oneTime,
        embed: false
      });
    } catch (e) {
      out.innerHTML =
        '<p class="form-msg is-error" style="margin-top:14px">签发失败：' + C.esc(e.message) + "</p>";
      return;
    }

    var base = baseDir();
    /* 单参数令牌：不会再被 & 切断，长度约 70 字符 */
    var link = base + "view.html?s=" + full.token;
    /* 分开发送用：令牌不含密钥，对方需另输分享密钥 */
    var linkSplit = base + "view.html?s=" + split.token;

    out.innerHTML =
      '<div class="admin-rows" style="margin-top:16px">' +
      '<div class="key-row"><span class="name">类型</span><span class="val">' +
      (oneTime ? "一次性 · 首次查看后作废" : "限时 · 有效期内可多次查看") + "</span></div>" +
      '<div class="key-row"><span class="name">签发于</span><span class="val">' +
      fmtTime(issuedAt) + "</span></div>" +
      '<div class="key-row"><span class="name">到期于</span><span class="val">' +
      fmtTime(full.expiresAt) +
      (oneTime ? "（" + ttlLabel(ttl) + "，到期后即使从未被打开也作废）" : "（" + ttlLabel(ttl) + "）") +
      "</span></div>" +
      '<div class="key-row"><span class="name">链接长度</span><span class="val">' +
      link.length + " 字符（令牌 " + full.length + " 字符）</span></div>" +
      (label ? '<div class="key-row"><span class="name">备注</span><span class="val">' + C.esc(label) + "</span></div>" : "") +
      "</div>" +
      '<label class="admin-field" style="margin-top:14px"><span>分享链接（整条复制，打开即看）</span>' +
      '<textarea class="key-out" id="outLink" readonly rows="4">' + link + "</textarea></label>" +
      '<div class="unlock-form" style="margin-top:12px">' +
      '<button class="btn ghost" type="button" data-copy="#outLink">复制链接</button>' +
      '<a class="btn ghost" href="' + link + '" target="_blank" rel="noopener">打开测试</a></div>' +

      '<details style="margin-top:20px"><summary class="back-link" style="cursor:pointer">' +
      "需要分开传送？（链接与密钥各走一条渠道）</summary>" +
      '<label class="admin-field" style="margin-top:12px"><span>分享密钥</span>' +
      '<textarea class="key-out" id="outKey" readonly rows="2">' + shareKey + "</textarea></label>" +
      '<label class="admin-field"><span>不含密钥的链接（对方需输入上面的密钥）</span>' +
      '<textarea class="key-out" id="outSplit" readonly rows="3">' + linkSplit + "</textarea></label>" +
      '<div class="unlock-form" style="margin-top:12px">' +
      '<button class="btn ghost" type="button" data-copy="#outKey">复制密钥</button>' +
      '<button class="btn ghost" type="button" data-copy="#outSplit">复制链接</button></div>' +
      "</details>";
  });

  /* 切换类型时把有效期调到合理默认：一次性默认 1 小时，切回限时还原原来的选择 */
  var lastTimedTtl = "24";
  document.addEventListener("change", function (ev) {
    if (!ev.target || ev.target.id !== "kind") return;
    var once = ev.target.value === "once";
    var sel = document.getElementById("ttl");
    var tip = document.getElementById("ttlTip");
    if (sel) {
      if (once) {
        var v = Number(sel.value);
        if (v > 1) {
          lastTimedTtl = sel.value;
          sel.value = "1";
        }
      } else if (lastTimedTtl) {
        sel.value = lastTimedTtl;
      }
    }
    if (tip) {
      tip.textContent = once
        ? "一次性链接默认 1 小时到期，建议不要超过 1 小时——它靠收件人本机记账，换设备/清缓存可重看，短有效期是主要防线。"
        : "到期后链接自动失效，与是否被打开过无关。";
    }
  });

  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-copy]");
    if (!btn) return;
    var ta = document.querySelector(btn.getAttribute("data-copy"));
    if (!ta) return;
    ta.select();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ta.value).then(function () {
        C.toast("已复制");
      }).catch(function () {
        C.toast("复制失败，请手动选择");
      });
    } else {
      C.toast("请手动复制");
    }
  });

  /* ---------- 页脚版本号（确认线上跑的是哪一版） ---------- */
  var verEl = document.getElementById("appVersion");
  if (verEl && window.CARD_CONFIG && CARD_CONFIG.version) {
    verEl.textContent = "v" + CARD_CONFIG.version;
  }

  /* ---------- 启动 ---------- */
  if (!C.isOnline()) {
    root.innerHTML =
      '<div class="offline-card"><p class="offline-title">离线无法使用</p>' +
      '<p class="offline-desc">管理控制台需要在线校验。</p>' +
      '<a class="btn ghost" href="../index.html">返回公开名片</a></div>';
    return;
  }

  gateForm();
})();
