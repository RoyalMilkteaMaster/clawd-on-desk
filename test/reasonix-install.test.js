const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  MARKER,
  REASONIX_HOOK_EVENTS,
  registerReasonixHooks,
  unregisterReasonixHooks,
  __test,
} = require("../hooks/reasonix-install");
const { decodeWindowsEncodedCommand } = require("../hooks/json-utils");

const tempDirs = [];

function makeTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-reasonix-home-"));
  tempDirs.push(home);
  fs.mkdirSync(path.join(home, ".reasonix"), { recursive: true });
  return home;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("Reasonix hook installer", () => {
  it("resolves the current Reasonix home on Windows", () => {
    const appData = "C:\\Users\\Alice\\AppData\\Roaming";
    const userHomeDir = "C:\\Users\\Alice";

    assert.strictEqual(
      __test.resolveReasonixHome({ platform: "win32", env: { APPDATA: appData }, userHomeDir }),
      path.join(appData, "reasonix")
    );
    assert.strictEqual(
      __test.resolveReasonixHome({ platform: "win32", env: {}, userHomeDir }),
      path.join(userHomeDir, "AppData", "Roaming", "reasonix")
    );
    assert.strictEqual(
      __test.resolveReasonixHome({ platform: "win32", env: { REASONIX_HOME: "~/portable-reasonix" }, userHomeDir }),
      path.resolve(userHomeDir, "portable-reasonix")
    );
  });

  it("installs into the Windows Reasonix home under APPDATA", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-reasonix-appdata-"));
    tempDirs.push(root);
    const appData = path.join(root, "Roaming");
    const reasonixHome = path.join(appData, "reasonix");
    fs.mkdirSync(reasonixHome, { recursive: true });

    const result = registerReasonixHooks({
      silent: true,
      platform: "win32",
      env: { APPDATA: appData },
      userHomeDir: path.join(root, "Home"),
      nodeBin: "C:\\Program Files\\nodejs\\node.exe",
      powerShellBin: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    });

    assert.strictEqual(result.added, REASONIX_HOOK_EVENTS.length);
    assert.ok(fs.existsSync(path.join(reasonixHome, "settings.json")));
    assert.ok(!fs.existsSync(path.join(root, "Home", ".reasonix", "settings.json")));
  });

  it("installs all hook events with reasonix-hook.js marker", () => {
    const homeDir = makeTempHome();
    const result = registerReasonixHooks({
      silent: true,
      homeDir,
      nodeBin: "/usr/local/bin/node",
    });

    assert.strictEqual(result.added, REASONIX_HOOK_EVENTS.length);
    assert.strictEqual(result.skipped, 0);

    const settings = readJson(path.join(homeDir, ".reasonix", "settings.json"));
    for (const event of REASONIX_HOOK_EVENTS) {
      assert.ok(Array.isArray(settings.hooks[event]), `missing ${event}`);
      assert.strictEqual(settings.hooks[event].length, 1);
      // On Windows the command is a PowerShell -EncodedCommand, so the marker
      // lives inside the base64 payload — decode before asserting it's present.
      const cmd = settings.hooks[event][0].command;
      const decoded = decodeWindowsEncodedCommand(cmd);
      assert.ok((decoded || cmd).includes(MARKER), `${event} command should reference ${MARKER}`);
    }
  });

  it("is idempotent on second run", () => {
    const homeDir = makeTempHome();
    registerReasonixHooks({ silent: true, homeDir, nodeBin: "/usr/local/bin/node" });

    const result = registerReasonixHooks({ silent: true, homeDir, nodeBin: "/usr/local/bin/node" });

    assert.strictEqual(result.added, 0);
    assert.strictEqual(result.skipped, REASONIX_HOOK_EVENTS.length);
  });

  it("uses PowerShell EncodedCommand on Windows even when paths have no spaces", () => {
    // cmd /c corrupts a quoted first token: `cmd /c "node" "script"` becomes
    // `node" "script` after cmd strips the leading/trailing quote. So even a
    // space-free node path must go through the encoded wrapper on Windows.
    const nodeBin = "C:\\nodejs\\node.exe";
    const scriptPath = "C:/hooks/reasonix-hook.js";
    const command = __test.buildReasonixHookCommand(
      nodeBin,
      scriptPath,
      { platform: "win32", powerShellBin: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" }
    );

    assert.ok(command.includes("-EncodedCommand"), "should use encoded wrapper on Windows even without spaces");
    const decoded = decodeWindowsEncodedCommand(command);
    assert.ok(decoded.includes(nodeBin), "encoded command should contain the node path");
    assert.ok(decoded.includes(scriptPath), "encoded command should contain the script path");
  });

  it("uses PowerShell EncodedCommand on Windows when node path has spaces", () => {
    const nodeBin = "C:\\Program Files\\nodejs\\node.exe";
    const scriptPath = "D:/clawd/Clawd on Desk/resources/hooks/reasonix-hook.js";
    const command = __test.buildReasonixHookCommand(
      nodeBin,
      scriptPath,
      { platform: "win32", powerShellBin: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" }
    );

    assert.ok(
      command.includes("-EncodedCommand"),
      "should use PowerShell encoded wrapper when node path has spaces"
    );
    assert.ok(command.startsWith("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"));

    const decoded = decodeWindowsEncodedCommand(command);
    assert.ok(decoded.includes(nodeBin), "encoded command should contain the absolute node path");
    assert.ok(decoded.includes(scriptPath), "encoded command should contain the script path");
    assert.ok(decoded.includes(MARKER), "encoded command should contain the marker");
  });

  it("uses PowerShell EncodedCommand on Windows when script path has spaces", () => {
    const nodeBin = "C:\\nodejs\\node.exe";
    const scriptPath = "D:/Clawd on Desk/hooks/reasonix-hook.js";
    const command = __test.buildReasonixHookCommand(
      nodeBin,
      scriptPath,
      { platform: "win32", powerShellBin: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" }
    );

    // node has no spaces but the script path does. Under a quoted form
    // (`cmd /c "node" "D:/Clawd on Desk/..."`) cmd corrupts the command, so the
    // encoded wrapper is required here too — not just when node itself has spaces.
    assert.ok(
      command.includes("-EncodedCommand"),
      "should use encoded wrapper when script path has spaces"
    );
    const decoded = decodeWindowsEncodedCommand(command);
    assert.ok(decoded.includes(scriptPath), "encoded command should contain the script path");
    assert.ok(decoded.includes(MARKER), "encoded command should contain the marker");
  });

  it("emits a plain quoted command on non-Windows platforms", () => {
    const command = __test.buildReasonixHookCommand(
      "/usr/local/bin/node",
      "/home/u/clawd/hooks/reasonix-hook.js",
      { platform: "linux" }
    );

    assert.ok(!command.includes("-EncodedCommand"), "POSIX should not use encoded wrapper");
    assert.ok(command.includes("/usr/local/bin/node"));
    assert.ok(command.includes("reasonix-hook.js"));
  });

  // --- Windows encoded-command migration / idempotency (codex review, PR #503) ---
  const WIN_ENCODED_OPTS = {
    platform: "win32",
    powerShellBin: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  };

  it("rewrites a legacy bare-quoted Windows command into EncodedCommand form", () => {
    const homeDir = makeTempHome();
    const settingsPath = path.join(homeDir, ".reasonix", "settings.json");
    // A pre-fix install left a bare quoted command that Reasonix's cmd /c can't run.
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Stop: [{ match: "*", command: '"C:\\Program Files\\nodejs\\node.exe" "C:/clawd/hooks/reasonix-hook.js"' }],
      },
    }));

    const result = registerReasonixHooks({
      silent: true, homeDir,
      nodeBin: "C:\\Program Files\\nodejs\\node.exe",
      ...WIN_ENCODED_OPTS,
    });

    assert.ok(result.updated >= 1, "legacy bare command must be rewritten, not left as-is");
    const stop = readJson(settingsPath).hooks.Stop;
    assert.strictEqual(stop.length, 1, "should rewrite in place, not append a duplicate");
    assert.match(stop[0].command, /-EncodedCommand /);
    assert.ok(decodeWindowsEncodedCommand(stop[0].command).includes(MARKER));
  });

  it("is idempotent across runs with encoded Windows commands", () => {
    const homeDir = makeTempHome();
    const opts = { silent: true, homeDir, nodeBin: "C:\\Program Files\\nodejs\\node.exe", ...WIN_ENCODED_OPTS };
    registerReasonixHooks(opts);
    const result = registerReasonixHooks(opts);

    assert.strictEqual(result.added, 0);
    assert.strictEqual(result.skipped, REASONIX_HOOK_EVENTS.length, "encoded marker must match on re-run");
  });

  it("dedupes duplicate Clawd entries within an event", () => {
    const homeDir = makeTempHome();
    const settingsPath = path.join(homeDir, ".reasonix", "settings.json");
    const dup = '"node" "C:/clawd/hooks/reasonix-hook.js"';
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { Stop: [{ match: "*", command: dup }, { match: "*", command: dup }] },
    }));

    registerReasonixHooks({ silent: true, homeDir, nodeBin: "node", ...WIN_ENCODED_OPTS });

    assert.strictEqual(readJson(settingsPath).hooks.Stop.length, 1, "duplicate Clawd entries must collapse to one");
  });

  it("preserves a user's own hook entry when registering", () => {
    const homeDir = makeTempHome();
    const settingsPath = path.join(homeDir, ".reasonix", "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { Stop: [{ match: "*", command: "echo my-own-hook" }] },
    }));

    registerReasonixHooks({ silent: true, homeDir, nodeBin: "node", ...WIN_ENCODED_OPTS });

    const commands = readJson(settingsPath).hooks.Stop.map((e) => e.command);
    assert.ok(commands.includes("echo my-own-hook"), "user hook must be preserved");
    assert.ok(
      commands.some((c) => (decodeWindowsEncodedCommand(c) || c).includes(MARKER)),
      "Clawd hook should be added alongside the user hook"
    );
  });

  it("uninstall removes only Clawd entries", () => {
    const homeDir = makeTempHome();
    const settingsPath = path.join(homeDir, ".reasonix", "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Stop: [
          { match: "*", command: "echo user-hook" },
        ],
      },
    }));

    registerReasonixHooks({ silent: true, homeDir, nodeBin: "/usr/local/bin/node" });

    const result = unregisterReasonixHooks({ silent: true, homeDir });

    assert.ok(result.removed > 0);
    const settings = readJson(settingsPath);
    assert.strictEqual(settings.hooks.Stop.length, 1);
    assert.strictEqual(settings.hooks.Stop[0].command, "echo user-hook");
  });
});
