/**
 * 全局配置
 * 与 docs/requirements-v2.md 中的计时器定义一一对应。
 *
 * 必须挂在 window 上：各模块都是读 window.CARD_CONFIG，
 * 用顶层 const 声明别处读不到（之前这里就踩过一次坑）。
 */
window.CARD_CONFIG = {
  /* 版本号：打发布包时由 tools/package.js 读取；管理台页脚也会显示，
     用来确认线上到底跑的是哪一版（GitHub Pages 有 10 分钟缓存） */
  version: "1.0.1",

  /* 会话有效期 T2：解锁后可查看的分钟数 */
  sessionMinutes: 15,

  /* 链接有效期 T1 的默认值（小时），签发分享链接时未指定则用它 */
  rotationHours: 24,

  /* 一次性链接的默认有效期（小时）：一次性链接必须有硬性到期时间 */
  oneTimeHours: 1,

  /* PBKDF2 迭代次数，必须与 tools/lib.js 的 ITERATIONS 一致 */
  iterations: 200000,

  /* 管理员密码错误重试策略 */
  adminMaxAttempts: 5,
  adminLockSeconds: 30,

  /* 管理员校验密文路径（相对 private/ 目录） */
  adminVaultPath: "admin.vault.js",

  /* 背景水印的说明文字（下面一行会自动跟当前时间） */
  watermarkText: "电子名片 · 仅限查看"
};
