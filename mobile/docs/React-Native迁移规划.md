# Review：HTML 到 React Native 迁移规划（iPad 自用版）

日期：2026-10-26  
状态：规划稿，基于当前仓库代码梳理；本次只调整文档，不初始化应用或改动线上服务。

## 1. 目标与原则

使用者只有一位学生（我儿子），设备只有一台 iPad。目标是把现有网页学习工具做成 iPad 上的原生 App，通过 Xcode 直接安装，不上架、不做账号。

原则：**能不做的都不做**。

- 只支持 iPad（iPadOS），横竖屏都可用；不做 iPhone、Android 适配与验证。
- 不做注册登录、账号管理、短信/邮件、多设备冲突合并；不新增或修改服务端。
- 进度只存在 iPad 本地；备份和网页进度导入复用现有同步码接口和导出文本。
- 进度数据格式与 Web 保持一致（同样的 deckKey、条目键和 JSON 结构），不引入新的 ID 体系和映射层。
- 不上架，不涉及 App 备案、隐私政策、商店审核。

不纳入：2026 期中计划（2026-11-06 结束，继续用网页）、语音评分、暑期学习平台、内容远程更新。

## 2. 迁移范围

`web/index.html` 链接 8 个业务页面，本次迁移其中 7 个：

| 模块 | 当前文件 | 迁移方式 |
| --- | --- | --- |
| 学习首页 | `web/index.html` | 原生教材列表 + 继续学习 |
| 闽教英语三下 | `web/textbooks/minjiao/english/grade3b-words.html` | 通用词卡 |
| 闽教英语四上 | `web/textbooks/minjiao/english/grade4a-words.html` | 通用词卡 |
| 仁爱英语七下 | `web/textbooks/renai/english/grade7b-words.html` | 通用词卡 |
| 仁爱英语八年级 | `web/textbooks/renai/english/grade8s-words.html` | 通用词卡 |
| 专项英语 | `web/other/en20260704.html` | 通用词卡 |
| 语文七下字词 | `web/textbooks/pep/chinese/grade7b-characters.html` | 通用词卡 + 汉字/拼音展示 |
| 八上必背古诗文 | `web/textbooks/pep/chinese/grade8a-required-recitations.html` | 独立学习与复习流程 |
| 2026 期中计划 | `web/other/midterm-plan-2026.html` | 不迁移，保留网页 |

## 3. 需要保持的现有行为

### 3.1 词卡

按单元/课筛选、正反方向、翻面、上一张/下一张、已掌握/需复习标记、查看全部、统计、上次位置恢复、范围重置、导入导出。英语有 TTS 发音及开关；语文显示汉字和带声调拼音。

- 状态只有 `got`、`review`，键不存在即未学；“查看答案”不等于已掌握。
- 各套字段不同：闽教三下、四上和专项英语为 `[英文, 释义]`；仁爱七下为 `[英文, 释义, 词性]`（短语无词性）；仁爱八年级为 `[英文, 释义, 词性, 音标]`。展示需允许字段缺省。
- 条目键与 Web 完全一致：
  - 英语：`单元序号|课名|英文`，单元序号是 `DATA` 数组下标（从 0 开始，不是单元名），如 `0|单词|lend`；`pref.unit` 也是下标。
  - 语文：`课名|字词`。
- 偏好 `pref` 结构沿用各页面默认值（如英语 `{unit, lesson, dir, peekAll, sound, lastKey, lastIdx}`）。

### 3.2 古诗文

导学、正文点词、分段遮挡记忆、首次检测、按轮复习、全文阅读、统计、导入导出。逻辑在 `web/assets/grade8a-recitations.js`，正文与词义在 `web/assets/data/pep-chinese-grade8a-required-recitations.json`；`GUIDES`、`POEM_TITLES`、`CUSTOM_CHUNK_MARKERS` 嵌在 JS 里，需一并提取。

- 掌握阶段：`未学习 / 刚学过 / 有印象 / 已掌握`。
- ID 按顺序生成：课组 `l1`、篇目 `l1-p1`、词语 `l1-p1-v1`、分段 `l1-p1-c1`，内容不变则 ID 不变。
- 状态结构：`{version, items, pieces, pref, roundCounter}`，与 Web 相同。
- 排序不使用随机数：轮次队列按 `(3 - stage) * 100 + wrong * 8 + hashString(id + roundId) % 13`，选项按 `hashString(选项 + seed)`；`hashString` 是基于 UTF-16 `charCodeAt`、`Math.imul`、`>>> 0` 的 FNV-1a。移植时逐位复刻，相同状态下题序与 Web 一致。
- 题目生成、升降级、同轮重复、提示惩罚、结束条件以代码为准，不按旧设计文档重写。
- 作答需输入中文词语，iPad 上要验证中文输入法候选上屏后再核对，不能在拼音组合阶段提前判题。
- 当前 `ui.quiz`、`ui.round` 只在内存中；首版保持一致，切后台不丢即可，杀进程后从总览重新开始轮次。

## 4. 技术方案

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 应用 | Expo + React Native + TypeScript | 用默认模板，少加依赖 |
| 路由 | Expo Router | 首页 → 教材 → 学习页 |
| 状态 | React hooks + reducer | 不引入状态管理库 |
| 存储 | `expo-sqlite`（一张进度表 + 一张备份表） | 见 §4.2 |
| 朗读 | `expo-speech` | 替换浏览器 `speechSynthesis` |
| 导入导出 | 剪贴板 + 系统分享面板 | 导出可存到“文件”App / iCloud 云盘 |
| 测试 | 纯逻辑单测 + iPad 实机手动走查 | 不做组件测试与 CI |

初始化时选当前稳定的 Expo SDK，用 `npx expo install` 安装原生依赖，提交锁文件。

### 4.1 目录

```text
mobile/
├─ docs/React-Native迁移规划.md
├─ app/                 # 页面
├─ src/
│  ├─ content/          # 提取后的教材 JSON + manifest
│  ├─ domain/           # 词卡筛选、古诗文判题与轮次、hashString
│  ├─ storage/          # SQLite 读写与备份
│  ├─ sync/             # 同步码上传/恢复、导出文本解析
│  ├─ components/
│  └─ screens/          # flashcards/、recitations/、home/
├─ scripts/             # 从 HTML 提取内容并校验
└─ tests/               # 逻辑单测与旧进度样例
```

### 4.2 本地数据

| 表 | 字段 | 用途 |
| --- | --- | --- |
| `progress` | `deck_key` 主键、`payload_json`、`updated_at` | 每套教材一份，格式同 Web 同步包 |
| `backups` | 自增 ID、`deck_key`、`reason`、`payload_json`、`created_at` | 导入、恢复、重置前自动备份，每套保留最近 10 份 |

- 每次有效操作立即写库；写失败时提示，不显示已保存。
- 词卡 `payload_json` 为 `{status, pref}`；古诗文为 `{items, pieces, pref, roundCounter}`。
- 内容随 App 打包；只要不改教材内容，旧进度天然可用。以后若修改教材，先评估是否会让键错位（英语增删单元会让后面的单元序号整体变化），再决定是否写一次性迁移。

## 5. 内容提取

1. 脚本从 6 个词卡 HTML 中取出 `const DATA`。它是 JS 对象字面量（属性名不带引号），用 acorn 等 JS 解析器取字面量节点后转 JSON，不对整页 `eval`。
2. 复制古诗文 JSON，提取 `GUIDES`、`POEM_TITLES`、`CUSTOM_CHUNK_MARKERS`。
3. 生成 manifest：`deckKey / kind / title / subject / resource`。deckKey 沿用 Web，例如 `textbooks/renai/english/grade7b-words`、`other/en20260704`。
4. 校验每套的单元、课、条目数量和逐项文本与网页一致；古诗文核对分段结果和重点词位置（沿用 JS 的 UTF-16 索引）。

## 6. 进度导入与备份

iPad 上的 App 读不到 Safari 的 localStorage，网页进度通过以下两种方式搬过来，都是可选的：

**同步码（推荐）：** 现有网页已支持同步码。在网页上逐套教材上传后，在 App 设置里输入同一同步码，按 manifest 逐个调用 `GET /api/sync/progress` 拉取；逐套显示成功、无记录或失败。

**导出文本：** 网页导出后粘贴到 App 对应教材。兼容：

- 词卡 `{app, version, status}`，以及不带包装的“键→状态”映射；仁爱七下和八年级都用 `app: enwk`，导入时以用户所选教材为准，并检查条目键交集。
- 古诗文 `{app, version, state}`。
- 同步快照：词卡为 `{status, pref}`；古诗文复用同名字段但含义不同，`status` 是 `items`，`pref` 是 `{pieces, ui, roundCounter}`，需按此还原。

导入流程：解析 → 显示有效/无效条数 → 自动备份当前进度 → 确认替换 → 写库。失败不改动原数据。

**云端备份：** 复用同一同步码和现有 `PUT /api/sync/progress`，在设置里提供“上传备份”和“从云端恢复”两个手动按钮，恢复前自动做本地备份。上传内容按 Web 同步包格式组装（`{app, deckKey, status, pref, updatedAt}`，古诗文按上面的字段映射），这样网页也能直接拉取；上传会整份覆盖云端该教材的数据，按钮旁需提示。不做自动同步，避免网页与 App 互相整份覆盖。现有接口不需要任何修改。

此外，设置页提供“导出全部进度”文件，经分享面板存到“文件”App，作为不依赖服务器的备份。

## 7. iPad 安装

用 Mac 上的 Xcode 通过数据线直接安装 Release 版本，不需要 Metro 开发服务器：

```bash
npx expo run:ios --device --configuration Release
```

签名方式二选一：

| 方式 | 费用 | 限制 |
| --- | --- | --- |
| 免费 Apple ID（个人团队） | 免费 | 签名 7 天后过期，需连 Mac 重新安装；数据保留 |
| Apple Developer Program | 年费 | 签名有效期一年，可用 TestFlight 或 Ad Hoc |

建议先用免费 Apple ID 验证，若每周重装嫌麻烦再考虑付费账号。iPad 需在“设置 → 隐私与安全性”中打开开发者模式，首次安装后在“通用 → VPN 与设备管理”中信任开发者证书。

前置条件：Mac 需把开发者目录切到完整 Xcode：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

**重装注意：** 删除 App 会清掉本地进度。签名过期只需覆盖安装，不要先删除；删除前先做云端备份或导出文件。

## 8. 界面要点

- 以 iPad 为准：横屏左侧目录、右侧内容；竖屏单栏。按可用宽度切换，不判断设备型号。
- 触控区域不小于 44×44；按钮可完成所有操作，滑动只是补充。
- 长单词、长短语和大字号允许换行。
- 语文保留暖纸色和重点词强调；英语突出单词、词性、释义层级。
- 外接键盘可选支持：空格翻面、左右键切卡。

## 9. 阶段与估算

一人业余开发的粗估，合计约 13–20 个工作日。

| 阶段 | 内容 | 完成标准 | 估计 |
| --- | --- | --- | --- |
| P0 环境 | Expo 初始化、免费签名、空白 App 装到 iPad、验证 SQLite 与 TTS | iPad 上能打开 App 并朗读一个单词 | 1 天 |
| P1 内容与词卡 | 提取脚本与校验、通用词卡、本地进度、首页 | 一套英语在 iPad 上可离线学习，杀进程后恢复 | 4–6 天 |
| P2 全部词卡与导入 | 其余五套词卡、导出文本导入、同步码导入、云端备份、导出文件 | 6 套词卡的网页进度都能导入，数量一致 | 2–4 天 |
| P3 古诗文 | 导学、注释、分段、检测、轮次、全文 | 同一状态下题序与 Web 一致；网页进度导入后可继续复习 | 5–7 天 |
| P4 收尾 | iPad 横竖屏走查、Release 安装、备份恢复演练 | 按 §10 走查通过 | 1–2 天 |

P1 完成后即可让孩子先用词卡，古诗文继续用网页，P3 完成后再切换。

## 10. 验收

- 6 套词卡和古诗文的内容数量、文本与网页一致。
- 网页导出或同步码导入后，App 中已掌握/需复习数量与网页一致；古诗文各篇阶段一致。
- `hashString` 对中文与标点输入的结果与 Web 一致；相同 `roundCounter` 下轮次题序一致。
- 翻面、方向、筛选、标记、统计、空范围、最后一张、位置恢复正确；朗读开关、快速切卡停止上一段朗读、静音开关下的表现可接受。
- 古诗文中文输入法作答、提示、答错重现、跨轮掌握、轮次结束正常；全文阅读不提升掌握度。
- 杀进程、重启 iPad、覆盖安装后进度仍在；导入失败不改动原数据；从备份可恢复。
- 云端备份上传后，在另一台设备的网页用同一同步码可读到。

## 11. 开工顺序

1. 切换 Xcode 开发者目录，用免费 Apple ID 把空白 App 装上 iPad（先确认安装链路，最容易卡住）。
2. 写内容提取脚本和校验，生成旧进度样例。
3. 做一套英语词卡，交给孩子试用。
4. 补齐其余词卡和导入备份，再做古诗文。
