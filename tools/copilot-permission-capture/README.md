# Copilot permissionRequest capture — Phase 0 throwaway

> 临时工具，Phase 0 跑完写完 investigation md 后整个目录会删掉。
>
> 目的：在挂正式 hook 前先抓真实 `permissionRequest` stdin payload + 验
> Copilot CLI 对各种 hook stdout/exit code 的实际 fallback 行为。

## 前置

1. 已装 Copilot CLI 并能正常触发权限提示。
2. Clawd 当前 0.6.x：state hook 已经在 `~/.copilot/hooks/hooks.json` 写了
   10 个事件。这里挂的是 **`permissionRequest`** — Clawd 还没注册过，所以
   不会和 Clawd 自己的 entry 冲突。
3. **Clawd 可以正常开着**。auto-sync 用 `copilot-hook.js` marker 识别自己
   的 entry，`capture.js` 名字不撞 marker，不会被覆盖。

## 挂 hook

打开 `~/.copilot/hooks/hooks.json`（在 Windows 上是 `%USERPROFILE%\.copilot\hooks\hooks.json`），
找到 `hooks` 对象，加一条 `permissionRequest`：

```json
{
  "version": 1,
  "hooks": {
    "permissionRequest": [
      {
        "type": "command",
        "bash": "node \"D:/animation/tools/copilot-permission-capture/capture.js\" \"capture\"",
        "powershell": "& node \"D:/animation/tools/copilot-permission-capture/capture.js\" \"capture\"",
        "timeoutSec": 30
      }
    ],
    "sessionStart": [ /* 现有 Clawd entry，别动 */ ]
  }
}
```

切模式时，把 `"capture"` 那两个 arg 换成下面表格里的 mode 名字，重新跑 Copilot 即可。

## 模式表（按优先级排序）

| 优先级 | mode | hook 行为 | 该看 Copilot 怎么反应 |
|---|---|---|---|
| 必跑 | `capture` | append stdin + exit 0 + 空 stdout | Copilot 正常弹出原生权限提示，鹿鹿可以正常完成操作 |
| 必跑 | `exit0-empty` | 空 stdout + exit 0 | 应该和 capture 一样：原生提示，无报错 |
| 必跑 | `exit0-brace` | stdout = `{}` + exit 0 | 应该也走原生提示。对比空 stdout 是否有差异 |
| 推荐 | `exit2` | exit 2 | 文档说会被当 deny，看 Copilot 是直接 reject 还是有别的 UX |
| 选做 | `exit0-unknown` | stdout = `{"behavior":"unknown-probe"}` + exit 0 | 测 Copilot 对未知 behavior 字段是 deny / allow / fallback |
| 选做 | `exit1` | exit 1 | 文档说 fail-open，验证一下 |
| 选做 | `hang` | 永不退出 | Copilot 会在 timeoutSec=30s 后 kill 进程，看后续 UX |

**必跑场景里**至少跑两次 `capture`：
- 一次普通 shell / 文件写权限（会出现的最常见类型）
- 一次 **subagent 触发**的权限请求（如果鹿鹿能想办法触发；不行就跳过）

`capture` 也是抓 payload 的主路径，跑得越多越好，方便 cross-check 字段稳定性。

## 取结果

`capture.js` 把每次调用都 append 到：

- Windows: `%APPDATA%\clawd-on-desk\debug.log`
- 或 `CLAWD_COPILOT_HOOK_DEBUG_PATH` 指定的路径

每行一条 JSON 记录，含：
- `at` — ISO 时间
- `mode` — 这次跑的模式
- `stdinBytes` — stdin 字节数
- `stdinRaw` — stdin 原文（Phase 0 需要的就是这个）
- `cwd` / `env` — 上下文

跑完后把 debug.log 里 `"source":"copilot-permission-capture"` 那些行抓出来贴给我。
**贴之前先扫一眼有没有 token / API key / 私人路径**，有的话脱敏（替换成 `<redacted>`）。

## 跑完清理

1. 把 `permissionRequest` 那条 hook 从 `hooks.json` 里删掉，或者整段删掉。
2. Phase 0 investigation md 写完后，整个 `tools/copilot-permission-capture/`
   目录可以 `rm -rf`。

## 出问题怎么排查

- Copilot 没触发 hook：检查 hooks.json 是不是合法 JSON（漏逗号/引号）。
- hook 跑了但 debug.log 没东西：检查 `%APPDATA%\clawd-on-desk\` 目录权限；
  也可以临时 `set CLAWD_COPILOT_HOOK_DEBUG_PATH=D:\tmp\copilot-capture.log`
  指到一个肯定能写的路径。
- hook 报错：Copilot CLI 文档里说错误会被 log，可以看 Copilot 自己的日志
  确认 node 进程是不是真的起来了。
