/**
 * ============================================================
 * 公开区域数据（占位信息，请整体替换）
 * ------------------------------------------------------------
 * 公开页只展示：姓名 / 职业信息 / 固话 / 电话 / 邮箱 / 地址。
 * 隐私数据一律走 private/ 通道，不要写在这里。
 * ============================================================
 */

const PROFILE = {
  name: "冉得微",
  initials: "DR",
  // title: "电子名片",

  /* 头部一句话标签（头像下方） */
  position: "Software Engineer",

  /*
   * 首屏照片：竖构图即可。方形取景时画面正好是头像，
   * 滚动形变时相框被拉长，取景随之向下展开（头像 → 半身/全身）。
   * 换照片时把 CSS 里的 --ph1 调成 新高度 / 新宽度 × --pw1 即可对齐。
   */
  photo: "assets/img/portrait.jpg",

  /* 方形头像（备用，例如分享卡片图） */
  avatar: "assets/img/avatar.jpg",

  /* 手写签名（透明底 PNG，深色主题自动反白） */
  signature: "assets/img/signature.png",

  /* 职业信息章节（公开页 01） */
  career: {
    role: "软件工程师",
    company: "保税科技",
    department: "信息部",
    location: "苏州 · 张家港",
    focus: "全栈开发"
  },

  /* 联系方式：href 留空则渲染为纯文本 */
  contacts: [
    { label: "固话", value: "0512-5832 3136", href: "tel:051258323136" },
    { label: "电话", value: "178 2618 1618", href: "tel:17826181618" },
    { label: "邮箱", value: "junxd@foxmail.com", href: "mailto:junxd@foxmail.com" },
    { label: "地址", value: "苏州市张家港市金港街道", href: "" }
  ],

  footer: {
    left: "© 2026 冉得微",
    right: "本站内容仅供本人授权的场合使用"
  }
};
