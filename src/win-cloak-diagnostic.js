"use strict";

// ── 临时诊断模块（#525 宠物消失根因）────────────────────────────────────
// 默认【纯只读】：采集 render/hit 窗口的完整可见性快照——DWMWA_CLOAKED
// flag + HRESULT、isVisible、原生 IsWindowVisible、isMinimized、
// isAlwaysOnTop、bounds、与各 display 的交集(onScreen)，外加 display 布局、
// petHidden/miniTransitioning 内部状态、togglePet 快捷键注册状态。在 flag
// 变化、isVisible 变化、窗口 show/hide/minimize/restore 事件、WM_SHOWWINDOW
// 消息、电源事件、显示器变化时各 dump 一次完整快照。best-effort：非 Windows
// / FFI 失败时 no-op，绝不影响正式逻辑；timer 与所有事件回调都包了
// try/catch，异步异常也不拖垮主进程。日志写 userData/cloak-diagnostic.log。
//
// 第二轮加强（#496 报告者日志显示消失瞬间 cloak flag 不变、visible 变 false，
// 需要区分"内部 setPetHidden vs 外部进程 ShowWindow(SW_HIDE)"）：
//   • petRuntime 边界打点：wrap setPetHidden / togglePetVisibility /
//     bringPetToPrimaryDisplay，记录参数、调用前后 petHidden、返回值和精简
//     调用栈（区分快捷键 / 托盘菜单 / 右键菜单 / mac bridge 入口）。只包一层
//     日志，行为不变，stop() 时还原。
//   • WM_SHOWWINDOW hook：HWND 被【任何进程】显示/隐藏前 Windows 都会发此
//     消息。shown=0 表示即将隐藏；lParam=0 表示来自显式 ShowWindow 调用
//     （而非父窗口最小化等连带原因）。
//
// 可选 mutation（默认关）：设环境变量 CLAWD_CLOAK_DIAG_UNCLOAK=1 时，才对
// APP-cloak(flag=1) 试一次 DwmSetWindowAttribute(DWMWA_CLOAK=false) 验证
// uncloak 原语；该写操作会改窗口状态，日志以 [MUTATE] 标明。默认只读，避免
// 恢复动作掩盖根因。
//
//   ⚠ 用完即删：删本文件 + main.js 里 "临时诊断（#525）" 整块接入代码。
//
// 判读（宠物消失瞬间看日志；下表为 2026-07-03 真机实测的签名矩阵）：
//
//              | >>> 打点行 | WM_SHOWWINDOW | win-event | petHidden
//   内部 hide  |  ✓(含栈)  |   不发(!)     |  ✓ hide   | true（一致）
//   外部 SW_HIDE| 无        |  ✓ shown=0    |  不触发(!) | false（失配！）
//
//   • 有 ">>> setPetHidden/togglePetVisibility" 行 → 内部路径，看 caller
//     栈定位入口（main.js:322 快捷键 handler / menu.js 托盘 / 右键菜单）。
//   • 没有 ">>>" 行、有 WM_SHOWWINDOW shown=0 lParam=0、且 petHidden 与
//     visible 失配 → 外部进程 ShowWindow(SW_HIDE)，查报告者机器装了什么。
//   • 实测注意：Electron 内部 hide 不发 WM_SHOWWINDOW（走 SetWindowPos），
//     外部 ShowWindow 不触发 Electron hide 事件——两个探针互补，另有 2s
//     轮询对 isVisible 翻转兜底，三层不会同时漏。
//   • WM_SHOWWINDOW 在状态生效【前】发出，其快照里 visible 仍是旧值，正常。
//   • flag 非 0 → DWM cloak；看值 APP=1 / SHELL=2 / INHERITED=4。
//
// 第三轮加强（#496 报告者 7-09 日志：petHidden/visible/nativeVis/bounds 全部
// 正常但肉眼看不见——窗口管理层全绿，嫌疑转向"内容没被合成到屏幕"）：
//   • 虚拟桌面归属：IVirtualDesktopManager::IsWindowOnCurrentVirtualDesktop
//     （微软公开给外部进程用的 shell COM 接口，Win10+），每窗口快照带
//     vdesk=CURRENT/OTHER——直接检验 render 窗口 flag 恒为 SHELL(2) 是否
//     意味着窗口被挂到了别的虚拟桌面。
//   • GPU 路径：快照带 gpuAccelDisabled + gpu_compositing（来自
//     app.getGPUFeatureStatus()）；监听 app child-process-gone（重点 GPU
//     进程）与各窗口 render-process-gone——合成进程/渲染进程死掉重启是
//     "窗口在、像素没了"的经典成因。
//   • 对照开关（v2 修正了判读，见下）：CLAWD_DIAG_DISABLE_GPU=1 关硬件加速
//     （同时显式 --disable-gpu，electron#51363）；CLAWD_DIAG_DISABLE_DCOMP=1
//     关 DirectComposition + 恢复 DWM redirection bitmap。见 main.js ready
//     前的接入。
//
// 第三轮 v2（codex 复审补盲区：窗口层全绿 ≠ 只剩 GPU/vdesk 两个嫌疑）：
//   • 页面像素 ground truth：win.webContents.capturePage() 读回 Chromium
//     合成器输出（在 DWM/MPO 之【前】），统计 alpha>0 像素数 + bbox。
//     判读：capture 有像素 + 屏幕没有 → DWM/DComp/MPO 输出链路；
//     capture 没像素 → 页面/renderer 上游；有像素但 bbox 越界 → 布局。
//   • viewportOffsetY（本项目自身机制！）：drag-position 把负 Y 虚拟坐标钳
//     回屏幕产生补偿量，renderer 加进 CSS bottom——过大时角色被推出透明窗口
//     外，窗口全绿但屏幕无角色。快照带 viewportOffsetY + virtualBounds，
//     domProbe 带媒体元素 boundingClientRect/inView。
//   • 整窗 opacity：theme-fade 会把窗口淡到 0（theme-fade-sequencer），中断
//     即残留全透明。快照带 op=getOpacity()；wrap setOpacity 记 caller；
//     native 行带 WS_EX_LAYERED + GetLayeredWindowAttributes alpha。
//   • DOM 状态：executeJavaScript 采 #pet-clip clipPath、#pet-container
//     display、媒体元素 rect/computed style/naturalSize/inView。
//   • z-order 遮挡：aot=true 只说明进 topmost band 不代表 band 顶；沿
//     GW_HWNDPREV 枚举盖在 render 上方且相交的可见窗口（class/pid/rect/
//     cloak，不记标题——日志会被公开上传）。
//   • native 几何 vs DIP：GetWindowRect（物理像素）+ DWMWA_EXTENDED_FRAME_
//     BOUNDS + GetDpiForWindow，混合 DPI/拓扑变化时与 Electron DIP bounds
//     对账。
//   • HWND 身份校验：hwnd hex + IsWindow + GetAncestor(GA_ROOT)==self +
//     pid==本进程——防"COM/DWM 答的是另一个 HWND 的问题"。
//   • remoteSession（SM_REMOTESESSION）+ gpuInfoReady + getGPUInfo 一次性
//     能力摘要（directComposition/supportsOverlays）。
//   判读修正：GPU 档"关掉后可见"只证明【渲染路径变化有影响】，不特指 MPO
//   （Chromium 软件模式仍走 DXGI+DComp）；"关掉后仍不可见"也不能排除合成层
//   ——要结合 DComp 档与 pageCapture 三方交叉。建议报告者跑 A(正常)→
//   B(gpu off)→A→C(dcomp off)，排除单次重启带来的状态重置干扰。

const fs = require("fs");

const DWMWA_CLOAK = 13;     // set：让本进程 cloak/uncloak 自己的窗口
const DWMWA_CLOAKED = 14;   // get：读 cloak 状态(0 / APP=1 / SHELL=2 / INHERITED=4)
const WM_SHOWWINDOW = 0x0018; // 窗口显示状态即将改变（任何进程触发都会发）
const POLL_MS = 2000;
const HEARTBEAT_EVERY = 15; // 每 ~30s 打一次单行心跳，即使 flag 没变
// 默认纯只读；仅显式 opt-in 才试写 uncloak（见文件头说明）。
const UNCLOAK_OPT_IN = process.env.CLAWD_CLOAK_DIAG_UNCLOAK === "1";

function createCloakDiagnostic(options = {}) {
  const isWin = options.isWin != null ? !!options.isWin : process.platform === "win32";
  const getWindows = typeof options.getWindows === "function" ? options.getWindows : () => [];
  const app = options.app || null;
  const powerMonitor = options.powerMonitor || null;
  const screen = options.screen || null;
  const logPath = options.logPath;
  const petRuntime = options.petRuntime || null;
  const getPetState = typeof options.getPetState === "function" ? options.getPetState : null;
  const getShortcutStatus = typeof options.getShortcutStatus === "function" ? options.getShortcutStatus : null;
  const getGpuStatus = typeof options.getGpuStatus === "function" ? options.getGpuStatus : null;
  const getGpuInfo = typeof options.getGpuInfo === "function" ? options.getGpuInfo : null;
  const getViewportState = typeof options.getViewportState === "function" ? options.getViewportState : null;
  const noop = { start() {}, stop() {} };
  if (!isWin || !logPath) return noop;

  function stamp() {
    return new Date().toISOString().replace("T", " ").replace("Z", "");
  }
  function log(line) {
    try { fs.appendFileSync(logPath, `${stamp()} [cloak-diag] ${line}\n`); } catch {}
  }

  let koffi;
  let dwmGet;
  let dwmSet;
  let ptrSize;
  try {
    koffi = require("koffi");
    const dwmapi = koffi.load("dwmapi.dll");
    dwmGet = dwmapi.func("int __stdcall DwmGetWindowAttribute(void *hwnd, uint dwAttribute, void *pvAttribute, uint cbAttribute)");
    dwmSet = dwmapi.func("int __stdcall DwmSetWindowAttribute(void *hwnd, uint dwAttribute, void *pvAttribute, uint cbAttribute)");
    ptrSize = koffi.sizeof("void *");
  } catch (err) {
    log(`init FAILED: ${err && err.message}`);
    return noop;
  }

  // 原生层可见性：Electron isVisible 之外的独立佐证（检查 WS_VISIBLE 链）。
  // v2 起 u32 挂第三轮 native 探针集；单个符号缺失（老系统/32 位进程没有
  // GetWindowLongPtrW 等）只降级对应字段，不拖垮整组。
  let isWindowVisibleNative = null;
  let u32 = null;
  try {
    const user32 = koffi.load("user32.dll");
    isWindowVisibleNative = user32.func("int __stdcall IsWindowVisible(void *hwnd)");
    u32 = {};
    const defs = [
      ["GetWindowRect", "int __stdcall GetWindowRect(void *hwnd, void *rect)"],
      ["GetWindow", "void * __stdcall GetWindow(void *hwnd, uint uCmd)"],
      ["GetClassNameW", "int __stdcall GetClassNameW(void *hwnd, void *buf, int cchMax)"],
      ["GetWindowThreadProcessId", "uint __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint *pid)"],
      ["GetAncestor", "void * __stdcall GetAncestor(void *hwnd, uint gaFlags)"],
      ["IsWindow", "int __stdcall IsWindow(void *hwnd)"],
      ["GetDpiForWindow", "uint __stdcall GetDpiForWindow(void *hwnd)"],
      ["GetLayeredWindowAttributes", "int __stdcall GetLayeredWindowAttributes(void *hwnd, _Out_ uint *crKey, _Out_ uint8 *bAlpha, _Out_ uint *dwFlags)"],
      ["GetWindowLongPtrW", "int64 __stdcall GetWindowLongPtrW(void *hwnd, int nIndex)"],
      ["GetWindowRgnBox", "int __stdcall GetWindowRgnBox(void *hwnd, void *rect)"],
      ["GetSystemMetrics", "int __stdcall GetSystemMetrics(int nIndex)"],
    ];
    for (const [n, sig] of defs) {
      try { u32[n] = user32.func(sig); } catch (err) { log(`user32.${n} unavailable: ${err && err.message}`); }
    }
  } catch (err) {
    log(`user32 init failed (nativeVis unavailable): ${err && err.message}`);
  }

  // 虚拟桌面归属（第三轮）：IVirtualDesktopManager 是公开 shell COM 接口，
  // 专为外部进程查询设计。koffi 没有 COM 封装，走虚表手动调：*iface 是
  // vtable，槽位 0-2 是 IUnknown，槽位 3 = IsWindowOnCurrentVirtualDesktop。
  // 初始化/调用失败一律降级为 vdesk=unavail，不影响其余探针。
  let vdeskCheck = null;
  let vdeskRelease = null;
  try {
    const ole32 = koffi.load("ole32.dll");
    const CoInitializeEx = ole32.func("int __stdcall CoInitializeEx(void *pvReserved, uint dwCoInit)");
    const CoCreateInstance = ole32.func(
      "int __stdcall CoCreateInstance(void *rclsid, void *pUnkOuter, uint dwClsContext, void *riid, _Out_ void **ppv)"
    );
    // GUID 内存布局：Data1(u32 LE) Data2(u16 LE) Data3(u16 LE) Data4(8 bytes)
    const guidBuf = (g) => {
      const [d1, d2, d3, d4, d5] = g.split("-");
      const b = Buffer.alloc(16);
      b.writeUInt32LE(parseInt(d1, 16), 0);
      b.writeUInt16LE(parseInt(d2, 16), 4);
      b.writeUInt16LE(parseInt(d3, 16), 6);
      Buffer.from(d4 + d5, "hex").copy(b, 8);
      return b;
    };
    // 主线程可能已被 Chromium 初始化过 COM：S_OK/S_FALSE/RPC_E_CHANGED_MODE
    // 都不算失败，成败以 CoCreateInstance 为准。
    const coInitHr = CoInitializeEx(null, 0x2 /* COINIT_APARTMENTTHREADED */);
    const ppv = [null];
    const ccHr = CoCreateInstance(
      guidBuf("AA509086-5CA9-4C25-8F95-589D3C07B48A"), // CLSID_VirtualDesktopManager
      null,
      0x17 /* CLSCTX_ALL */,
      guidBuf("A5CD92FF-29BE-454C-8D04-D82879FB3F1B"), // IID_IVirtualDesktopManager
      ppv
    );
    if (ccHr !== 0 || !ppv[0]) {
      log(`vdesk probe unavailable: CoInitializeEx=${hrStr(coInitHr)} CoCreateInstance=${hrStr(ccHr)}`);
    } else {
      const mgr = ppv[0];
      const vtbl = koffi.decode(mgr, "void *");
      const fnIsOnCurrent = koffi.decode(vtbl, 3 * ptrSize, "void *");
      const IsOnCurrentProto = koffi.proto(
        "int __stdcall DiagIsWindowOnCurrentVirtualDesktop(void *self, void *hwnd, _Out_ int *onCurrent)"
      );
      vdeskCheck = (hwnd) => {
        try {
          const out = [0];
          const hr = koffi.call(fnIsOnCurrent, IsOnCurrentProto, mgr, hwnd, out);
          if (hr !== 0) return `vdesk=err:${hrStr(hr)}`;
          return out[0] ? "vdesk=CURRENT" : "vdesk=OTHER";
        } catch (err) {
          return `vdesk=throw:${err && err.message}`;
        }
      };
      // stop() 时 Release 接口（IUnknown 槽位 2）。故意不 CoUninitialize：
      // 主线程 COM 生命周期归 Chromium 管，进程退出自然回收。
      const fnRelease = koffi.decode(vtbl, 2 * ptrSize, "void *");
      const ReleaseProto = koffi.proto("uint __stdcall DiagIUnknownRelease(void *self)");
      vdeskRelease = () => { try { koffi.call(fnRelease, ReleaseProto, mgr); } catch {} };
      log(`vdesk probe ready (CoInitializeEx=${hrStr(coInitHr)})`);
    }
  } catch (err) {
    log(`vdesk init failed: ${err && err.message}`);
  }

  const lastFlag = new Map();
  const lastVisible = new Map();
  const powerListeners = [];
  const screenListeners = [];
  const appListeners = [];
  const windowDisposers = [];
  const runtimePatches = [];
  const hookedWindows = new WeakSet();
  let timer = null;
  let ticks = 0;

  function hrStr(hr) {
    if (typeof hr !== "number") return String(hr);
    return hr === 0 ? "0" : `0x${(hr >>> 0).toString(16)}`;
  }

  function hwndOf(win) {
    try {
      const buf = win.getNativeWindowHandle();
      if (!buf || buf.length < ptrSize) return null;
      return koffi.decode(buf, "void *");
    } catch {
      return null;
    }
  }

  function readCloaked(hwnd) {
    try {
      const out = Buffer.alloc(4);
      const hr = dwmGet(hwnd, DWMWA_CLOAKED, out, 4);
      // DWMWA_CLOAKED 是 DWORD（无符号）：0 / APP=1 / SHELL=2 / INHERITED=4
      return { hr, flag: hr === 0 ? out.readUInt32LE(0) : null };
    } catch (err) {
      return { hr: `throw:${err && err.message}`, flag: null };
    }
  }

  function tryUncloak(hwnd) {
    try {
      const f = Buffer.alloc(4); // BOOL FALSE（全 0）
      return dwmSet(hwnd, DWMWA_CLOAK, f, 4);
    } catch (err) {
      return `throw:${err && err.message}`;
    }
  }

  // 窗口 bounds 与哪个 display 有交集、交集面积——直接回答"窗口在不在屏幕可见区"。
  function coverage(bounds) {
    if (!screen || typeof screen.getAllDisplays !== "function" || !bounds) return "onScreen=?";
    try {
      let best = null;
      for (const d of screen.getAllDisplays()) {
        const db = d.bounds || {};
        const x = Math.max(bounds.x, db.x);
        const y = Math.max(bounds.y, db.y);
        const r = Math.min(bounds.x + bounds.width, db.x + db.width);
        const btm = Math.min(bounds.y + bounds.height, db.y + db.height);
        const w = r - x;
        const h = btm - y;
        if (w > 0 && h > 0) {
          const area = w * h;
          if (!best || area > best.area) best = { id: d.id, area };
        }
      }
      return best ? `onScreen=YES display#${best.id} interArea=${best.area}` : "onScreen=NO";
    } catch {
      return "onScreen=err";
    }
  }

  // 单窗口完整状态：cloak flag/hr + isVisible + 原生可见性 + isMinimized +
  // alwaysOnTop + bounds + onScreen
  function winSnapshot(name, win) {
    if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) {
      return `${name}: <destroyed/null>`;
    }
    const hwnd = hwndOf(win);
    if (!hwnd) return `${name}: no hwnd`;
    const { hr, flag } = readCloaked(hwnd);
    const vis = typeof win.isVisible === "function" ? win.isVisible() : "?";
    let nativeVis = "?";
    if (isWindowVisibleNative) {
      try { nativeVis = !!isWindowVisibleNative(hwnd); } catch {}
    }
    const minz = typeof win.isMinimized === "function" ? win.isMinimized() : "?";
    const aot = typeof win.isAlwaysOnTop === "function" ? win.isAlwaysOnTop() : "?";
    // 整窗透明度：theme-fade 淡出中断会把 opacity 残留在 0——各层"可见"
    // 但整窗全透明（codex 复审补的盲区）。
    let op = "?";
    try { if (typeof win.getOpacity === "function") op = win.getOpacity(); } catch {}
    let bounds = null;
    let b = "?";
    try {
      bounds = win.getBounds();
      b = `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`;
    } catch {}
    const vdesk = vdeskCheck ? vdeskCheck(hwnd) : "vdesk=unavail";
    return `${name}: flag=${flag} hr=${hrStr(hr)} visible=${vis} nativeVis=${nativeVis} min=${minz} aot=${aot} op=${op} bounds=[${b}] ${coverage(bounds)} ${vdesk}`;
  }

  function rectStr(buf) {
    const l = buf.readInt32LE(0);
    const t = buf.readInt32LE(4);
    const r = buf.readInt32LE(8);
    const b = buf.readInt32LE(12);
    return `${l},${t} ${r - l}x${b - t}`;
  }

  function classNameOf(hwnd) {
    if (!u32 || !u32.GetClassNameW) return "?";
    try {
      const buf = Buffer.alloc(512);
      const n = u32.GetClassNameW(hwnd, buf, 256);
      return n > 0 ? buf.toString("utf16le", 0, n * 2) : "?";
    } catch {
      return "?";
    }
  }

  // native 细节行：HWND 身份校验（是不是我们以为的那个窗口）+ 扩展样式/
  // layered alpha + 物理像素几何——与 Electron DIP bounds 对账，混合 DPI/
  // 拓扑变化时两边不一致本身就是线索。
  function nativeDetail(name, hwnd) {
    if (!u32) return `${name} native: unavail`;
    const parts = [];
    try { parts.push(`hwnd=0x${koffi.address(hwnd).toString(16)}`); } catch {}
    try { if (u32.IsWindow) parts.push(`isWindow=${u32.IsWindow(hwnd) ? 1 : 0}`); } catch {}
    try {
      if (u32.GetAncestor) {
        const root = u32.GetAncestor(hwnd, 2 /* GA_ROOT */);
        parts.push(`root=${root && koffi.address(root) === koffi.address(hwnd) ? "self" : "OTHER!"}`);
      }
    } catch {}
    try {
      if (u32.GetWindowThreadProcessId) {
        const pid = [0];
        u32.GetWindowThreadProcessId(hwnd, pid);
        parts.push(`pid=${pid[0] === process.pid ? "me" : pid[0]}`);
      }
    } catch {}
    try {
      if (u32.GetWindowLongPtrW) {
        const ex = Number(u32.GetWindowLongPtrW(hwnd, -20 /* GWL_EXSTYLE */));
        const f = [];
        if (ex & 0x00080000) f.push("LAYERED");
        if (ex & 0x00200000) f.push("NOREDIRBMP");
        if (ex & 0x00000008) f.push("TOPMOST");
        if (ex & 0x00000020) f.push("TRANSPARENT");
        if (ex & 0x08000000) f.push("NOACTIVATE");
        parts.push(`exStyle=0x${(ex >>> 0).toString(16)}(${f.join(",")})`);
        if ((ex & 0x00080000) && u32.GetLayeredWindowAttributes) {
          const key = [0];
          const alpha = [0];
          const flags = [0];
          const ok = u32.GetLayeredWindowAttributes(hwnd, key, alpha, flags);
          // alpha 数值只在 LWA_ALPHA(0x2) 生效时才有意义；flags=0（DComp/
          // UpdateLayeredWindow 型窗口的常态）时 alpha 字段是残值，直接报
          // 数值会被误读成"全透明"。读不到也不等于透明。
          if (!ok) parts.push("layered{unreadable}");
          else if (flags[0] & 0x2) parts.push(`layered{alpha=${alpha[0]} flags=0x${flags[0].toString(16)}}`);
          else parts.push(`layered{attrs-unset flags=0x${flags[0].toString(16)}}`);
        }
      }
    } catch { parts.push("exStyle=err"); }
    try {
      if (u32.GetWindowRect) {
        const r = Buffer.alloc(16);
        if (u32.GetWindowRect(hwnd, r)) parts.push(`physRect=[${rectStr(r)}]`);
      }
    } catch {}
    try {
      const r = Buffer.alloc(16);
      const hr = dwmGet(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, r, 16);
      parts.push(hr === 0 ? `dwmFrame=[${rectStr(r)}]` : `dwmFrame=err:${hrStr(hr)}`);
    } catch {}
    try { if (u32.GetDpiForWindow) parts.push(`dpi=${u32.GetDpiForWindow(hwnd)}`); } catch {}
    try {
      if (u32.GetWindowRgnBox) {
        const r = Buffer.alloc(16);
        const t = u32.GetWindowRgnBox(hwnd, r);
        parts.push(t === 0 ? "rgn=none" : `rgn=type${t}[${rectStr(r)}]`);
      }
    } catch {}
    return `${name} native: ${parts.join(" ")}`;
  }

  // z-order 遮挡探针：aot=true 只说明进 topmost band，不代表 band 内最顶。
  // 沿 GW_HWNDPREV 向上枚举盖在该窗口之上且与其相交的可见窗口（含本 app 的
  // hit 窗口——透明面被驱动当成不透明 plane 时同样会挡）。
  // 隐私：只记 class/pid/rect，不记窗口标题——日志会被报告者公开上传。
  function zOrderAbove(hwnd, known) {
    if (!u32 || !u32.GetWindow || !u32.GetWindowRect) return "zAbove: unavail";
    try {
      const my = Buffer.alloc(16);
      if (!u32.GetWindowRect(hwnd, my)) return "zAbove: rect-err";
      const mL = my.readInt32LE(0);
      const mT = my.readInt32LE(4);
      const mR = my.readInt32LE(8);
      const mB = my.readInt32LE(12);
      const rows = [];
      let scanned = 0;
      let cur = hwnd;
      for (let i = 0; i < 512 && rows.length < 8; i++) {
        cur = u32.GetWindow(cur, 3 /* GW_HWNDPREV */);
        if (!cur) break;
        scanned += 1;
        let visible = false;
        try { visible = !!(isWindowVisibleNative && isWindowVisibleNative(cur)); } catch {}
        if (!visible) continue;
        const r = Buffer.alloc(16);
        if (!u32.GetWindowRect(cur, r)) continue;
        const L = r.readInt32LE(0);
        const T = r.readInt32LE(4);
        const R = r.readInt32LE(8);
        const B = r.readInt32LE(12);
        if (Math.max(mL, L) >= Math.min(mR, R) || Math.max(mT, T) >= Math.min(mB, B)) continue;
        let addr = null;
        try { addr = koffi.address(cur); } catch {}
        const label = addr != null && known ? known.get(String(addr)) : null;
        const pid = [0];
        try { if (u32.GetWindowThreadProcessId) u32.GetWindowThreadProcessId(cur, pid); } catch {}
        const cloak = readCloaked(cur);
        rows.push(`${label ? `[${label}]` : ""}0x${addr != null ? addr.toString(16) : "?"} pid=${pid[0] === process.pid ? "me" : pid[0]} class="${classNameOf(cur)}" rect=[${L},${T} ${R - L}x${B - T}] cloak=${cloak.flag}`);
      }
      return rows.length
        ? `zAbove(${scanned} scanned): ${rows.join(" | ")}`
        : `zAbove: none intersecting (${scanned} scanned)`;
    } catch (err) {
      return `zAbove: err ${err && err.message}`;
    }
  }

  function displaySnapshot() {
    if (!screen || typeof screen.getAllDisplays !== "function") return "";
    try {
      const ds = screen.getAllDisplays().map((d) => {
        const b = d.bounds || {};
        const w = d.workArea || {};
        return `#${d.id}{b:${b.x},${b.y} ${b.width}x${b.height} wa:${w.x},${w.y} ${w.width}x${w.height} sf:${d.scaleFactor}}`;
      });
      return `displays=${ds.join(" ")}`;
    } catch (err) {
      return `displays:err ${err && err.message}`;
    }
  }

  // DOM 状态探针：executeJavaScript 在页面里自含运行（只读 DOM，不碰
  // renderer.js 内部状态）。回答"角色元素还在不在视口里、有没有被 CSS 藏掉"。
  const DOM_PROBE_JS = `(() => {
  try {
    const out = { vis: document.visibilityState, vw: innerWidth, vh: innerHeight, els: [] };
    const clip = document.getElementById("pet-clip");
    out.clip = clip ? (getComputedStyle(clip).clipPath || "none") : "missing";
    const cont = document.getElementById("pet-container");
    out.cont = cont ? getComputedStyle(cont).display : "missing";
    const els = document.querySelectorAll("object, img.clawd-img");
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const src = String(el.getAttribute("data") || el.getAttribute("src") || "").split("/").pop().split("?")[0];
      out.els.push({
        tag: el.tagName.toLowerCase(),
        src: src,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        inView: r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        natural: el.naturalWidth ? (el.naturalWidth + "x" + el.naturalHeight) : "n/a"
      });
    }
    return JSON.stringify(out);
  } catch (e) { return "err:" + (e && e.message); }
})()`;

  let lastDomReportAt = 0;
  function domReport(reason, force) {
    const now = Date.now();
    if (!force && now - lastDomReportAt < 2500) return;
    lastDomReportAt = now;
    for (const entry of getWindows()) {
      if (!entry || entry.name !== "render") continue;
      const win = entry.win;
      if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) continue;
      try {
        win.webContents.executeJavaScript(DOM_PROBE_JS)
          .then((res) => log(`domProbe (${reason}): ${res}`))
          .catch((err) => log(`domProbe (${reason}) failed: ${err && err.message}`));
      } catch (err) {
        log(`domProbe (${reason}) threw: ${err && err.message}`);
      }
    }
  }

  // 页面像素 ground truth：capturePage 读回 Chromium 合成器输出，位于
  // DWM/MPO 之【前】——跟屏幕截图（会被 MPO 弄黑）不是一个东西。
  // capture 有像素+屏幕没有 → 输出链路（DWM/DComp/MPO）；没像素 → 页面/
  // renderer 上游；有像素但 bbox 贴边越界 → 布局（viewportOffsetY 一类）。
  let lastCaptureAt = 0;
  function capturePetPixels(reason, force) {
    const now = Date.now();
    if (!force && now - lastCaptureAt < 5000) return;
    lastCaptureAt = now;
    for (const entry of getWindows()) {
      if (!entry || entry.name !== "render") continue;
      const win = entry.win;
      if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) continue;
      try {
        win.webContents.capturePage()
          .then((img) => {
            try {
              const size = img.getSize();
              const buf = img.getBitmap(); // BGRA，alpha 在 i+3
              let n = 0;
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -1;
              let maxY = -1;
              const w = size.width || 1;
              for (let i = 3; i < buf.length; i += 4) {
                if (buf[i] === 0) continue;
                n += 1;
                const p = (i - 3) >> 2;
                const x = p % w;
                const y = (p / w) | 0;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
              const bbox = n ? `[${minX},${minY} ${maxX - minX + 1}x${maxY - minY + 1}]` : "none";
              log(`pageCapture render (${reason}): size=${size.width}x${size.height} alphaPixels=${n} alphaBBox=${bbox}`);
            } catch (err) {
              log(`pageCapture decode error: ${err && err.message}`);
            }
          })
          .catch((err) => log(`pageCapture (${reason}) failed: ${err && err.message}`));
      } catch (err) {
        log(`pageCapture (${reason}) threw: ${err && err.message}`);
      }
    }
  }

  // 内部记账本 + 快捷键注册状态——每次完整快照都带上，直接检验
  // "petHidden 与窗口真实可见性是否一致"。
  function contextLine() {
    const parts = [];
    if (getPetState) {
      try {
        const s = getPetState() || {};
        parts.push(`petHidden=${s.petHidden} miniTransitioning=${s.miniTransitioning}`);
      } catch (err) {
        parts.push(`petState:err ${err && err.message}`);
      }
    }
    if (getShortcutStatus) {
      try { parts.push(String(getShortcutStatus())); }
      catch (err) { parts.push(`shortcut:err ${err && err.message}`); }
    }
    if (getGpuStatus) {
      try { parts.push(String(getGpuStatus())); }
      catch (err) { parts.push(`gpu:err ${err && err.message}`); }
    }
    // viewportOffsetY：drag-position 钳负 Y 产生的补偿量；过大=角色可能被
    // 推出透明窗口外（virtualBounds 是钳制前的虚拟坐标，与 bounds 对照）。
    if (getViewportState) {
      try {
        const v = getViewportState() || {};
        const vb = v.virtualBounds || {};
        parts.push(`viewportOffsetY=${v.viewportOffsetY} virtualBounds=[${vb.x},${vb.y} ${vb.width}x${vb.height}]`);
      } catch (err) {
        parts.push(`viewport:err ${err && err.message}`);
      }
    }
    if (u32 && u32.GetSystemMetrics) {
      try { parts.push(`remoteSession=${u32.GetSystemMetrics(0x1000 /* SM_REMOTESESSION */) ? 1 : 0}`); } catch {}
    }
    return parts.join(" | ");
  }

  // flag/visible 变化、窗口事件、电源、显示器事件时 dump 两窗口 + 状态 +
  // display + native 细节 + z-order；并触发（节流的）DOM/像素探针。
  function dumpFull(reason) {
    log(`--- snapshot (${reason}) ---`);
    const entries = getWindows();
    const known = new Map();
    for (const entry of entries) {
      log(`  ${winSnapshot(entry && entry.name, entry && entry.win)}`);
    }
    for (const entry of entries) {
      const name = entry && entry.name;
      const win = entry && entry.win;
      if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) continue;
      const hwnd = hwndOf(win);
      if (!hwnd) continue;
      try { known.set(String(koffi.address(hwnd)), name); } catch {}
      log(`  ${nativeDetail(name, hwnd)}`);
    }
    const render = entries.find((e) => e && e.name === "render");
    if (render && render.win && !(typeof render.win.isDestroyed === "function" && render.win.isDestroyed())) {
      const hwnd = hwndOf(render.win);
      if (hwnd) log(`  render ${zOrderAbove(hwnd, known)}`);
    }
    const ctx = contextLine();
    if (ctx) log(`  ${ctx}`);
    const ds = displaySnapshot();
    if (ds) log(`  ${ds}`);
    domReport(reason);
    capturePetPixels(reason);
  }

  // 精简调用栈：跳过本文件帧，取前 4 个外部帧的 文件:行号。
  function callerFrames() {
    try {
      const lines = String(new Error().stack || "").split("\n").slice(1);
      const frames = [];
      for (const line of lines) {
        if (line.includes("win-cloak-diagnostic.js")) continue;
        const m = line.match(/\(?([^\s()]+):(\d+):\d+\)?\s*$/);
        if (!m) continue;
        const segs = m[1].split(/[\\/]/);
        frames.push(`${segs.slice(-2).join("/")}:${m[2]}`);
        if (frames.length >= 4) break;
      }
      return frames.join(" <- ") || "<no-stack>";
    } catch {
      return "<stack-err>";
    }
  }

  function shortValue(v) {
    if (v === undefined) return "undefined";
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  // hookWindowMessage 回调参数在不同 Electron 版本可能是 Buffer 或 number。
  function decodeParam(v) {
    try {
      if (Buffer.isBuffer(v)) return v.length >= 4 ? v.readUInt32LE(0) : v.toString("hex");
      if (typeof v === "number") return v;
      return v == null ? "?" : String(v);
    } catch {
      return "?";
    }
  }

  // 边界打点：wrap petRuntime 的可见性入口。所有外部调用（快捷键/菜单/mac
  // bridge）都经过导出对象，能被截获；runtime 内部闭包互调不经过——真实的
  // 窗口翻转由 win-event / WM_SHOWWINDOW 兜底。
  function instrumentPetRuntime() {
    if (!petRuntime) {
      log("petRuntime not provided; boundary logging off");
      return;
    }
    for (const name of ["setPetHidden", "togglePetVisibility", "bringPetToPrimaryDisplay"]) {
      const orig = petRuntime[name];
      if (typeof orig !== "function") continue;
      runtimePatches.push([name, orig]);
      petRuntime[name] = function diagWrapped(...args) {
        const caller = callerFrames();
        let before = "?";
        try { if (typeof petRuntime.isPetHidden === "function") before = petRuntime.isPetHidden(); } catch {}
        let result;
        try {
          result = orig.apply(this, args);
          return result;
        } finally {
          let after = "?";
          try { if (typeof petRuntime.isPetHidden === "function") after = petRuntime.isPetHidden(); } catch {}
          log(`>>> ${name}(${args.map(shortValue).join(",")}) petHidden ${before} -> ${after} result=${shortValue(result)} caller: ${caller}`);
        }
      };
    }
    log(`petRuntime instrumented: ${runtimePatches.map(([n]) => n).join(", ") || "<none>"}`);
  }

  function restorePetRuntime() {
    for (const [name, orig] of runtimePatches) {
      try { petRuntime[name] = orig; } catch {}
    }
    runtimePatches.length = 0;
  }

  // 窗口事件探针 + WM_SHOWWINDOW。tick 里反复调用：WeakSet 防重复，窗口
  // 若被重建也能补挂。
  function ensureWindowProbes() {
    for (const entry of getWindows()) {
      const name = entry && entry.name;
      const win = entry && entry.win;
      if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) continue;
      if (hookedWindows.has(win)) continue;
      hookedWindows.add(win);
      for (const ev of ["show", "hide", "minimize", "restore"]) {
        const h = () => {
          try {
            dumpFull(`win-event ${name}:${ev}`);
            // show 时 dumpFull 里的即时采样赶不上淡入完成，1.8s 后强制补一次
            // ——"show 完成后页面到底有没有像素"是本轮最关键的数据点。
            if (ev === "show" && name === "render") {
              setTimeout(() => {
                try {
                  capturePetPixels("post-show-settled", true);
                  domReport("post-show-settled", true);
                } catch (err) {
                  log(`post-show probe error: ${err && err.message}`);
                }
              }, 1800);
            }
          } catch (err) { log(`win-event handler error: ${err && err.message}`); }
        };
        try {
          win.on(ev, h);
          windowDisposers.push(() => { try { win.removeListener(ev, h); } catch {} });
        } catch (err) {
          log(`win.on(${ev}) failed (${name}): ${err && err.message}`);
        }
      }
      // setOpacity 打点：theme-fade 把整窗淡到 0 后序列若中断，opacity 残留
      // 0——窗口"可见"但全透明。只包一层日志，不改行为；delete 还原原型方法。
      try {
        if (typeof win.setOpacity === "function") {
          const origSetOpacity = win.setOpacity.bind(win);
          win.setOpacity = (value) => {
            try { log(`>>> ${name}.setOpacity(${value}) caller: ${callerFrames()}`); } catch {}
            return origSetOpacity(value);
          };
          windowDisposers.push(() => { try { delete win.setOpacity; } catch {} });
        }
      } catch (err) {
        log(`setOpacity wrap failed (${name}): ${err && err.message}`);
      }
      // 渲染进程死亡：窗口仍"可见"但内容可能再也画不出来——第三轮重点。
      try {
        if (win.webContents && typeof win.webContents.on === "function") {
          const wc = win.webContents;
          const h = (_e, details) => {
            const d = details || {};
            try { dumpFull(`render-process-gone ${name} reason=${d.reason} exitCode=${d.exitCode}`); }
            catch (err) { log(`render-gone handler error: ${err && err.message}`); }
          };
          wc.on("render-process-gone", h);
          windowDisposers.push(() => { try { wc.removeListener("render-process-gone", h); } catch {} });
        }
      } catch (err) {
        log(`render-process-gone hook failed (${name}): ${err && err.message}`);
      }
      try {
        if (typeof win.hookWindowMessage === "function") {
          win.hookWindowMessage(WM_SHOWWINDOW, (wParam, lParam) => {
            try {
              // shown=1 即将显示 / 0 即将隐藏；lParam=0 表示显式 ShowWindow
              // 调用（任何进程），非 0 是父窗口最小化等连带原因。
              dumpFull(`WM_SHOWWINDOW ${name} shown=${decodeParam(wParam)} lParam=${decodeParam(lParam)}`);
            } catch (err) {
              log(`WM_SHOWWINDOW handler error: ${err && err.message}`);
            }
          });
          windowDisposers.push(() => { try { win.unhookWindowMessage(WM_SHOWWINDOW); } catch {} });
          log(`WM_SHOWWINDOW hooked (${name})`);
        } else {
          log(`hookWindowMessage unavailable (${name})`);
        }
      } catch (err) {
        log(`hookWindowMessage failed (${name}): ${err && err.message}`);
      }
    }
  }

  function tick() {
    try {
      ticks += 1;
      ensureWindowProbes();
      const heartbeat = ticks % HEARTBEAT_EVERY === 0;
      for (const entry of getWindows()) {
        const name = entry && entry.name;
        const win = entry && entry.win;
        if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) continue;
        const hwnd = hwndOf(win);
        if (!hwnd) { if (heartbeat) log(`${name}: no hwnd`); continue; }
        const { flag } = readCloaked(hwnd);
        const prev = lastFlag.get(name);
        const flagChanged = flag !== prev;
        if (flagChanged) {
          lastFlag.set(name, flag);
          dumpFull(`${name} flag ${prev} -> ${flag}`);
          // 默认只读；仅在显式 opt-in 时对 APP(1) 试 uncloak（会改窗口状态）。
          if (flag === 1 && UNCLOAK_OPT_IN) {
            const setHr = tryUncloak(hwnd);
            const after = readCloaked(hwnd);
            log(`  [MUTATE] ${name}: APP uncloak -> setHr=${hrStr(setHr)}, flag now=${after.flag} (hr=${hrStr(after.hr)})`);
          }
        }
        // 轮询级兜底：事件探针若有遗漏，visible 翻转也会触发完整快照。
        const vis = typeof win.isVisible === "function" ? win.isVisible() : null;
        const prevVis = lastVisible.get(name);
        if (prevVis !== undefined && vis !== prevVis) {
          lastVisible.set(name, vis);
          dumpFull(`${name} visible ${prevVis} -> ${vis} (poll)`);
        } else {
          lastVisible.set(name, vis);
        }
        if (!flagChanged && heartbeat) {
          log(winSnapshot(name, win));
        }
      }
      if (heartbeat) {
        const ctx = contextLine();
        if (ctx) log(ctx);
      }
    } catch (err) {
      log(`tick error: ${err && err.message}`);
    }
  }

  function onPowerEvent(ev) {
    try { log(`*** powerMonitor:${ev} ***`); dumpFull(`power:${ev}`); }
    catch (err) { log(`power handler error: ${err && err.message}`); }
  }
  function onScreenEvent(ev) {
    try { log(`*** screen:${ev} ***`); dumpFull(`screen:${ev}`); }
    catch (err) { log(`screen handler error: ${err && err.message}`); }
  }

  return {
    start() {
      log(`=== start poll=${POLL_MS}ms ptrSize=${ptrSize} uncloak=${UNCLOAK_OPT_IN ? "on" : "off"} nativeVis=${isWindowVisibleNative ? "on" : "off"} vdesk=${vdeskCheck ? "on" : "off"} native=${u32 ? "on" : "off"} ===`);
      // 一次性 GPU 能力摘要：directComposition/supportsOverlays 直接回答
      // "这台机器的呈现链路长什么样"。10s 超时防 GPU 进程坏死时挂起。
      if (getGpuInfo) {
        try {
          Promise.race([
            Promise.resolve(getGpuInfo()),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 10s")), 10000)),
          ]).then((info) => {
            try {
              const aux = (info && info.auxAttributes) || {};
              const devices = ((info && info.gpuDevice) || []).map(
                (d) => `${d.vendorId}:${d.deviceId}${d.active ? "*" : ""}`
              );
              log(`gpuInfo: directComposition=${aux.directComposition} supportsOverlays=${aux.supportsOverlays} softwareRendering=${aux.softwareRendering} glRenderer=${JSON.stringify(aux.glRenderer || "?")} devices=[${devices.join(" ")}]`);
            } catch (err) {
              log(`gpuInfo parse error: ${err && err.message}`);
            }
          }).catch((err) => log(`gpuInfo failed: ${err && err.message}`));
        } catch (err) {
          log(`gpuInfo threw: ${err && err.message}`);
        }
      }
      try { instrumentPetRuntime(); } catch (err) { log(`instrument error: ${err && err.message}`); }
      try { ensureWindowProbes(); } catch (err) { log(`window probe error: ${err && err.message}`); }
      try { dumpFull("startup"); } catch (err) { log(`startup dump error: ${err && err.message}`); }
      // 启动 5s 后（首帧/淡入已稳定）强制补一次页面像素+DOM 采样。
      setTimeout(() => {
        try {
          capturePetPixels("startup-settled", true);
          domReport("startup-settled", true);
        } catch (err) {
          log(`startup-settled probe error: ${err && err.message}`);
        }
      }, 5000);
      if (powerMonitor && typeof powerMonitor.on === "function") {
        for (const ev of ["suspend", "resume", "lock-screen", "unlock-screen"]) {
          const h = () => onPowerEvent(ev);
          powerListeners.push([ev, h]);
          powerMonitor.on(ev, h);
        }
      }
      if (screen && typeof screen.on === "function") {
        for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) {
          const h = () => onScreenEvent(ev);
          screenListeners.push([ev, h]);
          screen.on(ev, h);
        }
      }
      // GPU/utility 等子进程死亡——GPU 进程重启后合成可能悄悄降级或丢内容。
      if (app && typeof app.on === "function") {
        const h = (_e, details) => {
          const d = details || {};
          try {
            log(`*** child-process-gone type=${d.type} reason=${d.reason} exitCode=${d.exitCode} name=${d.name || ""} ***`);
            if (d.type === "GPU") dumpFull("child-process-gone GPU");
          } catch (err) {
            log(`child-gone handler error: ${err && err.message}`);
          }
        };
        appListeners.push(["child-process-gone", h]);
        app.on("child-process-gone", h);
      }
      timer = setInterval(tick, POLL_MS);
      tick();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (powerMonitor && typeof powerMonitor.removeListener === "function") {
        for (const [ev, h] of powerListeners) powerMonitor.removeListener(ev, h);
      }
      if (screen && typeof screen.removeListener === "function") {
        for (const [ev, h] of screenListeners) screen.removeListener(ev, h);
      }
      if (app && typeof app.removeListener === "function") {
        for (const [ev, h] of appListeners) app.removeListener(ev, h);
      }
      powerListeners.length = 0;
      screenListeners.length = 0;
      appListeners.length = 0;
      while (windowDisposers.length) {
        const dispose = windowDisposers.pop();
        try { dispose(); } catch {}
      }
      try { restorePetRuntime(); } catch {}
      if (vdeskRelease) {
        vdeskRelease();
        vdeskRelease = null;
        vdeskCheck = null;
      }
      log("=== stop ===");
    },
  };
}

module.exports = { createCloakDiagnostic };
