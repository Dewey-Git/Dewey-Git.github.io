# 电子名片 · Electronic Business Card

> **v1.0.1** · 2026-10-29 · 首个对外测试版（部署步骤见 [`docs/deploy-v1.0.1.md`](docs/deploy-v1.0.1.md)）

纯静态个人电子名片：公开页只展示最简联系方式，私密内容（工作 / 交友 / 契合）加密存放，支持**一次性链接**与**限时链接**，分享即可打开。可直接部署 GitHub Pages。

- 无后端、无构建、零第三方依赖
- 5 套可区分主题（墨黑 / 纸白 / 靛蓝 / 酒红 / 松绿）
- **数据密钥 + 分享票据**：签发的链接立即生效，换密钥不等于重新加密
- 三栏（工作 / 交友 / 契合）**未解锁时连条目名都不显示**：整块只剩一个打码的内容框
- 点那个框，**两条路在框里铺开**（v16，不弹对话框）：
  - 工作 → 「工作」要密钥 / 「技术」直接看技术栈与能力范围
  - 交友 → 「认真交往」要密钥 / 「交流」留 QQ、微信、邮箱
  - 契合 → 「输入密钥」/「契合测试」，完全契合免密钥
- 题库（70 道：60 随机 + 10 终局固定）与每题分值**整包加密**，页面里没有一道明文题目
- 契合测试三段推进：5 题 → 15 题 → 40 题，检查点按分数分流，最高给免密钥入口与兑换券
- 离线状态下私密页统一显示「离线无法使用」
- 分享链接只有约 126 字符（令牌 72 字符），单参数、抗截断
- 首屏滚动形变：照片与姓名不随页面上移，而是滑到左侧、姓名移到右侧并冻结在顶部；正文与舞台下沿同步上移，全程不被遮挡
- 全站禁止复制，失焦自动模糊，铺「说明 + 当前时间」的动态水印，禁用打印/另存

文档：[`docs/deploy-v1.0.1.md`](docs/deploy-v1.0.1.md)（**上线操作手册：从建仓库到自检**）、[`docs/tech-design.md`](docs/tech-design.md)（**技术实现总说明**）、[`docs/deploy-github-pages.md`](docs/deploy-github-pages.md)（**部署与公网风险**）、[`CHANGELOG.md`](CHANGELOG.md)（版本记录）、[`docs/changes-v16.md`](docs/changes-v16.md)（三栏改名 / 每栏两条路 / 技术页与交流页）、[`docs/changes-v15.md`](docs/changes-v15.md)（加密内容框 / 就地输入密钥 / 结构不再公开）、[`docs/changes-v14.md`](docs/changes-v14.md)（条目式解锁 / 加密题库 / 分段契合测试）、[`docs/changes-v13.md`](docs/changes-v13.md)、[`docs/changes-v12.md`](docs/changes-v12.md)、[`docs/changes-v11.md`](docs/changes-v11.md)、[`docs/changes-v10.md`](docs/changes-v10.md)、[`docs/changes-v9.md`](docs/changes-v9.md)、[`docs/requirements-v2.md`](docs/requirements-v2.md)。

---

## 一、快速开始

```bash
cd business-card
python -m http.server 8080
```

| 页面 | 地址 |
|---|---|
| 公开名片 | <http://localhost:8080/> |
| 私密通道（工作 / 交友 / 契合 三标签 + 一个加密内容框，点框铺开两条路） | <http://localhost:8080/private/> |
| 内容页 | `/private/view.html?s=<令牌>`（单参数，整条复制即可） |
| 契合测试 | `/private/quiz.html?c=soul` |
| 技术页（不用密钥） | `/private/tech.html` |
| 交流页（不用密钥） | `/private/contact.html` |
| 管理控制台 | `/private/admin.html`（无界面入口） |

> 不要用 `file://` 打开私密页，浏览器会禁用 `crypto.subtle`。

v15 起私密首页既不列条目、也不弹框：每栏只渲染一个**加密内容框**（锁图标 + 三条骨架条），
页面上没有任何条目名、条数或分组标题。点这个框，v16 起先铺开两条路（都在框内，不弹窗）：

| 栏 | 第一条 | 第二条 |
|---|---|---|
| 工作 | **工作** · 要密钥，解开就是原面试内容 | **技术** · `tech.html`，不用密钥 |
| 交友 | **认真交往** · 要密钥，解开就是原相亲内容 | **交流** · `contact.html`，不用密钥 |
| 契合 | **输入密钥** | **契合测试** · 完全契合免密钥 |

两个「不用密钥」的出口是独立的静态页：不碰密文，也不在公开名片页给入口。

### 三种打开方式

| 场景 | 做法 |
|---|---|
| **发给别人（推荐）** | 打开 `/private/admin.html` → 输管理员密码 → 选通道与有效期 → 复制**一条**链接直接发，对方打开即看 |
| 只发链接、密钥另发 | 管理台展开「需要分开传送？」→ 一边发不含密钥的链接，一边发密钥；对方打开后输一次密钥 |
| 本人自用 | 打开 `/private/` → 点加密内容框 → 选「工作 / 认真交往 / 输入密钥」→ 在框里粘 64 位主密钥；或直连 `view.html?c=<通道>&k=<主密钥>` |

> `view.html` 本身不提供「输入密钥」的独立界面：不带参数打开时它会告诉你「请从通道列表进入」，
> 因为入口在列表那侧——点那个加密内容框，输入框就在框里展开。

> **链接为什么又短又只有一个参数**：v8 之前是 `?c=..&k=..&p=..`，只要被聊天软件按 `&` 截断，
> 票据就丢，页面会退化成「输密钥」，而这时只有旧主密钥能开——表现为「新密钥打不开、旧密钥还能用」。
> v9 把令牌压成一段二进制再 base64url：**72 个字符装下通道 + 有效期 + 一次性标记 + 封装的 DEK + 分享密钥**，
> 整条链接约 126 字符。被截断会明确提示「链接不完整」，不会误导你去输密钥。

**三把钥匙的分工**（详见 `docs/tech-design.md` 第 2 节）：

| 名称 | 是什么 | 给谁 |
|---|---|---|
| 主密钥（DEK） | 每通道一把 64 位十六进制，长期不变，是内容的真正钥匙 | **只给自己**，泄露等于永久授权 |
| 分享密钥 | 每次签发的 128 位随机数，只负责把 DEK 包起来 | 收件人（已内嵌在链接里） |
| 管理员密码 | 打开管理台、解出 DEK 用 | 只有自己 |

数据密钥在 `data/keys.json`（本地文件，`.gitignore` 已忽略，**不会**进仓库）。
管理员密码是执行 `tools/set-admin.js` 时你设定的值。

---

## 二、目录结构

```
business-card/
├── index.html                    公开名片（居中头像 + 职业信息 + 联系方式）
├── private/
│   ├── index.html                通道标签页 + **加密内容框** + 返回按钮 + 离线提示
│   ├── view.html                 ★ 内容页（分享链接入口）
│   ├── quiz.html                 ★ 契合测试（5 → 15 → 40 题）
│   ├── tech.html                 技术页（不用密钥：本站技术栈 + 能力范围）
│   ├── contact.html              交流页（不用密钥：QQ / 微信 / 邮箱 + 两个灰着的）
│   ├── contact.js                ★ 交流页配置（填 qq / wechat 的账号就在这里）
│   ├── admin.html                ★ 管理控制台（无入口，仅 URL）
│   ├── channels.js               通道清单（id / name / tab / desc / icon / quiz 标记）
│   ├── rotation.js               keyId 记录（内容是哪个数据密钥加密的）
│   ├── admin.vault.js            管理员校验密文 + 各通道数据密钥密文
│   ├── quiz.enc.js               题库密文（题目 / 分值 / 券码 / 免密钥令牌，build-quiz 时生成）
│   └── channels/*.enc.js         各通道密文
├── assets/
│   ├── css/style.css
│   ├── img/
│   │   ├── portrait.jpg          首屏照片（560×931 竖构图，69 KB）
│   │   ├── avatar.jpg            方形头像备用图（520×520，33 KB）
│   │   ├── signature.png         手写签名（透明底，深色主题自动反白）
│   │   └── originals/            素材原图（4 MB，已 gitignore，不上线）
│   └── js/
│       ├── config.js             会话时长、默认链接时长、迭代次数、重试策略
│       ├── crypto.js             ★ 共享加密 / 令牌 / 渲染 / 离线守卫
│       ├── unlock.js             ★ 解锁数据层（校验 / 会话倒计时 / 错误锁定；模态框仅供 view.html）
│       ├── guard.js              ★ 禁复制 / 失焦遮蔽 / 水印 / 禁打印
│       ├── ui.js                 顶栏按钮区 + 设置浮层（仅主题）+ Toast
│       ├── data.js               ★ 公开信息
│       ├── public.js             公开页渲染
│       ├── private.js            入口页：标签切换 + 加密内容框 + 两条路（MENUS 表）
│       ├── view.js               内容页（票据 / 数据密钥两条解锁路径）
│       ├── quiz-bank.js          解密题库（构建口令写在这里，与 build-quiz.js 自动对齐）
│       ├── soul-quiz.js          ★ 契合测试引擎（抽题 / 计分 / 检查点 / 结果档位）
│       └── admin.js              管理控制台（现场签发链接）
├── tools/
│   ├── lib.js                    公共加密实现（v15 起不再产出条目大纲）
│   ├── encryptor.html            ★ 图形化加密台（选通道 → 贴 JSON → 加密 → 下载 .enc.js）
│   ├── package.js                ★ 打发布包（剔隐私 / 查泄漏 / 校验引用大小写）
│   ├── rotate.js                 ★ 用数据密钥加密内容 / 可选打印分享链接
│   ├── build-quiz.js             ★ 校验并加密题库（data/quiz.json → private/quiz.enc.js）
│   ├── encrypt.js                旧命令转发器
│   ├── set-admin.js              设置管理员密码（同时封装数据密钥）
│   └── verify.js                 本地自检（支持整条链接）
├── data/                         明文隐私数据 + keys.json + quiz.json（.gitignore 忽略）
└── docs/
```

---

## 三、改内容

### 3.1 公开信息

`assets/js/data.js`：

- `name` / `title` / `photo`：头部（`photo` 用竖构图，方形取景时是头像，滚动后相框拉长露出更多身体；换图后把 `style.css` 的 `--ph1` 调成「新高度 ÷ 新宽度 × `--pw1`」即可，并**尽量取偶数**——冻结态靠垂直居中定位，奇数高度会落在半像素上，照片会略微发虚）
- `avatar`：备用方形头像，`photo` 缺失时才会用到
- `signature`：姓名下方的手写签名（透明底 PNG；留空则不显示。深色主题靠 CSS `--sig-filter: invert(1)` 自动反白。这张签名右侧有很长的收尾笔画，CSS 里用 `translateX(13%)` 把字母主体拉回姓名中线）
- `position` / `company`：姓名下方的一行标签
- `career`：职业信息章节（`role` 职位、`company` 公司、`department` 部门、`location` 地点、`focus` 技术方向、`since` 在职时间），渲染为与联系方式同款的列表，无段落介绍
- `contacts[]`：固话、电话、邮箱、地址

### 3.2 私密内容

改完 `data/<通道>.json` 后重新加密（**数据密钥不变，已发出的链接仍有效**）。两条路选一条：

**A. 图形界面 —— `tools/encryptor.html`**

双击打开（或在 `http://localhost:8080/tools/encryptor.html`）：

1. 选通道 → 「从 data/ 载入」或「打开 json 文件」
2. 「从 keys.json 载入」主密钥（http 打开能直接读；双击打开就手动粘 `data/keys.json` 里那一把）
3. 点「加密并生成文件」——页面会先用同一把钥匙解回来逐字节比对，再给你结果
4. 下载 `xxx.enc.js` 覆盖 `private/channels/xxx.enc.js`；复制下面那段替换 `private/rotation.js` 里的同名块

参数与 `rotate.js` 逐字节一致（PBKDF2 200000 → AES-256-GCM，`ct` 尾部 16 字节 tag，字段顺序也一样），
所以产物可以放心替换。密钥只在该页内存里，不写 localStorage、不发请求。

**B. 命令行**

```bash
node tools/rotate.js dating          # 重新加密（自动写 enc.js + rotation.js）
node tools/verify.js dating          # 自检（读 data/keys.json）
```

#### 哪些文件要加密、产物叫什么

| 改了什么（明文） | 加密后生成 | 界面上的去处 |
|---|---|---|
| `data/interview.json` | `private/channels/interview.enc.js` | 工作 |
| `data/dating.json` | `private/channels/dating.enc.js` | 交友 |
| `data/soul.json` | `private/channels/soul.enc.js` | 契合 |
| `data/quiz.json` | `private/quiz.enc.js`（`node tools/build-quiz.js`） | 契合测试 |
| （管理员密码） | `private/admin.vault.js`（`node tools/set-admin.js`） | 管理台 |

**不用加密**、直接改就行：`assets/js/data.js`（公开名片）、`private/contact.js`（交流页联系方式）、
`private/tech.html`（技术页）、`assets/img/*`。分享链接也不落盘 —— 在管理台签发，存在链接本身里。

每改一次通道内容，`private/rotation.js` 里那一条的 `keyId` / `issuedAt` 会跟着变，
两者要**一起替换、一起推**；只推 `enc.js` 不推 `rotation.js`，管理台会显示旧 keyId（不影响解密，但自检信息会错）。

需要一条链接时，任选其一：

```bash
# A. 浏览器里签发（推荐，立即可用）
#    打开 http://localhost:8080/private/admin.html

# B. 命令行签发
node tools/rotate.js dating --ticket --ttl=24
node tools/rotate.js dating --ticket --ttl=0.25 --one-time --label="给张阿姨"
node tools/verify.js dating --link="<粘贴整条链接>"
```

- `--ttl` 单位是小时：`0.25`=15 分钟、`1`=1 小时、`24`=1 天、`168`=7 天
- `--one-time` 标记一次性（首次成功查看后失效；不传 `--ttl` 时默认 1 小时，一次性必须有硬性到期时间）
- `--label` 显示在内容页顶部

### 3.3 管理员密码

```bash
node tools/set-admin.js "你的管理员密码"
```

只写入密文，同时把 `data/keys.json` 里的数据密钥一起封装进 `admin.vault.js`——
这是管理台能**现场签发链接**的前提。**新增通道或更换数据密钥后要重新执行一次。**

> v15 起 `rotate.js` 不再产出 `private/outline.js`：入口页在解锁前不显示任何条目信息，
> 也就没有「字段名」需要以明文形式发布。旧仓库里若还留着这个文件，删掉即可（页面已不引用）。

### 3.4 契合测试题库

题库明文是 `data/quiz.json`（`rules` 分段阈值 + `coupons` 券码 + `pool` 60 题 + `final` 10 题），
改完执行：

```bash
node tools/build-quiz.js             # 校验 + 加密 → private/quiz.enc.js
node tools/build-quiz.js --dry       # 只校验不写文件
node tools/build-quiz.js --new-token # 同时换一张免密钥令牌（会让旧的免密钥入口失效）
```

脚本会先拦几件错事再加密：池里不足 60 题 / 终局不足 10 题、40 题满分不等于 400、
每题不是 4 个选项或满分不是 10、券码缺失、题干重复。同题两个选项同分只提示不拦截（很常见）。

- **构建口令**以字符码数组写在 `assets/js/quiz-bank.js` 的 `SEAL` 行，构建脚本每次解析这一行，
  两边永远对得上；想换口令就改那一行再跑一次 build（会同时校验 `iter` 是否一致）
- **免密钥令牌**存在 `data/quiz-token.txt`，重建时复用；密文里取不出明文，所以别删这个文件
- 题库明文、`data/` 整个目录都在 `.gitignore` 里，不进仓库

分段规则（满分 400）与结果档位：

| 阶段 | 题数 | 检查点行为 |
|---|---|---|
| 第一段 | 5 题（满分 50） | ≤30 直接给「性格互补」；>30 好感 +1、可选继续（停 = 中等契合）；=50 好感 +2、必须继续 |
| 第二段 | 10 题（累计 15 题，满分 150） | ≤90 直接给「中等匹配」；>90 好感 +1、可选继续（停 = 高等契合）；=150 好感 +2、必须继续 |
| 第三段 | 25 题（累计 40 题，满分 400） | <300 高契合 + 奶茶券；300–369 请吃饭；370–399 解锁隐藏内容 + 免密钥入口；=400 一个愿望（同样给免密钥入口） |

抽题：60 道随机池按 5 / 10 / 25 顺序切给三段（不重复），终点再追加 10 道固定题（内部顺序也打乱），
凑满 40 题。券码与阈值全部在密文里，改券码要重跑 build。

---

## 四、加密与访问控制

### 4.1 三层结构

```
data/keys.json ──DEK（每通道一把，长期不变）──▶ 加密 channels/<id>.enc.js
                        │                       AES-256-GCM / PBKDF2 200k
        管理台用管理员密码解出 DEK
                        ▼
        分享密钥 K（128 位随机）──HMAC-SHA256 密钥流──▶ 封装 DEK（异或）
                        ▼
        令牌 = 通道 + 过期时间 + 一次性标记 + 封装的 DEK + K     （72 字符）
                        ▼
        链接：view.html?s=<令牌>（单个参数，约 126 字符）
```

- 对方打开链接 → 用 K 解出 DEK → 用 DEK 解密内容，全程在浏览器本地完成
- 换分享密钥 / 改有效期只是重新封一次 DEK，**不动密文、不用重新部署**
- DEK 是主钥匙，泄露等于内容泄露；它只存在于 `data/keys.json` 和 `admin.vault.js` 的密文里
- **三种「换钥匙」语义不同**：重签链接（旧链接仍有效）／内容更新（DEK 不变，链接全有效）／换主密钥（旧链接全废），见 `docs/tech-design.md` 第 5 节

### 4.2 两个计时器

| | 含义 | 时长 | 位置 |
|---|---|---|---|
| **T1 链接有效期** | 令牌自带的寿命（参与密钥流派生，改不动） | 签发时选（15 分钟 / 1 小时 / 6 小时 / 24 小时 / 7 天）；一次性默认 1 小时 | 内容页顶部「限时链接 · 剩余 mm:ss」；免密钥令牌显示「测试解锁 · 长期有效」 |
| **T2 会话有效期** | 单次解锁能看多久 | 15 分钟 | 内容页右上「本次查看 mm:ss」 |

任一到期都会立即清空 DOM 与内存中的明文。关掉页面即需重新输入。

### 4.3 其他规则

- **一次性链接**：两道闸——① 令牌里的硬性到期时间（默认 1 小时，到期即使从未打开也作废）；
  ② 首次**成功**查看后才写标记（失败不消耗），标记按 `SHA-256(令牌)` 前 12 位算，存在本机 `localStorage`。
  第 ② 道闸换设备 / 清缓存可绕过，这是纯静态站点的固有限制；要真·全局一次需服务端记账
- **禁止复制 / 截图**：全站关掉选区与右键、拦复制快捷键、禁打印、失焦即模糊、
  按 PrintScreen 立即遮蔽并覆写剪贴板、铺「说明 + 当前时间」的动态水印（文案在 `config.js` 的 `watermarkText`）；系统级截屏无法从网页阻止
- **keyId 校验**：密文 keyId 与 `rotation.js` 不一致说明内容重新加密过，旧链接作废
- **解锁前没有任何结构信息**：v15 起 `private/` 下不再有 outline 之类的明文元数据，
  页面在解锁前连「有几个条目、字段叫什么」都不知道，只有密文和一段打码占位
- **题库单独加密**：`data/quiz.json` → PBKDF2（12 万次）→ `private/quiz.enc.js`，
  迭代次数写在密文头里，和内容层（20 万次）用的是两套口令，互不影响
- **离线**：`navigator.onLine === false` 时所有私密页显示「离线无法使用」，公开页不受影响

---

## 五、部署

```bash
git init && git add . && git commit -m "init: business card"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main

git ls-files | grep -E "^data/"     # 应无输出
```

Settings → Pages → `Deploy from a branch` → `main` / `/ (root)` → Save。

- `<username>.github.io` → `https://<username>.github.io/`
- 其他仓库 → `https://<username>.github.io/<repo>/`

分享链接形如：`https://<你的域名>/private/view.html?s=<令牌>`

> 整条链接约 126 字符，只含**一个** URL 参数。即时通讯里可能会折行显示，属正常现象——
> 复制时请用「复制链接」按钮整条复制，不要手动截取。若对方收到后提示「链接不完整」，
> 说明中途被截断了，重新发一次即可。

命令行也能签发：`node tools/rotate.js dating --ticket --ttl=1`，会同时给出单参数链接和
「分开传送」用的链接 + 密钥。

> **部署到 GitHub Pages 和本地完全一样**（站点零接口调用，全站无 `fetch`）。
> 但有四件事只有公网才暴露：HTTP 缓存 10 分钟延迟、`admin.vault.js` 人人可下载（要用强密码）、
> 仓库公开即算法公开、没有自定义响应头。逐条说明与上线自检清单见
> [`docs/deploy-github-pages.md`](docs/deploy-github-pages.md)。

---

## 六、安全边界

加密：内容层 AES-256-GCM + PBKDF2-SHA256（20 万次），`ct = 密文 ‖ 16B tag`；
分享层 HMAC-SHA256 密钥流封装 DEK。完整威胁模型见 `docs/tech-design.md` 第 1 节。

1. 不要放银行卡密码、支付密码、完整证件号、验证码。
2. 分享密钥强度就是安全上限；站点代码公开，拿到票据与密钥后可离线爆破。
3. 链接把密钥与票据都放在 URL 里，页面已设置 `referrer: no-referrer`，但浏览器历史仍会记录。
4. `data/` 已被忽略（含 `keys.json`）；若误提交需用 `git filter-repo` 清理历史。
5. 一次性链接的"已使用"是客户端标记，清缓存或换设备可绕过；真正单次需要服务端。
6. 需要服务端鉴权 / 真正的单次消耗 / 单独吊销某条链接，请换 Cloudflare Pages Functions / Vercel / 自建后端。
7. 「禁止截图」只在浏览器能力范围内生效：系统截屏、手机截图、相机拍屏无法阻止，水印用来标明时间与「请勿外传」。

---

## 七、FAQ

**管理台点了生成，链接打得开吗？** → 打得开。签发时浏览器用管理员密码解出数据密钥并现场封装成令牌，不需要再跑命令。

**主密钥是什么？** → 每个通道内容的真正钥匙（64 位十六进制，长期不变），只给自己用。
别人只需要分享链接。忘记了可以在管理台「查看主密钥」里看到，直连格式 `view.html?c=通道&k=主密钥`。

**链接打开后仍要我输密钥？** → 只有一种情况：你用的是「分开传送」那条链接（本来就要输密钥）。
若链接被截断，页面会显示「链接不完整」，不会让你输密钥。
若显示「链接有效，但通道密文与密钥不一致」，是部署时只推了部分文件，见下方自查。

**管理台登录后通道显示「⚠ 密文与密钥不匹配」** → 说明站点上的 `private/channels/*.enc.js`
与 `private/admin.vault.js` 不是同一批。本地依次执行
`node tools/rotate.js <通道>` → `node tools/set-admin.js "管理员密码"`，
然后把 `private/channels/`、`private/admin.vault.js`、`private/rotation.js` 一起推送。

**提示「这条链接已经过期」** → 超过 T1，重新签发一条。

**提示「分享密钥和这条链接不是同一次签发的」** → 密钥抄错，或链接与密钥不是同一次签发（重签发一次就换一组）。

**提示「这是一次性链接，已经在本设备用过了」** → 一次性链接已用，索取新的。

**提示「这条链接没有内嵌密钥，需要再补上分享密钥」** → 对方只发了链接、密钥另发，把密钥填进去即可。

**提示「链接不完整」** → 令牌被聊天软件截断了，让本人重发，用「复制链接」整条复制，别手动截取。

**为什么不能复制页面文字？** → 有意为之：全站禁止复制与截图外传。要联系方式请直接联系本人。

**契合要不要先答题？** → 不必。「契合」栏点开后先给「输入密钥 / 契合测试」，两条路都通；
答到 370 分以上，结果页会直接给一个长期有效的免密钥入口。

**考试题在页面里能看到吗？** → 不能。题目、选项分值、券码、阈值都在 `private/quiz.enc.js` 密文里，
构建口令只存在于 `assets/js/quiz-bank.js`。这挡的是「随手翻源码」，挡不住铁了心逆向前端的人——
纯静态站点的固有限制，想真防就得把判分放到服务端。

**答到一半关掉会怎样？** → 进度存在 `sessionStorage`，同一标签页刷新不丢，关标签页即清空；
重新进来是新一轮抽题。

**点加密框后要我输密钥，但我只有一条链接？** → 直接把整条链接粘进框里的输入框即可，会自己识别；
链接自带有效期，过期就得重新签发。

**改了 `data/*.json` 页面没变** → 密文不会自动更新，重跑 `node tools/rotate.js <通道>`（数据密钥不变，链接仍有效）。

---

## License

个人使用，随意修改。示例文案与项目经历均为虚构占位内容。
