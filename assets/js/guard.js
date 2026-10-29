/**
 * 全站内容守卫（v9）
 * ------------------------------------------------------------
 * 目标：整个名片界面不允许复制、不允许另存 / 打印、尽量增加截图的成本。
 *
 * 具体做了四件事：
 *   1. 选区层：CSS 关闭文本选择、拖拽、长按菜单；JS 拦截 copy / cut /
 *      contextmenu / selectstart / dragstart。
 *   2. 快捷键层：拦 Ctrl/⌘ + C X A S P U、F12 与 PrintScreen。
 *   3. 可见层：窗口失焦 / 切到后台 / 打开开发者工具时，主体内容立即模糊，
 *      回来才恢复——录屏、截图工具切窗口时抓到的是一层毛玻璃。
 *   4. 溯源层：铺一层「说明 + 当前时间」的浅色水印，截图流出后能看出时间。
 *
 * 必须说明的边界：浏览器无法阻止操作系统级截图（系统截屏、手机截图、
 * 相机拍屏）。这里做到的是「抬高质量成本」而不是「物理禁止」。
 */
(function () {
  "use strict";

  if (window.__cardGuard) return;
  window.__cardGuard = true;

  var doc = document;
  var body = doc.body;
  var allowCopySelector = "input, textarea, [data-allow-copy]";

  function isAllowed(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(allowCopySelector);
  }

  function warn(msg) {
    if (window.CardUI && window.CardUI.toast) window.CardUI.toast(msg, 1800);
  }

  /* ---------- 1. 选区 / 右键 / 拖拽 ---------- */
  ["copy", "cut", "contextmenu", "selectstart", "dragstart"].forEach(function (type) {
    doc.addEventListener(
      type,
      function (ev) {
        if (isAllowed(ev.target)) return;
        ev.preventDefault();
        if (type === "copy" || type === "cut") warn("内容不可复制");
      },
      true
    );
  });

  /* ---------- 2. 快捷键 ---------- */
  doc.addEventListener(
    "keydown",
    function (ev) {
      var k = String(ev.key || "");
      var lower = k.toLowerCase();
      var meta = ev.ctrlKey || ev.metaKey;

      if (lower === "printscreen" || k === "PrintScreen") {
        ev.preventDefault();
        hideContent();
        wipeClipboard();
        warn("截图已拦截：内容已临时隐藏");
        return;
      }

      if (!meta) {
        if (lower === "f12") {
          ev.preventDefault();
          hideContent();
          warn("调试工具不可用");
        }
        return;
      }

      if (isAllowed(ev.target)) return;

      if (["c", "x", "a", "s", "p", "u"].indexOf(lower) !== -1) {
        ev.preventDefault();
        warn(lower === "s" || lower === "p" ? "页面不可保存 / 打印" : "内容不可复制");
      }
    },
    true
  );

  /* 某些浏览器只把 PrintScreen 交给 keyup */
  doc.addEventListener("keyup", function (ev) {
    if (String(ev.key || "") === "PrintScreen") {
      hideContent();
      wipeClipboard();
      warn("截图已拦截：内容已临时隐藏");
    }
  }, true);

  function wipeClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText("截图已拦截 · 内容禁止外传");
      }
    } catch (e) {
      /* 无权限时忽略 */
    }
  }

  /* ---------- 3. 失焦即遮蔽 ---------- */
  var blurTimer = null;

  function hideContent() {
    if (body) body.classList.add("is-shielded");
  }

  function showContent() {
    if (body) body.classList.remove("is-shielded");
  }

  window.addEventListener("blur", function () {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(function () {
      var active = doc.activeElement;
      if (isAllowed(active)) return;
      if (doc.hasFocus && doc.hasFocus()) return;
      hideContent();
    }, 120);
  });

  window.addEventListener("focus", showContent);

  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden) hideContent();
    else showContent();
  });

  /* ---------- 4. 水印：一句说明 + 时间 ---------- */
  function stamp() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : String(n); }
    return (
      d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes())
    );
  }

  function noteText() {
    var cfg = window.CARD_CONFIG || {};
    return cfg.watermarkText || "仅限本人查看 · 请勿外传";
  }

  function wmSvg(note, time) {
    function esc(x) {
      return String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="190">' +
      '<g transform="rotate(-24 180 95)" fill="rgba(140,140,140,0.18)" ' +
      'font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">' +
      '<text x="12" y="98" font-size="13">' + esc(note) + "</text>" +
      '<text x="12" y="121" font-size="11.5">' + esc(time) + "</text>" +
      "</g></svg>"
    );
  }

  function buildWatermark() {
    var wm = doc.createElement("div");
    wm.className = "guard-wm";
    wm.setAttribute("aria-hidden", "true");
    wm.style.backgroundImage =
      'url("data:image/svg+xml,' + encodeURIComponent(wmSvg(noteText(), stamp())) + '")';
    doc.body.appendChild(wm);

    /* 每分钟刷新时间，删掉旧水印也会被重新盖上 */
    setInterval(function () {
      wm.style.backgroundImage =
        'url("data:image/svg+xml,' + encodeURIComponent(wmSvg(noteText(), stamp())) + '")';
    }, 60000);
  }

  /* ---------- 5. 打印 / 另存 PDF ---------- */
  if (window.matchMedia) {
    try {
      window.matchMedia("print").addEventListener("change", function (e) {
        if (e.matches) hideContent();
      });
    } catch (err) {
      /* 老浏览器忽略 */
    }
  }

  function start() {
    buildWatermark();
    /* 离开页面时清掉可能的残留 */
    window.addEventListener("pagehide", function () {
      showContent();
    });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
})();
