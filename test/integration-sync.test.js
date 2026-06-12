"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createIntegrationSyncRuntime } = require("../src/integration-sync");

function makeRuntime(overrides = {}) {
  const calls = [];
  const repairOptions = [];
  const ctx = {
    autoStartWithClaude: true,
    syncClawdHooksImpl: (options) => {
      calls.push({ name: "claude", options });
      return { status: "ok", source: "claude" };
    },
    syncGeminiHooksImpl: () => calls.push({ name: "gemini" }),
    syncAntigravityHooksImpl: () => calls.push({ name: "antigravity" }),
    syncCursorHooksImpl: () => calls.push({ name: "cursor" }),
    syncCopilotHooksImpl: () => calls.push({ name: "copilot" }),
    syncCodeBuddyHooksImpl: () => calls.push({ name: "codebuddy" }),
    syncKiroHooksImpl: () => calls.push({ name: "kiro" }),
    syncKimiHooksImpl: () => calls.push({ name: "kimi" }),
    syncQwenHooksImpl: () => calls.push({ name: "qwen" }),
    syncCodexHooksImpl: () => calls.push({ name: "codex" }),
    repairCodexHooksImpl: (options) => {
      calls.push({ name: "codex-repair" });
      repairOptions.push(options);
      return { status: "ok", message: "done" };
    },
    syncOpencodePluginImpl: () => calls.push({ name: "opencode" }),
    syncPiExtensionImpl: () => calls.push({ name: "pi" }),
    syncOpenClawPluginImpl: () => calls.push({ name: "openclaw" }),
    repairOpenClawPluginImpl: () => {
      calls.push({ name: "openclaw-repair" });
      return { status: "ok", message: "done" };
    },
    syncHermesPluginImpl: () => calls.push({ name: "hermes" }),
    syncQoderHooksImpl: () => calls.push({ name: "qoder" }),
    ...(overrides.ctx || {}),
  };
  const runtime = createIntegrationSyncRuntime({
    ctx,
    getHookServerPort: () => 24444,
    shouldManageClaudeHooks: () => true,
    isAgentEnabled: () => true,
    startClaudeSettingsWatcher: () => calls.push({ name: "watcher:start" }),
    stopClaudeSettingsWatcher: () => {
      calls.push({ name: "watcher:stop" });
      return "stopped";
    },
    ...overrides,
  });
  return { runtime, calls, repairOptions };
}

describe("integration sync runtime", () => {
  it("syncClawdHooks passes auto-start and the current server port", () => {
    const { runtime, calls } = makeRuntime();

    const result = runtime.syncClawdHooks();

    assert.deepStrictEqual(result, { status: "ok", source: "claude" });
    assert.deepStrictEqual(calls, [
      { name: "claude", options: { autoStart: true, port: 24444 } },
    ]);
  });

  it("startup syncs enabled integrations in the server order and starts the Claude watcher after Claude sync", () => {
    const disabled = new Set(["cursor-agent", "opencode"]);
    const { runtime, calls } = makeRuntime({
      isAgentEnabled: (agentId) => !disabled.has(agentId),
    });

    runtime.syncEnabledStartupIntegrations();

    assert.deepStrictEqual(calls.map((entry) => entry.name), [
      "claude",
      "watcher:start",
      "gemini",
      "antigravity",
      "copilot",
      "codebuddy",
      "kiro",
      "kimi",
      "qwen",
      "codex",
      "pi",
      "openclaw",
      "hermes",
      "qoder",
    ]);
  });

  it("startup sync uses installed-and-enabled intent instead of enabled alone", () => {
    const uninstalled = new Set(["claude-code", "copilot-cli", "pi"]);
    const { runtime, calls } = makeRuntime({
      isAgentEnabled: () => true,
      shouldSyncAgentIntegration: (agentId) => !uninstalled.has(agentId),
    });

    runtime.syncEnabledStartupIntegrations();

    assert.deepStrictEqual(calls.map((entry) => entry.name), [
      "gemini",
      "antigravity",
      "cursor",
      "codebuddy",
      "kiro",
      "kimi",
      "qwen",
      "codex",
      "opencode",
      "openclaw",
      "hermes",
      "qoder",
    ]);
  });

  it("syncIntegrationForAgent respects Claude management gate", () => {
    const { runtime, calls } = makeRuntime({
      shouldManageClaudeHooks: () => false,
    });

    assert.strictEqual(runtime.syncIntegrationForAgent("claude-code"), false);
    assert.deepStrictEqual(calls, []);
  });

  it("syncIntegrationForAgent starts the Claude watcher after a managed Claude sync", () => {
    const { runtime, calls } = makeRuntime();

    const result = runtime.syncIntegrationForAgent("claude-code");

    assert.deepStrictEqual(result, { status: "ok", source: "claude" });
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["claude", "watcher:start"]);
  });

  it("syncIntegrationForAgent('copilot-cli') invokes the Copilot syncer", () => {
    const { runtime, calls } = makeRuntime();

    const result = runtime.syncIntegrationForAgent("copilot-cli");

    assert.ok(result === true || (result && typeof result === "object"));
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["copilot"]);
  });

  it("uninstallIntegrationForAgent routes through the matching marker-scoped cleaner", () => {
    const uninstallCalls = [];
    const { runtime } = makeRuntime({
      ctx: {
        uninstallIntegrationImpls: {
          "copilot-cli": (options) => {
            uninstallCalls.push({ name: "copilot-uninstall", options });
            return { removed: 0, changed: false };
          },
        },
      },
    });

    const result = runtime.uninstallIntegrationForAgent("copilot-cli");

    assert.deepStrictEqual(result, { removed: 0, changed: false });
    assert.deepStrictEqual(uninstallCalls, [{ name: "copilot-uninstall", options: { silent: true } }]);
  });

  it("uninstallIntegrationForAgent passes Codex cleanup markers on the real fallback path", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-codex-cleanup-"));
    try {
      const hooksPath = path.join(homeDir, ".codex", "hooks.json");
      fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
      fs.writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: '"/node" "/app/hooks/codex-hook.js" SessionStart' }] },
            { hooks: [{ type: "command", command: '"/node" "/other/user-hook.js" SessionStart' }] },
          ],
        },
      }, null, 2), "utf8");
      const { runtime } = makeRuntime({
        ctx: { cleanupHomeDir: homeDir },
      });

      const result = runtime.uninstallIntegrationForAgent("codex");
      const next = JSON.parse(fs.readFileSync(hooksPath, "utf8"));

      assert.deepStrictEqual(
        { removed: result.removed, changed: result.changed },
        { removed: 1, changed: true }
      );
      assert.strictEqual(next.hooks.SessionStart.length, 1);
      assert.ok(next.hooks.SessionStart[0].hooks[0].command.includes("user-hook.js"));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("repairIntegrationForAgent('copilot-cli') routes through syncCopilotHooks (no separate repair)", () => {
    const { runtime, calls } = makeRuntime();

    const result = runtime.repairIntegrationForAgent("copilot-cli");

    assert.ok(result === true || (result && typeof result === "object"));
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["copilot"]);
  });

  it("repairIntegrationForAgent uses Codex repair and passes options through", () => {
    const { runtime, calls, repairOptions } = makeRuntime();

    const result = runtime.repairIntegrationForAgent("codex", { forceCodexHooksFeature: true });

    assert.deepStrictEqual(result, { status: "ok", message: "done" });
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["codex-repair"]);
    assert.deepStrictEqual(repairOptions, [{ forceCodexHooksFeature: true }]);
  });

  it("repairIntegrationForAgent uses OpenClaw repair", () => {
    const { runtime, calls } = makeRuntime();

    const result = runtime.repairIntegrationForAgent("openclaw");

    assert.deepStrictEqual(result, { status: "ok", message: "done" });
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["openclaw-repair"]);
  });

  it("stopIntegrationForAgent only stops the Claude watcher", () => {
    const { runtime, calls } = makeRuntime();

    assert.strictEqual(runtime.stopIntegrationForAgent("codex"), false);
    assert.strictEqual(runtime.stopIntegrationForAgent("claude-code"), "stopped");
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["watcher:stop"]);
  });

  it("does not log Pi extension sync when the managed files are already current", () => {
    const piInstall = require("../hooks/pi-install");
    const originalRegister = piInstall.registerPiExtension;
    const originalLog = console.log;
    const logs = [];
    piInstall.registerPiExtension = () => ({
      installed: true,
      skipped: false,
      updated: false,
      extensionDir: "C:/Users/Tester/.pi/agent/extensions/clawd-on-desk",
    });
    console.log = (message) => logs.push(message);

    try {
      const { runtime } = makeRuntime({ ctx: { syncPiExtensionImpl: undefined } });
      const result = runtime.syncPiExtension();

      assert.strictEqual(result.status, "ok");
      assert.strictEqual(result.installed, true);
      assert.deepStrictEqual(logs, []);
    } finally {
      piInstall.registerPiExtension = originalRegister;
      console.log = originalLog;
    }
  });
});
