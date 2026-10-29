/**
 * 公开页：极简信息卡
 * 渲染顺序：首屏舞台（照片 + 姓名）→ 职业信息 → 联系方式
 *
 * 首屏是一层固定舞台：往下滚时照片与姓名不随页面上移，而是同步形变成
 * 「左侧竖版照片 + 右侧姓名职位」并冻结在顶部。形变进度 --p（0→1）
 * 在这里按滚动位置算出并写到 <html> 上，具体插值全部由 style.css 完成，
 * 因此滚动过程只有一次样式写入，不读布局、不触发重排。
 */
(function () {
  "use strict";

  var app = document.getElementById("app");
  if (!app || typeof PROFILE === "undefined") return;

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /* ---------- 首屏舞台：照片 + 姓名 ---------- */
  function hero() {
    var line = [];
    if (PROFILE.position) line.push(esc(PROFILE.position));
    if (PROFILE.company) line.push(esc(PROFILE.company));

    /* 竖构图照片：方形取景时就是头像，拉长后露出更多身体 */
    var photo = PROFILE.photo || PROFILE.avatar;

    return el(
      '<section class="hero-card" id="sec-top" aria-label="名片">' +
        '<figure class="hero-media">' +
        '<img class="avatar" src="' + esc(photo) + '" alt="' + esc(PROFILE.name) + ' 的照片" ' +
        'decoding="async">' +
        "</figure>" +
        '<div class="hero-main">' +
        '<p class="eyebrow">' + esc(PROFILE.title || "电子名片") + "</p>" +
        '<h1 class="name">' + esc(PROFILE.name) + "</h1>" +
        (line.length ? '<p class="tagline">' + line.join('<span class="dot-sep">·</span>') + "</p>" : "") +
        (PROFILE.signature
          ? '<img class="signature" src="' + esc(PROFILE.signature) + '" ' +
            'alt="' + esc(PROFILE.name) + ' 的手写签名" decoding="async">'
          : "") +
        "</div></section>"
    );
  }

  /* ---------- 职业信息：与联系方式同一套列表样式 ---------- */
  function career() {
    var c = PROFILE.career;
    if (!c) return null;

    var rows = [
      { label: "职称", value: c.role || PROFILE.position },
      { label: "集团", value: c.company || PROFILE.company },
      { label: "部门", value: c.department },
      { label: "工作地点", value: c.location },
      { label: "技术方向", value: c.focus }
    ]
      .filter(function (r) { return !!r.value; })
      .map(function (r) {
        return (
          "<li><span class=\"label\">" + esc(r.label) + "</span>" +
          '<span class="plain">' + esc(r.value) + "</span></li>"
        );
      })
      .join("");

    return el(
      '<section class="section career" id="sec-career">' +
        '<div class="section-head"><span class="idx">01</span><h2>职业信息</h2></div>' +
        '<ul class="contact-list">' + rows + "</ul>" +
        "</section>"
    );
  }

  /* ---------- 联系 ---------- */
  function contact() {
    var rows = (PROFILE.contacts || []).map(function (c) {
      var body = c.href
        ? '<a href="' + esc(c.href) + '">' + esc(c.value) + "</a>"
        : '<span class="plain">' + esc(c.value) + "</span>";
      return '<li><span class="label">' + esc(c.label) + "</span>" + body + "</li>";
    }).join("");

    return el(
      '<section class="section contact" id="sec-contact">' +
        '<div class="section-head"><span class="idx">02</span><h2>联系方式</h2></div>' +
        '<ul class="contact-list">' + rows + "</ul>" +
        "</section>"
    );
  }

  function footer() {
    var f = PROFILE.footer || {};
    return el(
      '<footer class="site-footer"><span>' + esc(f.left || "") +
      "</span><span>" + esc(f.right || "") + "</span></footer>"
    );
  }

  /* ---------- 组装 ---------- */
  app.appendChild(hero());

  /*
   * 正文单独包一层：形变时平移这一层做「同步补偿」。
   * 不能包在 .page 或 #app 上——顶栏和 hero 都是 fixed，一旦祖先有 transform
   * 就会改以该祖先为定位基准，冻结效果直接失效。
   */
  var flow = document.createElement("div");
  flow.className = "page-flow";

  [career(), contact(), footer()]
    .filter(function (node) { return !!node; })
    .forEach(function (node, i) {
      node.classList.add("js-reveal");
      node.style.animationDelay = Math.min(i * 55, 200) + "ms";
      flow.appendChild(node);
    });

  app.appendChild(flow);

  /* ---------- 章节 ---------- */
  var SECTIONS = [
    { id: "sec-top", label: "名片" },
    { id: "sec-career", label: "职业" },
    { id: "sec-contact", label: "联系" }
  ].filter(function (s) {
    return s.id === "sec-top" || document.getElementById(s.id);
  });

  /* ---------- 滚动形变 ---------- */
  var root = document.documentElement;
  var runway = 320; /* 形变占用的滚动距离 */
  var hdrH = 116;   /* 冻结条高度，从 CSS 读（移动端是 104） */
  var syncBase = 0; /* 形变期间舞台要收缩掉的高度 = 视口高 - 冻结条 */
  var lastP = -1;
  var lastSync = 0;
  var frozen = false;
  var queued = false;
  var navLinks = [];
  var navTops = []; /* 各章节的文档位置，只在测量时读一次，避免每帧重排 */
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function scrollTop() {
    return window.pageYOffset || root.scrollTop || document.body.scrollTop || 0;
  }

  function measure() {
    var vh = window.innerHeight || root.clientHeight || 720;
    hdrH = parseFloat(getComputedStyle(document.body).getPropertyValue("--hdr-h")) || 116;
    syncBase = Math.max(vh - hdrH, 240);

    /*
     * 正文与舞台同步滑动，形变这一段舞台要收缩掉 (vh - hdr)，
     * 所以 runway 越长画面越从容；上限就取收缩量（此时正文正好 1:1 上移）。
     */
    runway = Math.round(Math.min(Math.max(vh * 0.6, 340), syncBase));
    root.style.setProperty("--runway", runway + "px");

    /*
     * 量一次「冻结态」文字块高度，取半高并取整写进 --shift：
     * 文字块高度常带小数，直接 -50% 会得到 -23.906px 这种亚像素位移，
     * 合成层只能把文字位图重采样，于是冻结后看着发虚。
     */
    var mainEl = app.querySelector(".hero-main");
    if (mainEl) {
      var keepP = root.style.getPropertyValue("--p");
      var keepQy = root.style.getPropertyValue("--qy");
      root.style.setProperty("--p", "1");
      root.style.setProperty("--qy", "1");
      var h = mainEl.getBoundingClientRect().height;
      root.style.setProperty("--p", keepP || "0");
      root.style.setProperty("--qy", keepQy || "0");
      if (h > 0) root.style.setProperty("--shift", Math.round(h / 2) + "px");
    }

    /*
     * 章节位置用「视口坐标 + 滚动量 - 当前补偿」反推，而不是 offsetTop：
     * .page-flow 带 transform，Chrome 会把它当成 offsetParent，
     * 于是 offsetTop 变成相对这一层、不再等于文档位置。
     */
    navTops = SECTIONS.map(function (s) {
      var node = document.getElementById(s.id);
      if (!node) return Infinity;
      return node.getBoundingClientRect().top + scrollTop() - lastSync;
    });
  }

  function syncNav(y) {
    if (!navLinks.length) return;
    var line = y + (window.innerHeight || 0) * 0.42;
    var current = "sec-top";
    for (var i = 1; i < SECTIONS.length; i++) {
      /* 正文整层被 --sync 平移过，章节的实际视觉位置要跟着加回来 */
      if (navTops[i] + lastSync <= line) current = SECTIONS[i].id;
    }
    navLinks.forEach(function (a) {
      a.classList.toggle("is-active", a.getAttribute("data-target") === current);
    });
  }

  /* 把任意输入夹到 0..1 后做 smoothstep（两端速度为零，接缝不顿） */
  function ramp(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  function paint() {
    queued = false;
    var y = scrollTop();
    var raw = runway > 0 ? y / runway : 1;
    if (raw <= 0) raw = 0;
    else if (raw >= 1) raw = 1;

    /* smoothstep：起步与收尾都柔和，中段才明显位移 */
    var p = raw * raw * (3 - 2 * raw);
    /* 收尾必须精确落到 1：差 0.0003 都会让字号停在 19.0042px，看起来发虚 */
    if (raw >= 1) p = 1;
    if (reduceMotion) p = raw > 0.02 ? 1 : 0;

    /*
     * 三个进度分工，避免文字与照片撞在一起：
     *   --px  照片先走到左边（0→1 提前走完），此后只在原地收窄；
     *   --qy  文字等照片让开位置后再升起，落到右侧；
     *   --p   总进度：照片尺寸、卡片高度、字号都跟着它线性推进。
     * 这样全程「文字左沿 ≥ 照片右沿 + 间距」，不会出现半张字被照片切掉。
     */
    var px = ramp(p / 0.9);          /* 照片横移稍微提前收尾，给文字腾出位置 */
    var qy = ramp((p - 0.72) / 0.28); /* 文字 0.72 之后才起身，1.0 到位 */

    /*
     * 正文同步：让正文上沿恒等于「舞台下沿 + 72px」。
     * 舞台下沿 = vh - (vh - hdr) * p，正文自然位置 = vh + 72 - y，
     * 故补偿量 = y - (vh - hdr) * p。形变结束后 y 被夹住，补偿量成为定值，
     * 正文恢复 1:1 正常滚动。
     */
    var sync = reduceMotion ? 0 : Math.round(Math.min(y, runway) - syncBase * p);

    if (p !== lastP || sync !== lastSync) {
      lastP = p;
      lastSync = sync;
      root.style.setProperty("--p", p.toFixed(4));
      root.style.setProperty("--px", px.toFixed(4));
      root.style.setProperty("--qy", qy.toFixed(4));
      root.style.setProperty("--sync", sync + "px");

      /* 冻结成型后不再变化，撤掉 will-change，别让文字一直待在合成层位图里 */
      if ((p >= 1) !== frozen) {
        frozen = p >= 1;
        document.body.classList.toggle("is-frozen", frozen);
      }
    }
    syncNav(y);
  }

  /*
   * 带 #hash 直接打开（或刷新）时，浏览器先按未补偿的位置落位，
   * 之后 --sync 才把正文整体上移，落点会偏。补偿生效后再校一次。
   */
  if (location.hash) {
    var anchor = document.getElementById(location.hash.slice(1));
    if (anchor) {
      window.requestAnimationFrame(function () {
        anchor.scrollIntoView({ block: "start" });
      });
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(paint);
  }

  measure();
  paint();

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", function () {
    measure();
    lastP = -1;
    schedule();
  });
  window.addEventListener("load", function () {
    measure();
    lastP = -1;
    schedule();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      measure();
      lastP = -1;
      schedule();
    });
  }

  /* ---------- 时间轴：内容过短时自动隐藏 ---------- */
  var longEnough = root.scrollHeight > window.innerHeight + 80;
  if (SECTIONS.length >= 2 && longEnough) {
    buildDotNav();
    buildProgress();
  }

  function buildDotNav() {
    var nav = document.createElement("nav");
    nav.className = "dotnav";
    nav.setAttribute("aria-label", "章节快速跳转");

    SECTIONS.forEach(function (s) {
      var a = document.createElement("a");
      a.href = "#" + s.id;
      a.setAttribute("data-target", s.id);
      a.setAttribute("aria-label", s.label);
      a.innerHTML = '<span class="label">' + s.label + '</span><span class="dot"></span>';
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (s.id === "sec-top") {
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        var target = document.getElementById(s.id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.appendChild(a);
    });

    document.body.appendChild(nav);
    navLinks = Array.prototype.slice.call(nav.querySelectorAll("a"));
    measure();
    syncNav(scrollTop());
  }

  function buildProgress() {
    var bar = document.createElement("div");
    bar.className = "scroll-progress";
    bar.innerHTML = "<i></i>";
    document.body.appendChild(bar);
    var fill = bar.querySelector("i");

    function update() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? Math.min(1, Math.max(0, scrollTop() / max)) : 0;
      fill.style.width = (ratio * 100).toFixed(2) + "%";
    }

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }
})();
