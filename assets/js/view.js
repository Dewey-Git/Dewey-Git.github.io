/**
 * 私密内容页（独立页面，支持分享链接直接查看）
 *
 * v9 链接格式（推荐，单一参数，短且不会被 & 截断）：
 *   view.html?s=<令牌>            令牌内已含 通道 / 分享密钥 / 有效期（约 70 字符）
 *   view.html#s=<令牌>            同上（放片段里，不进服务器日志）
 *   view.html?s=<令牌>            令牌不带密钥时，页面只要求补「分享密钥」
 *
 * 兼容旧格式（v8 及更早签发的链接仍然可开）：
 *   view.html?s=<v8 令牌> / view.html?c=&k=&p= / view.html?c=&p=
 *
 * 解锁模型：
 *   内容 → 数据密钥 DEK（长期不变，加密在本地完成）
 *   分享 → 令牌里的 DEK 被「分享密钥」派生的密钥流封装，自带过期时间与一次性标记
 */
(function () {
  "use strict";

  var C = window.CardCrypto;
  var U = window.CardUnlock;
  var root = document.getElementById("viewRoot");
  var ttlEl = document.getElementById("ttl");
  if (!root || !C || !U) return;

  var params = new URLSearchParams(location.search);

  /* ---------- 从 URL 取令牌 / 旧参数 ---------- */
  var tokenStr = params.get("s") || "";
  if (!tokenStr) {
    var hash = (location.hash || "").replace(/^#/, "");
    if (hash.indexOf("s=") === 0) tokenStr = hash.slice(2);
    else if (hash.length > 30 && hash.indexOf("=") === -1) tokenStr = hash;
  }

  var legacy = {
    c: params.get("c") || "",
    k: params.get("k") || "",
    p: params.get("p") || ""
  };

  var state = {
    channel: legacy.c || "dating",
    meta: null,
    keyNeeded: false,
    legacyTicket: "",
    expiresAt: 0,
    ticketExpiresAt: 0,
    timer: null
  };

  var metaList =
    window.PRIVATE_CHANNELS_META ||
    (typeof PRIVATE_CHANNELS_META !== "undefined" ? PRIVATE_CHANNELS_META : []) ||
    [];

  function resolveMeta(id) {
    for (var i = 0; i < metaList.length; i++) {
      if (metaList[i].id === id) return metaList[i];
    }
    return { id: id, name: id };
  }

  function setChannel(id) {
    if (!id || id === state.channel) return;
    state.channel = id;
    state.meta = resolveMeta(id);
    document.title = state.meta.name + " · 私密";
  }

  state.meta = resolveMeta(state.channel);
  document.title = state.meta.name + " · 私密";

  /* ---------- 渲染片段 ---------- */
  function notice(title, desc) {
    return (
      '<div class="notice">' +
      '<p class="notice-title">' + C.esc(title) + "</p>" +
      '<p class="notice-desc">' + C.esc(desc) + "</p>" +
      "</div>"
    );
  }

  function stopTimers() {
    state.expiresAt = 0;
    state.ticketExpiresAt = 0;
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    if (ttlEl) {
      ttlEl.hidden = true;
      ttlEl.textContent = "";
    }
  }

  function wipe() {
    stopTimers();
    root.innerHTML = "";
  }

  /* ---------- 各种状态（返回通道列表的入口只有页面顶部那一个） ---------- */
  function renderEnvError() {
    wipe();
    root.innerHTML = notice(
      "当前环境不可用",
      "浏览器未提供 Web Crypto（可能通过 file:// 打开）。请使用 https 或本地 http 服务器访问。"
    );
  }

  function renderOffline() {
    wipe();
    root.innerHTML =
      '<div class="offline-card">' +
      '<p class="offline-title">离线无法使用</p>' +
      '<p class="offline-desc">检测到当前处于离线状态。私密内容需要在线解密校验，' +
      "离线时仅可浏览公开名片页。</p>" +
      '<a class="btn ghost" href="../index.html">返回公开名片</a></div>';
  }

  function renderExpired(at) {
    wipe();
    var when = at
      ? "这条链接的有效期在 " + new Date(at).toLocaleString("zh-CN") + " 结束。"
      : "这条限时 / 一次性链接的有效期已结束。";
    root.innerHTML = notice("链接已过期", when + "请向本人索取新的分享链接。");
  }

  function renderUsed(at) {
    wipe();
    var extra = at
      ? "另外它会在 " + new Date(at).toLocaleString("zh-CN") + " 硬性到期。"
      : "";
    root.innerHTML = notice(
      "该链接已被使用",
      "这是一次性链接，已在本设备完成过一次查看。" + extra +
        "如需再次查看，请向本人索取新链接。"
    );
  }

  function renderBrokenLink() {
    wipe();
    root.innerHTML = notice(
      "链接不完整",
      "这条分享链接在传递过程中被截断了（常见于聊天软件的链接预览、短链服务或手动复制不全）。" +
      "请让本人再发一次完整链接，用「复制链接」按钮整段复制。"
    );
  }

  /* ---------- 入口：不再有整页密钥表单 ----------
   * v14 起密钥输入挂在入口页：点通道面板里的加密内容框，输入框就地展开。
   *   · 完全没有令牌 → 引导回通道列表
   *   · 令牌缺分享密钥 → 就地弹「补分享密钥」
   *   · 早期 JSON 票据 → 同上，校验走 legacyOpenTicket
   */
  function renderEntry(title, desc, extra) {
    wipe();
    root.innerHTML =
      notice(
        title || "请从通道列表进入",
        desc ||
          "私密内容不再单独提供「输入密钥」的独立页面：回到通道列表，点那个加密的内容框，密钥输入会在框里展开。"
      ) +
      (extra || "") +
      '<div class="view-actions"><a class="btn" href="index.html">去通道列表</a>' +
      '<a class="back-link" href="../index.html">返回公开名片</a></div>';
  }

  function holding(text) {
    wipe();
    root.innerHTML = '<p class="gate-hold">' + C.esc(text) + "</p>";
  }

  /* 补分享密钥（v9 令牌：链接里没有内嵌密钥） */
  function promptShareKey(token, errorMsg) {
    holding("链接已就位，正在等你补上分享密钥。");
    if (errorMsg) C.toast(errorMsg, 3400);

    U.open({
      channel: state.channel,
      mode: "sharekey",
      token: token,
      onDone: function (res) {
        renderContent(res.data, res.info || {});
      },
      onClose: function () {
        renderEntry("还没有解锁", "缺少分享密钥，这条链接暂时打不开。");
      }
    });
  }

  /* 补分享密钥（v8 及更早的 JSON 票据） */
  function promptLegacyKey(ticket, errorMsg) {
    holding("这是一条早期格式的链接，还需要配套的分享密钥。");
    if (errorMsg) C.toast(errorMsg, 3400);

    U.open({
      channel: state.channel,
      mode: "key",
      title: "补上分享密钥",
      desc: "这条链接是早期版本签发的。分享密钥不会写在链接里，通常和链接分开两条消息发。",
      placeholder: "分享密钥（32 位十六进制）",
      onSubmit: async function (raw) {
        var t;
        try {
          t = await C.legacyOpenTicket(ticket, raw);
        } catch (e) {
          return { ok: false, code: "bad-share-key" };
        }
        if (t.expiresAt && Date.now() > t.expiresAt) return { ok: false, code: "link-expired" };

        var payload;
        try {
          payload = await C.ensureChannel(state.channel);
        } catch (e) {
          return { ok: false, code: "no-payload" };
        }

        try {
          var data = await C.decryptPayload(payload, t.dek);
          return {
            ok: true,
            data: data,
            info: { via: "legacy", expiresAt: t.expiresAt, oneTime: !!t.oneTime }
          };
        } catch (e) {
          return { ok: false, code: "wrong-key" };
        }
      },
      onDone: function (res) {
        renderContent(res.data, res.info || {});
      },
      onClose: function () {
        renderEntry("还没有解锁", "缺少分享密钥，这条旧链接暂时打不开。");
      }
    });
  }

  /* ---------- 会话 + 链接双重计时 ---------- */
  function startTimers() {
    state.expiresAt = Date.now() + C.cfg.sessionMinutes * 60 * 1000;

    if (ttlEl) {
      ttlEl.hidden = false;
      ttlEl.textContent = "本次查看 " + C.fmtDuration(C.cfg.sessionMinutes * 60 * 1000);
    }

    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () {
      /* 会话到期 → 清空内容，要求重新打开链接 */
      var left = state.expiresAt - Date.now();
      if (left <= 0) {
        stopTimers();
        renderEntry("查看已过期", "本次查看的 " + C.cfg.sessionMinutes + " 分钟已经用完，内容已从页面清除。重新打开链接即可。");
        C.toast("查看已过期，已清除内容");
        return;
      }
      if (ttlEl) ttlEl.textContent = "本次查看 " + C.fmtDuration(left);

      /* 链接到期 → 直接作废 */
      var tLeft = state.ticketExpiresAt - Date.now();
      if (state.ticketExpiresAt && tLeft <= 0) {
        stopTimers();
        renderExpired(state.ticketExpiresAt);
        return;
      }
      var badge = document.getElementById("ticketTtl");
      if (badge && state.ticketExpiresAt) {
        badge.textContent = "剩余 " + C.fmtDuration(tLeft);
      }
    }, 1000);
  }

  /* ---------- 解密：v9 分享令牌 ---------- */
  async function openToken(tk, shareKey) {
    var t;
    try {
      t = await C.openShareToken(tk, shareKey || "");
    } catch (err) {
      var m = err && err.message;
      if (m === "need-key") {
        if (err.channel) setChannel(err.channel);
        return promptShareKey(tk);
      }
      if (m === "bad-key") {
        return renderBrokenLink();
      }
      return renderBrokenLink();
    }

    state.keyNeeded = false;
    setChannel(t.c);

    if (t.expiresAt && Date.now() > t.expiresAt) return renderExpired(t.expiresAt);

    var tid = t.oneTime ? await C.tokenId(tk) : "";
    if (t.oneTime && C.usedKeyId(tid)) return renderUsed(t.expiresAt);

    var payload;
    try {
      payload = await C.ensureChannel(t.c);
    } catch (e) {
      return renderEntry("这个通道还没有密文", "页面上的密文文件缺失，请先运行 node tools/rotate.js " + t.c + " 重新生成。");
    }

    var data;
    try {
      data = await C.decryptPayload(payload, t.dek);
    } catch (e) {
      /* 令牌本身自洽（校验标签通过），说明站点上的密文和密钥文件不是同一批 */
      return renderEntry(
        "链接有效，但密文对不上",
        "通常是只推送了部分文件。请把 private/channels/*、private/quiz.enc.js、" +
          "private/admin.vault.js、private/rotation.js 一起更新后重试。"
      );
    }

    /* 成功后才写入「已使用」，避免失败一次就报废链接 */
    if (t.oneTime) C.markUsed(tid);

    renderContent(data, { oneTime: t.oneTime, expiresAt: t.expiresAt, via: "token" });
  }

  /* ---------- 解密：v8 及更早的 JSON 票据 ---------- */
  async function openLegacy(tk, directKey, directTicket) {
    var c = legacy.c, k = directKey || legacy.k, p = directTicket || legacy.p;

    if (tk) {
      var u = C.legacyUnpack(tk);
      if (!u) return renderBrokenLink();
      c = c || u.c;
      k = k || u.k;
      p = p || u.p;
    }
    if (c) setChannel(c);
    if (!p) return k ? attemptDek(k) : renderEntry();

    if (!k) {
      state.legacyTicket = p;
      return promptLegacyKey(p);
    }
    return attemptLegacyTicket(k, p);
  }

  async function attemptLegacyTicket(shareKey, ticket) {
    var t;
    try {
      t = await C.legacyOpenTicket(ticket, shareKey);
    } catch (err) {
      if (err && err.message === "bad-ticket") return renderBrokenLink();
      return promptLegacyKey(ticket, "分享密钥与这条链接不匹配。");
    }

    if (t.expiresAt && Date.now() > t.expiresAt) return renderExpired(t.expiresAt);

    var tid = t.oneTime ? await C.tokenId(ticket) : "";
    if (t.oneTime && C.usedKeyId(tid)) return renderUsed(t.expiresAt);

    var payload;
    try {
      payload = await C.ensureChannel(state.channel);
    } catch (e) {
      return renderEntry("这个通道还没有密文", "请先运行 node tools/rotate.js " + state.channel + "。");
    }

    var data;
    try {
      data = await C.decryptPayload(payload, t.dek);
    } catch (e) {
      return renderEntry(
        "链接有效，但密文对不上",
        "通常是只推送了部分文件，请同时更新 private/channels/*、private/admin.vault.js、private/rotation.js。"
      );
    }

    if (t.oneTime) C.markUsed(tid);
    renderContent(data, { oneTime: t.oneTime, expiresAt: t.expiresAt, via: "legacy" });
  }

  /* ---------- 解密：主密钥直连（本人备用） ---------- */
  async function attemptDek(key) {
    var payload;
    try {
      payload = await C.ensureChannel(state.channel);
    } catch (e) {
      return renderEntry("这个通道还没有密文", "请先运行 node tools/rotate.js " + state.channel + "。");
    }

    var data;
    try {
      data = await C.decryptPayload(payload, key);
    } catch (e) {
      /* 分享密钥是 32 位、主密钥是 64 位十六进制——帮用户认出自己粘错了 */
      var looksShareKey = /^[0-9a-f]{32}$/i.test(key);
      return renderEntry(
        "密钥不正确",
        looksShareKey
          ? "32 位的是分享密钥，它必须配合完整分享链接使用。请改用本人发来的链接打开。"
          : "链接里的主密钥解不开这个通道的内容，请向本人要一条新的分享链接。"
      );
    }

    renderContent(data, { oneTime: false, expiresAt: 0, master: true });
  }

  /* ---------- 内容渲染 ---------- */
  function renderContent(data, info) {
    var badge = "";
    if (info.oneTime) {
      badge = '<p class="badge-line">一次性链接 · 本次查看后失效</p>';
    } else if (!info.expiresAt && info.via === "token") {
      /* 测试解锁令牌是长期有效的（expiresAt = 0），不能按倒计时显示 */
      badge = '<p class="badge-line">测试解锁 · 长期有效</p>';
    } else if (info.master) {
      badge = '<p class="badge-line">主密钥访问 · 长期有效</p>';
    } else if (!info.expiresAt) {
      badge = '<p class="badge-line">主密钥访问 · 长期有效</p>';
    } else {
      badge =
        '<p class="badge-line">限时链接 · <span id="ticketTtl">' +
        C.fmtDuration(info.expiresAt - Date.now()) +
        "</span></p>";
    }

    root.innerHTML =
      badge +
      C.renderPayload(data) +
      (state.channel === "soul"
        ? '<div class="view-actions"><a class="back-link" href="quiz.html?c=soul">' +
          "顺便做个默契测试 →</a></div>"
        : "");

    state.ticketExpiresAt = info.expiresAt || 0;

    startTimers();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    if (!C.hasSubtle) return renderEnvError();
    if (!C.isOnline()) return renderOffline();

    if (tokenStr) {
      if (tokenStr.indexOf("eyJ") === 0) return openLegacy(tokenStr);
      return openToken(tokenStr, "");
    }
    if (legacy.p || legacy.k) return openLegacy("");
    renderEntry();
  }

  window.addEventListener("offline", function () {
    if (!C.isOnline()) renderOffline();
  });
  window.addEventListener("online", function () {
    /* 仅在当前处于离线提示态时重新引导，避免覆盖已解锁的内容 */
    if (document.querySelector(".offline-card")) boot();
  });

  boot();
})();
