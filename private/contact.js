/**
 * ============================================================
 * 「交流」页的联系方式（v16）
 * ------------------------------------------------------------
 * 这一页只有从「交友 → 交流」进来才看得到，公开名片页不给入口。
 *
 * 填法：
 *   · qq / wechat 的 value 留空 → 那一行整行不显示（不会出现空白行）
 *   · href 留空 → 点击走「复制」，有 href 就按链接跳转
 *   · closed: true → 灰着显示、点了不跳转，只是淡出这条
 *
 * 想加新的（比如邮箱、小红书），往下追加一条即可，顺序就是显示顺序。
 * ============================================================
 */

window.PRIVATE_CONTACT = {
  items: [
    { id: "qq", label: "QQ", value: "1055868936", href: "" },
    { id: "wechat", label: "微信", value: "Samsara_Valley", href: "" },
    {
      id: "mail",
      label: "邮箱",
      value: "junxd@foxmail.com",
      href: "mailto:junxd@foxmail.com"
    },
    { id: "telegram", label: "纸飞机", value: "@Dewey",  href: "", closed: true },
    { id: "x", label: "X", value: "@Dewey", href: "", closed: true }
  ]
};
