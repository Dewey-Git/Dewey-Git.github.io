/**
 * ============================================================
 * 私密通道清单（公开元数据，不含任何敏感内容）
 * ------------------------------------------------------------
 * 注意：必须挂到 window 上。顶层 const 不会成为 window 的属性，
 * 其它脚本用 window.PRIVATE_CHANNELS_META 读取时会拿到 undefined。
 *
 * tab 字段决定私密页顶部标签栏显示的文字与顺序。
 * id 是密文文件名的一部分（private/channels/<id>.enc.js），改名要连带
 * 重命名密文与 keys.json 里的键——所以 v16 只改展示用的 name / tab / desc，
 * id 保持 interview / dating / soul 不变。
 *
 * 新增通道：
 *   1. 本数组追加 { id, name, tab, desc, icon }
 *   2. node tools/rotate.js <id> "密钥"
 * ============================================================
 */

window.PRIVATE_CHANNELS_META = [
  {
    /* 对外叫「工作」：同事看到不尴尬，求职方一看就懂 */
    id: "interview",
    name: "工作与履历",
    tab: "工作",
    desc: "求职、合作相关的履历与背景，需要密钥；不带密钥也能先看看技术那一栏。",
    icon: "briefcase"
  },
  {
    /* 对外叫「交友」：选项里那个更像相亲的名字，只给本人和对方看 */
    id: "dating",
    name: "交友与关系",
    tab: "交友",
    desc: "关于生活、家庭与长期关系的私人情况，需要密钥；也可以先留个联系方式聊聊。",
    icon: "heart"
  },
  {
    id: "soul",
    name: "契合",
    tab: "契合",
    desc: "完全契合的话，不需要密钥也能进来；否则还是走密钥。",
    icon: "spark",
    quiz: true
  }
];
