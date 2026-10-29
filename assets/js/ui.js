/**
 * 全站 UI 层：顶栏、设置浮层、主题、Toast
 * 公开页与私密页共用，保证右上角按钮区完全一致。
 *
 * 依赖 <body data-page="public|private" data-root=""> 标明页面与相对根路径。
 */
(function () {
  "use strict";

  var THEMES = [
    { id: "mono", name: "墨黑", color: "#f2f0ec" },
    { id: "paper", name: "纸白", color: "#16151a" },
    { id: "ink", name: "靛蓝", color: "#2f5bd0" },
    { id: "wine", name: "酒红", color: "#8c2f3c" },
    { id: "forest", name: "松绿", color: "#2f6b47" }
  ];

  var STORAGE_KEY = "card-theme";

  var ICONS = {
    lock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.2"/>' +
      '<path d="M8.2 10.4V7.9a3.8 3.8 0 0 1 7.6 0v2.5"/></svg>',
    gear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3.1"/>' +
      '<path d="M12 2.9v2.2M12 18.9v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.9 12h2.2M18.9 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>',
    key:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H21M18 12v3"/></svg>'
  };

  /* ---------- 主题 ---------- */
  function getTheme() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return THEMES.some(function (t) { return t.id === v; }) ? v : "mono";
    } catch (e) {
      return "mono";
    }
  }

  function applyTheme(id) {
    document.documentElement.setAttribute("data-theme", id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {
      /* 隐私模式写入失败，静默忽略 */
    }
    document.querySelectorAll(".theme-item").forEach(function (btn) {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-theme-value") === id ? "true" : "false"
      );
    });
  }

  /* ---------- Toast ---------- */
  var toastEl = null;
  var toastTimer = null;

  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    // 强制重排，保证连续调用时动画重放
    void toastEl.offsetWidth;
    toastEl.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-show");
    }, ms || 2600);
  }

  /* ---------- 顶栏 ---------- */
  function renderTopbar() {
    var host = document.getElementById("topbar");
    if (!host) return;

    var page = document.body.dataset.page || "public";
    var root = document.body.dataset.root || "";
    var isPrivate = page === "private";

    var themeItems = THEMES.map(function (t) {
      return (
        '<button class="theme-item" type="button" data-theme-value="' + t.id +
        '" aria-pressed="false">' +
        '<i style="--c:' + t.color + '"></i><span>' + t.name + "</span></button>"
      );
    }).join("");

    var privateBtn = isPrivate
      ? '<span class="icon-btn" aria-current="page" title="私密通道（当前页）">' + ICONS.lock + "</span>"
      : '<a class="icon-btn" href="' + root + 'private/" title="私密通道" aria-label="私密通道">' +
        ICONS.lock + "</a>";

    host.innerHTML =
      '<a class="brand" href="' + root + 'index.html">Dewey<span class="dot">.</span></a>' +
      '<div class="actions">' +
      privateBtn +
      '<button class="icon-btn" id="settingsBtn" type="button" aria-expanded="false" ' +
      'aria-controls="settingsPop" aria-label="设置" title="设置">' + ICONS.gear + "</button>" +
      "</div>" +
      '<div class="settings-pop" id="settingsPop" hidden>' +
      '<p class="pop-label">主题</p>' +
      '<div class="theme-list">' + themeItems + "</div>" +
      '<p class="pop-hint">设置仅影响外观，不涉及任何密钥操作。</p>' +
      "</div>";

    bindTopbar();
  }

  function bindTopbar() {
    var btn = document.getElementById("settingsBtn");
    var pop = document.getElementById("settingsPop");
    if (!btn || !pop) return;

    function close() {
      pop.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var open = pop.hidden;
      pop.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    pop.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var item = ev.target.closest(".theme-item");
      if (item) {
        applyTheme(item.getAttribute("data-theme-value"));
      }
    });

    document.addEventListener("click", close);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !pop.hidden) close();
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    renderTopbar();
    applyTheme(getTheme());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CardUI = {
    toast: toast,
    applyTheme: applyTheme,
    icons: ICONS,
    themes: THEMES
  };
})();
