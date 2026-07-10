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
//   • 对照开关：CLAWD_DIAG_DISABLE_GPU=1（或 --diag-disable-gpu，见 main.js
//     ready 前的接入）关硬件加速跑对照——关掉后能看见 → GPU/MPO 合成层；
//     照样看不见 + vdesk=OTHER → 虚拟桌面；两者都排除再看别的。

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
  let isWindowVisibleNative = null;
  try {
    const user32 = koffi.load("user32.dll");
    isWindowVisibleNative = user32.func("int __stdcall IsWindowVisible(void *hwnd)");
  } catch (err) {
    log(`user32 init failed (nativeVis unavailable): ${err && err.message}`);
  }

  // 虚拟桌面归属（第三轮）：IVirtualDesktopManager 是公开 shell COM 接口，
  // 专为外部进程查询设计。koffi 没有 COM 封装，走虚表手动调：*iface 是
  // vtable，槽位 0-2 是 IUnknown，槽位 3 = IsWindowOnCurrentVirtualDesktop。
  // 初始化/调用失败一律降级为 vdesk=unavail，不影响其余探针。
  let vdeskCheck = null;
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
    let bounds = null;
    let b = "?";
    try {
      bounds = win.getBounds();
      b = `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`;
    } catch {}
    const vdesk = vdeskCheck ? vdeskCheck(hwnd) : "vdesk=unavail";
    return `${name}: flag=${flag} hr=${hrStr(hr)} visible=${vis} nativeVis=${nativeVis} min=${minz} aot=${aot} bounds=[${b}] ${coverage(bounds)} ${vdesk}`;
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
    return parts.join(" | ");
  }

  // flag/visible 变化、窗口事件、电源、显示器事件时 dump 两窗口 + 状态 + display
  function dumpFull(reason) {
    log(`--- snapshot (${reason}) ---`);
    for (const entry of getWindows()) {
      log(`  ${winSnapshot(entry && entry.name, entry && entry.win)}`);
    }
    const ctx = contextLine();
    if (ctx) log(`  ${ctx}`);
    const ds = displaySnapshot();
    if (ds) log(`  ${ds}`);
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
          try { dumpFull(`win-event ${name}:${ev}`); }
          catch (err) { log(`win-event handler error: ${err && err.message}`); }
        };
        try {
          win.on(ev, h);
          windowDisposers.push(() => { try { win.removeListener(ev, h); } catch {} });
        } catch (err) {
          log(`win.on(${ev}) failed (${name}): ${err && err.message}`);
        }
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
      log(`=== start poll=${POLL_MS}ms ptrSize=${ptrSize} uncloak=${UNCLOAK_OPT_IN ? "on" : "off"} nativeVis=${isWindowVisibleNative ? "on" : "off"} vdesk=${vdeskCheck ? "on" : "off"} ===`);
      try { instrumentPetRuntime(); } catch (err) { log(`instrument error: ${err && err.message}`); }
      try { ensureWindowProbes(); } catch (err) { log(`window probe error: ${err && err.message}`); }
      try { dumpFull("startup"); } catch (err) { log(`startup dump error: ${err && err.message}`); }
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
      log("=== stop ===");
    },
  };
}

module.exports = { createCloakDiagnostic };
