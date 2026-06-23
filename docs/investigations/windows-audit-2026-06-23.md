# Windows 版全面审计与修复方案（2026-06-23）

> **怎么来的**：用 ultrawork 多 agent 工作流（46 个 agent / ~270 万 token / 882 次工具调用）把 Windows 版拆成 10 个维度彻底排查，每条发现都经过独立"对抗式验证"（重点查"是不是其实已经修过了"）。结果：**35 条原始发现 → 28 条验证为真且未修复 → 0 条误报**。去重后 18 条优先级清单，见下。
>
> **⚠️ 硬约束**：本文 18 条**全部是代码 + git 历史审计，0 真机验证**。每条高危都标了【需真机】。改任何 Windows 窗口/输入/DPI/启动行为后，**必须真机验证，CI 和 code-review 不可放行**（仓库铁律 verify-on-real-hardware）。
>
> **完整证据**：每条的逐字验证结论（含 file:line、git merge-base 核验）在同目录 `windows-audit-2026-06-23.raw.json`。

---

## 0. 如何用这份文档（给在 Windows 真机上动手的人）

1. **先看第 1 节"根因总览"**——18 条不是 18 个孤立 bug，几乎同源。理解根因后修起来事半功倍。
2. **优先做第 2 节"收割已写好的 PR"**——3 个高危的解药代码**已经写好，只差合并 + 真机验证**。这是性价比最高的起点。
3. **再按 P0 → P1 → P2 推进**。每条给了：现象 / 根因(file:line) / 修复方案 / **复现与验证步骤** / 关联 issue。
4. 每改完一条，按该条的"复现与验证"在真机上跑通，再提 PR。

---

## 1. 根因总览：为什么 Windows 最脆弱

桌宠在 Windows 上用的是**双窗口架构**：

- **renderWin（显示层）**：透明、永久飘最顶、`setFocusable(false)`、永久 `setIgnoreMouseEvents(true)`——只负责画宠物，鼠标穿透。
- **hitWin（命中层）**：透明、Windows 上 `focusable:true`、用 `setShape` 精确盖在宠物像素上、`setIgnoreMouseEvents(false)`——接住所有鼠标/拖动。
- 两窗口位置由 `syncHitWin()` 同步；Windows 置顶层级 = `"pop-up-menu"`。

这套"透明 + 永远置顶 + 双层"做法在 mac/Linux 没问题，但正面撞上 Windows 三处最敏感的语义，**几乎所有 Windows 毛病都从这里长出来**：

1. **抢最顶层 / 抢焦点**：为了能拖动（修 #545），hitWin 必须可激活 + 每 5s 巡逻保持置顶——但这套逻辑**完全没有"前台是不是全屏游戏"的感知**（#538）。
2. **DWM 把窗口"隐身"（cloaking）**：Windows 合成器会在锁屏/RDP 等场景把透明置顶窗口标记为 cloaked，窗口逻辑上还"可见"但屏幕上没了，而我们**没有任何探测和恢复**（#525）。
3. **per-monitor-DPI 缩放算尺寸**：高分屏缩放变化时回读"变化中途的临时尺寸"并存成永久值，导致**越用越大**（#408）。

### 反复出现的根因主题（themes）

- 透明置顶双窗口 ↔ Windows 合成器/激活语义的**固有冲突**（既是 #545 拖动修复的代价 = #538，也是 #525 隐身的温床）。
- **缺"前台全屏/游戏感知"整整一条腿**——全套抢顶层/抢输入逻辑里，没有一处调用 `GetForegroundWindow` 或全屏探测。
- 对 Windows **"确定性反复崩"缺放弃/限速机制**——恢复逻辑都是为"跨平台偶发、reload 一次就好"设计的，遇上 Windows 必崩场景就死循环（#530）。
- **per-monitor-DPI live 回读非幂等**——把 live 窗口 bounds 当 truth source 而非冻结值（#408）。
- 原生 HWND/koffi 操作的健壮性——指针转换、可降级 FFI 探针基建尚未建立。
- 路径/shell 转义——把"写命令时的宿主平台"当成"执行命令的平台"（#544 / #331 / wt 重分词）。
- 状态机入口被旁路绕过——second-instance 裸 showInactive、hitWin 崩溃不清 dragLocked。

---

## 2. 收割：3 个已写好但未合并的解药 PR（最高性价比）

5 个高危里有 3 个的修复**已经写好，就躺在未合并的 OPEN PR 里**。先审 + 真机验证 + 合并，就能干掉一大半。

| PR | 分支 | 治什么 | 注意事项 |
|----|------|--------|----------|
| **#496** | `fix/pet-not-displaying` | #525 DWM 隐身恢复 | 探针思路对（已修过早期"Buffer 当指针"的 bug），但**只把恢复接进 `showPetWindows()`（需用户手动 toggle 才恢复）**，未接进周期看门狗。要真自愈，需把探针接进 5s 看门狗（见 H2）。 |
| **#501** | `fix/408-size-growth-keepsize` | #408 越变越大 | 用独立 `savedPixelWorkArea` 当 frozen-origin，legacy fallback 是有意 tradeoff。**合并前必须 150% 缩放 Windows 真机验证**。 |
| **#499** | `fix/408-eye-tracking-after-resume` | #408 眼睛冻住 + 唤醒重整 | 加了 `powerMonitor.on('resume'/'unlock-screen')` 骨架（`handleSystemWake`），但**只 re-arm 光标追踪，未含可见性/位置重申**（见 P1-第6条，需要补这一块）。 |

> 这三个 PR 的历史与 review 结论见仓库内对应记录；合并顺序无强依赖，可独立推进。

---

## 3. P0 高危（5 条，全部【需真机】）

### H1 · #538 全屏游戏每 ~5s 被打断（与 #545 是对立面）
- **现象**：Windows 上跑全屏（尤其独占全屏）游戏/应用时，桌宠每约 5 秒把可激活的命中窗强推到 `pop-up-menu` 顶层，周期性盖住/夺走前台全屏窗，游戏被踢出全屏或最小化，基本没法用；点击桌宠也会抢走游戏焦点。
- **根因**（6 条同根发现合并）：
  - hitWin 在 Windows 恒 `focusable:true`（`src/pet-window-runtime.js:545`，为修 #545 的 WS_EX_NOACTIVATE 拖拽路由 bug 的"KEY EXPERIMENT"；mac 在 :559 `setFocusable(false)`、Linux=false）。
  - 5s 看门狗 `reassertWindowAndTaskbar` 无条件 `setAlwaysOnTop(true,'pop-up-menu')`（`src/topmost-runtime.js:181` / 看门狗循环 :185-212）。
  - `guardAlwaysOnTop` 在掉层时立刻反击 + 1px nudge（`src/topmost-runtime.js:151-176`）。
  - 整条链**零 `GetForegroundWindow` / 全屏探测**，无法在游戏期间降级置顶或让出输入。
- **修复方案**：加一条 Windows 前台全屏探针（koffi 调 `GetForegroundWindow` + 比对 monitor rect，或 `SHQueryUserNotificationState` 判 `QUNS_RUNNING_D3D_FULL_SCREEN`/`PRESENTATION_MODE`），做成**可降级 getter**；在 `reassertWindowAndTaskbar`、`guardAlwaysOnTop` 的 reassert + nudge 前置门控：前台为独占全屏时**跳过 `setAlwaysOnTop` 与 nudge**，并可临时对 hitWin `setIgnoreMouseEvents(true)`/`setFocusable(false)` 让出输入，退出全屏后恢复。
  - **不能裸翻 `focusable:false`**（会复发 #545，且撞 `test/pet-window-runtime.test.js:163` 的 contract）。
  - 这正是 reporter 提议但未落仓的 `win-fullscreen-detect.js`。
- **复现与验证**：
  - 复现：开一个独占全屏游戏（或全屏视频播放器），观察桌宠是否每 ~5s 抢顶层/抢焦点、游戏被踢出全屏。
  - 验证：加探针后，全屏期间桌宠不再抢顶层/焦点；退出全屏后置顶恢复正常；非全屏时行为完全不变。补"全屏前台时不 reassert"单测。
- **关联**：#538（对立 #545）

### H2 · #525 DWM cloaking 无探测无恢复（锁屏/RDP 后消失只能重启）
- **现象**：锁屏解锁、RDP 重连、快速用户切换或某些 explorer/DWM 事件后，桌宠从屏幕消失，但 app 仍认为已显示（`isVisible()===true`、`petHidden===false`），右键菜单仍写"隐藏桌宠"，切换可见性也救不回，**只有重启 app 才恢复**。
- **根因**：唯一的周期可见性维护是 Windows topmost 看门狗，其体 `reassertWindowAndTaskbar` 只做 `setAlwaysOnTop(true)` + `keepOutOfTaskbar`（`src/topmost-runtime.js:179-183`）。`SetWindowPos(HWND_TOPMOST)` **不清 `DWMWA_CLOAKED`**，且看门狗 / `scheduleHwndRecovery` 全程无 `hide()→showInactive()` 取消 cloak 的路径。全 main 零 cloak 处理（`grep cloak/DwmGetWindowAttribute` = 0）。重启才好 = 重建窗口绕过 cloak。
- **修复方案**：沿用 PR #496 思路但**接进周期看门狗**才能真自愈：
  - 用已加载的 koffi（`src/main.js:151` 已 require）封 `_isWindowCloaked(win)` = `DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED=14, ...)`。
  - **务必用 repo 既有的 `nativeHandleToPointer` / `handle.readBigUInt64LE(0)` 取指针**，避开"把 `getNativeWindowHandle()` 原始 Buffer 当 `void*` 传"的指针 bug。
  - 看门狗每轮对 `getWin()`/`getHitWin()`：若 `!petHidden` 且 `isWindowCloaked` 为真，执行 `hide → showInactive` 一次性 un-cloak，再 reassert topmost + `syncHitWin()` + `setForceEyeResend`。
  - 守卫：**只在 `isWin`、`!petHidden`、`!isDragLocked`、`!miniTransitioning` 下做**，避免与拖动/mini 抢写。
- **复现与验证**：
  - 复现：`Win+L` 锁屏再解锁 / RDP 断开重连 / 快速用户切换后，看桌宠是否消失但程序仍认为显示。
  - 验证：接入探针 + 看门狗恢复后，**三个场景**下桌宠都能在几秒内自动恢复可见，无需重启。
- **关联**：#525（= 未合并 PR #496）、#184

### H3 · #530 类 renderer/hitWin 崩溃无 crash-loop 防护（启动崩 → 无限崩死循环）
- **现象**：在会让 renderer 启动即崩的 Windows 环境（虚拟显示软件 Honor/IddDesk 注入 DLL 被 code-integrity 拒、`0x80000003` 启动崩），桌宠永远起不来并进入紧凑的**崩溃 → reload → 再崩死循环**：持续吃 CPU、日志刷屏、永不停止，用户只能强杀；hitWin 同样陷入，且 Windows 上 `focusable` 反复 reload 还反复抢/丢焦点。
- **根因**：两条崩溃恢复路径都**无条件 reload 且不读 `details.reason`**：renderWin（`src/main.js:3422-3428`）与 hitWin（`src/main.js:3337-3340`）直接 `reloadWindowWebContents`，无 reload 计数/退避/时间窗。引入此机制的 `149cf59`（"guard reload after renderer crash"）只加了空安全、从未加循环防护。跨平台可恢复崩（`crashed`）与 Windows 确定性不可恢复崩（`integrity-failure`/`launched-failed`）被一视同仁。
- **修复方案**：
  - 加**滑动窗口崩溃限速**，renderWin/hitWin 共用：记录每窗 reload 时间戳，N 次/T 秒（如 ≥5/30s）后**停止自动 reload**，日志一次并托盘/通知提示；可加指数退避；`did-finish-load` 成功后重置计数。
  - 同时**按 `details.reason` 分流**：`clean-exit`/`killed` 不 reload；`integrity-failure`/`launched-failed` 走"放弃并提示"而非重试。
  - 封进 `reloadWindowWebContents` 或薄包装让两路继承。
- **复现与验证**：
  - 复现：在装了虚拟显示/注入软件的机器（或人为制造 renderer 启动崩），看是否崩→reload 死循环、CPU 跑满。
  - 验证：加限速后，崩 5 次/30s 即停手并提示，不再死循环；正常偶发崩仍能恢复一次。
- **关联**：#530（另见 H3 附注：#530 的根因排查仍需 reporter A/B，见 P2-第10条）

### H4 · #408 keepSizeAcrossDisplays 把 DPI 抖动期临时尺寸"洗白"成永久尺寸
- **现象**：开启"跨显示器保持大小"后，睡眠/唤醒、改 DPI 缩放、跨不同缩放显示器拖动或 RDP 重连后，桌宠**自己一点点变大且不自纠正**，重启仍是放大尺寸，只有手动拖一次尺寸滑杆才复位；100% 缩放下不复现。
- **根因**：纯 Windows per-monitor-DPI：`WM_DPICHANGED` 后 `win.getBounds()` 返回重算过的 DIP 尺寸，代码用 `setBounds(getBounds())` live 回读，在 DPI 往返下**非幂等**。`getEffectiveCurrentPixelSize` 在 keepSize + proportional 时直接回读 live 窗口（`src/main.js:752-753`）；display 事件/drag-end 同样回读 live 并写回 `savedPixelWidth/Height`（`src/pet-window-runtime.js:751-757`、`src/pet-interaction-ipc.js:113-119`）；启动恢复用持久化的膨胀值（`src/size-utils.js:56-61`）；且 `proportionalRecalc` 被 `!getKeepSizeAcrossDisplays()` 显式禁掉，关掉了自纠正。
- **修复方案**：**合并 PR #501**（分支 `fix/408-size-growth-keepsize`）——keepSize 开启时不再每次回读 live bounds，而把首次确定的 DIP 尺寸冻结进 in-memory truth（`keepSizeFrozenPx`），display/drag/effective 路径改读冻结值；启动 clamp 用独立 `savedPixelWorkArea` 当 frozen-origin 而非可能已漂移的当前 work area。（`grep` 确认 `keepSizeFrozenPx` 当前 src 不存在 = 未合并。）
- **复现与验证**：
  - 复现：开"跨显示器保持大小"，睡眠唤醒 / 切不同缩放显示器 / RDP 重连，看桌宠是否变大且重启仍大。
  - 验证：合 #501 后，同样操作尺寸不漂移；**必须 150% 缩放 Windows 真机**。
- **关联**：#408（PR #501 未合）

### H5 · #544 Windows Clawd 把 PowerShell-only 命令写进与 WSL 共享的 Codex hooks.json
- **现象**：`CODEX_HOME=/mnt/c/Users/<user>/.codex` 跨 Windows/WSL 共享时，WSL 内启动的 Codex **每个 hook 失败**：`SessionStart hook (failed) exited with code 1`，WSL shell 跑 `& "node" "D:/..."` 报 `parse error near '&'`；桌宠对 WSL Codex 完全无反应。
- **根因**：`buildCodexHookCommand` 硬编码 `windowsWrapper:'powershell'`（`hooks/codex-install-utils.js:52`），`formatNodeHookCommand` 在 `platform==='win32'` 时发 PowerShell call-operator 形式 `& "node" "script"`（`hooks/json-utils.js:223-226`）；platform 来自 Windows 主机 = win32，但同一 `hooks.json` 被 WSL 下的 Codex 执行。与 Claude Code 不同，Codex hook schema **无 shell 旁路字段**（wrapper 烤进 command 串），且 `CODEX_HOME` 经设计跨 OS 共享。嵌入的 node 路径也是 Windows 路径，在 WSL 无意义。`hooks/` 内无任何 WSL/共享检测。
- **修复方案**（两条腿任选/并用）：
  1. 改写命令为**跨 shell 安全形式**或始终发裸 `"node" "script"`（需真机验证 Windows-native Codex 实际用何 shell 执行 command）。
  2. **治本**：检测 `CODEX_HOME` 指向 `/mnt/c/...` 或 `/proc/version` 含 `microsoft` 时改用 POSIX 形式/remote 模式注册。
- **复现与验证**：
  - 复现：`CODEX_HOME` 指到 `/mnt/c/.../.codex`，Windows 和 WSL 共用，WSL 里启 Codex，看 hook 是否 exit 1。
  - 验证：修后**真实 Windows + WSL2 共享 CODEX_HOME** 机器上 `SessionStart` 不再 exit 1。
- **关联**：#544

---

## 4. P1 中危

### 6 · 无 resume/unlock-screen/RDP 可见性重申监听器（powerMonitor 完全未用）【需真机】
- **现象**：机器唤醒、解锁、RDP/console 重接后，桌宠可能错位/被隐藏/被 cloak 且无自动恢复，只在下次用户触发的 show/move 或重启时自愈。
- **根因**：main 无任何 `powerMonitor`/`resume`/`unlock-screen` 监听（grep=0）。可见性/位置恢复只接 `display-metrics-changed`/`added`/`removed`（`src/main.js:3434-3436`）与 5s 看门狗，都不在 resume/unlock/RDP-attach 触发。renderWin 的 `query-session-end`/`session-end`（`src/pet-window-runtime.js:493-494`）仅 flush prefs。（注：置顶丢失部分会被 5s 看门狗 ~5s 内自愈，故核心缺口只剩"被隐藏/cloak/错位"的恢复。）
- **修复方案**：`createWindow` 内注册去抖幂等的 `powerMonitor.on('resume'/'unlock-screen', reassertOnWake)`；`reassertOnWake` 中若 `!petHidden` 对 renderWin/hitWin 调 `showInactive()` + `keepOutOfTaskbar()` + `setAlwaysOnTop(true, WIN_TOPMOST_LEVEL)` + `syncHitWin()`，可顺带 `scheduleHwndRecovery()`；`try/catch` 包裹。**可复用 PR #499 的 `handleSystemWake` 骨架但需补可见性/位置重申**（#499 当前只 re-arm 光标/tick）。
- **关联**：#525、#184（与 H2 同源，建议一起做）

### 7 · second-instance 重启在 petHidden=true 时裸 showInactive 重显桌宠 → 状态机错位
- **现象**：用户右键隐藏桌宠后，再从任务栏/开始菜单/快捷方式/`clawd://` 链接/拖文件夹重启 Clawd，桌宠窗重新出现但 app 仍认为隐藏：托盘/右键菜单显示"显示桌宠"、气泡与会话 HUD 仍被压制，需手点显示桌宠才 resync。
- **根因**：second-instance 处理器无条件 `win.showInactive()` + `hitWin.showInactive()`（`src/main.js:3630/3634`），绕过 `setPetHidden`，`petHidden` 不翻、`showFloatingSurfacesForPet` 不调、托盘/右键菜单不重建（菜单标签由 `ctx.petHidden` 派生，`src/menu.js:256/468`，故 stale）。平行的菜单关闭路径有 `!ctx.petHidden` 守卫，second-instance 缺这一守卫。
- **修复方案**：按 `petHidden` 分流：若 `isPetHidden()` 为真则改调 `setPetHidden(false)`（走完整 resync），否则保持现有 `showInactive()` + `keepOutOfTaskbar`。补单测：`petHidden=true` 时 second-instance 后 `petHidden` 翻 false 且 `buildContextMenu` 被调。
- **关联**：none（纯逻辑，不依赖真机也能验单测；最终行为建议真机过一眼）

### 8 · New Session 启动同步阻塞主进程：findClaudeCmd 用 execFileSync 跑 where，最多冻结 5s【需真机】
- **现象**：点"新建 Claude 会话"后桌宠瞬间卡住（动画停、拖不动）最长 5s 才弹终端；PATH 巨大/挂网络盘/where 解析慢时尤甚。
- **根因**：`launchClaudeSession`（async）入口第一件事就同步调 `findClaudeCmd`（`src/launch-claude.js:341`），内部 `execFileSync('where'/'which', {timeout:5000})`（:100-105）**阻塞 Electron 主进程事件循环**——主进程正是渲染/拖动/topmost 驱动方。Windows 走 `where`（进程级查 PATHEXT、被映射网络盘拖累）比 POSIX `which` 慢得多。
- **修复方案**：把 PATH 查询异步化：`findClaudeCmd` 改用 `child_process.execFile`（异步）包装，`src/launch-claude.js:341` 改 `await`，保留 5s timeout 但作为 async timeout 让事件循环继续转；可顺带缓存解析结果。（注：drop-folder 路径走 `openTerminalAt` 不触此 probe，只有显式 New Session 命中。）
- **关联**：#331

### 9 · hitWin 渲染进程崩溃时未清 dragLocked → 拖拽锁卡死 → 命中层错位 → 点击穿透
- **现象**：拖动中 hitWin renderer 崩溃（reload 后 DOM `isDragging` 复位但主进程 `dragLocked` 仍 true），此后桌宠移动时 hitWin 不跟随、命中矩形漂移出桌宠像素，落在桌宠上的点击**穿透到背后应用**（#545 的崩溃边缘场景）。
- **根因**：hitWin 崩溃处理只 log + `reloadWindowWebContents`（`src/main.js:3337-3340`），**无 `setDragLocked(false)`**；对照 render 崩溃 `src/main.js:3425` 显式释放——不对称缺口。crash 后 reload 的新 hit-renderer 初始化 `isDragging=false` 使 `stopDrag` 被挡住，唯一发 `dragLock(false)` 的路径永不触发。`dragLocked` 永久 true → `syncHitWin` 在 `src/pet-window-runtime.js:397` 早退。（可达性低：需崩溃恰落在拖拽窄窗口。）
- **修复方案**：把 hitWin 崩溃处理改成与 render 对称：`onRenderProcessGone` 里 reload 前/后补 `petWindowRuntime.setDragLocked(false)` + `clearDragSnapshot()`；更稳妥在 `did-finish-load` 防御性清一次锁。补测试断言 hitWin `onRenderProcessGone` 含 `setDragLocked(false)`。
- **关联**：#545

### 10 · #530 修复补丁从未提交，且原计划开关在 Electron 41 已是死开关【需真机/需 reporter A/B】
- **现象**：用户报的 Windows renderer 启动崩 `0x80000003` 在当前代码**无任何缓解**（无禁 sandbox/code-integrity 开关、无 `windows-renderer-code-integrity.js`）；装了虚拟显示/注入类软件的机器桌宠完全无法启动（干净机复现不了）。
- **根因**：`RendererCodeIntegrity`（强制 renderer 只加载微软签名模块）是 Windows 独有特性，第三方 DLL 注入致 renderer 拒绝启动。补丁始终未 commit。即便提交，原计划的 `--disable-features=RendererCodeIntegrity` 在 Chromium 146（Electron 41）**已是 no-op 死开关**；唯一让 renderer 活的 `--no-sandbox` 会整体关沙箱（安全降级）。
- **修复方案**：**无"干净一招"**。可发严格不劣于现状的缓解 `app.commandLine.appendSwitch('allow-third-party-modules')`（修 GPU 那条腿，干净机零风险），但大概率修不好受沙箱的 renderer。**正确处置：等 reporter A/B**（Event Viewer 的 CodeIntegrity 日志拿被挡 DLL 名 + 关虚拟显示软件重测）确认根因再决定；若先发，#530 措辞须写"缓解待确认"。
- **关联**：#530

---

## 5. P2 低危 / 打磨

> 这些影响小或低频，建议作为 follow-up，不阻断高危推进。详情见 raw.json。

- **11 · display-metrics 几何处理无防抖**（`src/pet-window-runtime.js:741-761`）：DPI 切换/RDP 重连时桌宠抖动跳位（同文件 textScale 却防抖 400ms）。修：镜像 textScale 的 400ms 防抖。瞬态视觉，#408 关联被高估。
- **12 · 设置尺寸预览期看门狗把桌宠插到设置窗之上**（`src/pet-window-runtime.js:693`）：纯视觉遮挡，点击仍能落到滑杆。修：给看门狗注入 `isSettingsSizePreviewActive()` 谓词，预览期跳过 reassert。
- **13 · render 窗 guard 只重顶自己，短暂把 hitWin 压到 render 之下**（`src/topmost-runtime.js:155`）：z-order 反转，但 render 永久穿透故不可单独触发输入缺陷，健壮性 nit。修：guard 里调 `reassertWinTopmost()`。
- **14 · 启动恢复期反复跑 Get-CimInstance Win32_Process 全量枚举**（`src/state.js:1890-1902`，#350）：进程多的机器周期性 CPU/IO 抖动。修：改用 WQL `-Filter` 让 WMI 不物化全部进程。
- **15 · wt.exe 启动依赖 Windows Terminal post-`--` 重分词，无测试覆盖**（`src/launch-claude.js:200`）：某些 WT 版本/含空格路径下可能开错 tab。修：加真实 wt 启动用例穿过重分词层。
- **16 · SetConsoleOutputCP(65001) 崩溃/被 kill 时不还原**（`src/main.js:172-193`）：仅开发态，硬 kill 后父控制台留 UTF-8。修：补 SIGTERM/SIGINT 还原（SIGKILL 不可堵）。
- **17 · 终端 detached spawn 只观测终端起没起、看不到内层 claude 是否成功**（`src/launch-claude.js:65`，#331）：内层失败仍判成功（非 Windows 独有，但 Windows 概率最高）。修：临时 marker 探针 + Doctor 增可启动性检查。
- **18 · 无 GPU 进程崩溃恢复 / 无软渲染兜底**（`src/main.js:134`）：GPU 反复崩的机器桌宠可能闪烁/不可见无降级。注：#530 的崩独立于 GPU，**此项与 #530 关联是错的**，纯预防性硬化。修：监听 `child-process-gone` type=GPU，重复崩则下次 `disableHardwareAcceleration()`。

---

## 6. 本轮未覆盖（后续可再审）

- **真机验证缺口（最重要）**：本轮全部代码 + git 审计，10 条 `needsRealMachine` 行为均未在真 Windows 机/真全屏游戏验证。
- `taskbar.js` / `skipTaskbar` / `keepOutOfTaskbar` 自身的 Windows 行为、AppUserModelID、任务栏图标/跳转列表、托盘在多显示器/RDP 下的表现。
- `updater.js` 的 Windows 自更新路径（Squirrel/NSIS、运行中替换、UAC 提权、code-signing 校验）。
- Windows 通知/Action Center 与桌宠气泡的交互、focus assist/勿扰模式下的提醒行为。
- `pet-geometry-main.js` 坐标系在混合 DPI 多显示器 + **负坐标**（显示器在主屏左/上方）布局下的 clamp/换算。
- `hit-renderer.js` 的 `setShape` 命中区在 Windows 高 DPI 下与桌宠像素的对齐精度（物理像素 vs DIP）。
- Claude 侧 hook 命令在 Windows 的健壮性（`resolveWindowsNodeBinSync`、`where.exe` 依赖、空格/中文用户名路径）。
- 并发/竞态：多个 reassert 路径（看门狗/guard/scheduleHwndRecovery/display 事件）与 drag/mini/preview 状态之间的跨路径写竞争。

---

## 7. 附：审计方法与可信度

- **方法**：10 维度并行 finder（实读代码 + grep + git）→ 每条发现独立对抗式验证（重点 `git log -S` / `merge-base --is-ancestor` 核验"是否已修"）→ 汇总去重排序。
- **规模**：46 agent / ~270 万 token / 882 工具调用 / ~29 分钟。
- **可信度信号**：28 条全部经 git 核验仍在 main 上、未被任何已合并 PR 修掉；**0 条"其实已修"的误报**（找手未犯凭记忆误判的错）。
- **完整证据**：`docs/investigations/windows-audit-2026-06-23.raw.json`（每条含逐字 verdict + file:line + git 核验）。
