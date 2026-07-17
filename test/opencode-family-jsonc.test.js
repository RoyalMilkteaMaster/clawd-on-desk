"use strict";

// JSONC install matrix for opencode-family members with jsonc: true (today:
// mimocode). Exercises the REAL thin installer (hooks/mimocode-install.js →
// makeFamilyInstaller → opencode-family-jsonc.js) against real temp files —
// the plan §4.1 contract: element-level edits that PRESERVE user comments and
// trailing commas, JSON-branch-identical return shapes, unregister removes
// ALL exact matches (high index → low), and corrupt input never gets
// clobbered.

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");

const {
  registerMimocodePlugin,
  unregisterMimocodePlugin,
  DEFAULT_CONFIG_PATH,
} = require("../hooks/mimocode-install");

const INSTALLER_PATH = path.join(__dirname, "..", "hooks", "mimocode-install.js");
const PLUGIN_DIR = "/abs/hooks/mimocode-plugin";

function tmpConfig(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-mimocode-jsonc-"));
  const configPath = path.join(dir, "mimocode.jsonc");
  if (text !== undefined) fs.writeFileSync(configPath, text);
  return { dir, configPath };
}

function parseJsonc(text) {
  // eslint-disable-next-line global-require
  const { parse } = require("jsonc-parser");
  const errors = [];
  const tree = parse(text, errors, { allowTrailingComma: true });
  assert.deepStrictEqual(errors, [], "fixture/output must stay valid JSONC");
  return tree;
}

describe("mimocode JSONC installer — register", () => {
  it("creates mimocode.jsonc when no candidate exists, stamped with MiMo's own $schema", () => {
    const { configPath } = tmpConfig(undefined);
    const res = registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.deepStrictEqual(res, { added: true, skipped: false, created: true, configPath, pluginDir: PLUGIN_DIR });
    const text = fs.readFileSync(configPath, "utf8");
    const tree = parseJsonc(text);
    // MiMo v0.1.6 stamps this URL itself (config.ts:564-566) and rewrites
    // opencode.ai's URL when it finds one — write what the host would write.
    assert.deepStrictEqual(tree, {
      $schema: "https://mimo.xiaomi.com/mimocode/config.json",
      plugin: [PLUGIN_DIR],
    });
    assert.ok(!text.includes("opencode.ai"), "mimocode must not be given opencode's $schema");
  });

  it("appends while PRESERVING comments and trailing commas", () => {
    const original = [
      "{",
      "  // my provider notes",
      '  "model": "mimo/base", /* inline note */',
      '  "plugin": [',
      '    "@vendor/some-plugin",',
      "  ], // keep this array",
      "}",
    ].join("\n");
    const { configPath } = tmpConfig(original);
    const res = registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.added, true);
    assert.strictEqual(res.created, false);
    const text = fs.readFileSync(configPath, "utf8");
    for (const comment of ["// my provider notes", "/* inline note */", "// keep this array"]) {
      assert.ok(text.includes(comment), `comment lost: ${comment}`);
    }
    assert.deepStrictEqual(parseJsonc(text).plugin, ["@vendor/some-plugin", PLUGIN_DIR]);
  });

  it("is idempotent — second register is byte-identical and reports skipped", () => {
    const { configPath } = tmpConfig('{\n  // note\n  "plugin": [],\n}');
    registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    const afterFirst = fs.readFileSync(configPath, "utf8");
    const res = registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.deepStrictEqual(res, { added: false, skipped: true, created: false, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(fs.readFileSync(configPath, "utf8"), afterFirst, "skipped register must not rewrite the file");
  });

  it("updates a stale absolute path in place (basename match), keeping comments", () => {
    const { configPath } = tmpConfig('{\n  // stale install\n  "plugin": ["/old/place/hooks/mimocode-plugin"],\n}');
    const res = registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.added, true);
    const text = fs.readFileSync(configPath, "utf8");
    assert.ok(text.includes("// stale install"));
    assert.deepStrictEqual(parseJsonc(text).plugin, [PLUGIN_DIR]);
  });

  it("never stomps scoped npm specifiers ending in mimocode-plugin", () => {
    const { configPath } = tmpConfig('{\n  "plugin": ["@vendor/mimocode-plugin"],\n}');
    registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(configPath, "utf8")).plugin, [
      "@vendor/mimocode-plugin",
      PLUGIN_DIR,
    ]);
  });

  it("adds the plugin property when missing, preserving sibling keys and comments", () => {
    const { configPath } = tmpConfig('{\n  // just a model\n  "model": "mimo/base",\n}');
    const res = registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.added, true);
    const text = fs.readFileSync(configPath, "utf8");
    assert.ok(text.includes("// just a model"));
    assert.deepStrictEqual(parseJsonc(text), { model: "mimo/base", plugin: [PLUGIN_DIR] });
  });

  it("replaces a non-array plugin value", () => {
    const { configPath } = tmpConfig('{\n  "plugin": "not-an-array",\n}');
    registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(configPath, "utf8")).plugin, [PLUGIN_DIR]);
  });

  it("throws (and does not clobber) on genuinely corrupt JSONC", () => {
    const original = '{\n  "plugin": [\n';
    const { configPath } = tmpConfig(original);
    assert.throws(
      () => registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR }),
      /Failed to read/
    );
    assert.strictEqual(fs.readFileSync(configPath, "utf8"), original, "corrupt config must be left untouched");
  });
});

describe("mimocode JSONC installer — unregister", () => {
  it("removes ALL exact matches (high index → low), keeping comments and other entries", () => {
    const original = [
      "{",
      "  // header",
      '  "plugin": [',
      "    // third-party, keep me",
      '    "@vendor/other",',
      `    "${PLUGIN_DIR}",`,
      `    "${PLUGIN_DIR}",`,
      `    "${PLUGIN_DIR}",`,
      "  ],",
      "}",
    ].join("\n");
    const { configPath } = tmpConfig(original);
    const res = unregisterMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.removed, 3);
    assert.strictEqual(res.changed, true);
    assert.strictEqual(res.skipped, false);
    const text = fs.readFileSync(configPath, "utf8");
    assert.ok(text.includes("// header"));
    assert.ok(text.includes("// third-party, keep me"), "comments not adjacent-after a removed element must survive");
    assert.deepStrictEqual(parseJsonc(text).plugin, ["@vendor/other"]);
  });

  it("preserves trivia FOLLOWING a removed element — span surgery, not modify() (R8 P2)", () => {
    // jsonc-parser's own removal would swallow both comments below; the
    // module's span surgery removes only the element token + one comma.
    const { configPath } = tmpConfig([
      "{",
      '  "plugin": [',
      `    "${PLUGIN_DIR}",`,
      "    // note below the removed entry",
      '    "@vendor/other", // boundary comment',
      "  ],",
      "}",
    ].join("\n"));
    const res = unregisterMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.removed, 1);
    const text = fs.readFileSync(configPath, "utf8");
    assert.ok(text.includes("// note below the removed entry"), "full-line comment after removed element must survive");
    assert.ok(text.includes("// boundary comment"), "same-line trailing comment must survive");
    assert.deepStrictEqual(parseJsonc(text).plugin, ["@vendor/other"]);
  });

  it("preserves file mode across register and unregister (0600 secrets stay 0600, R8 P1)", (t) => {
    if (process.platform === "win32") return t.skip("posix file modes");
    const { configPath } = tmpConfig(`{\n  // token inside\n  "plugin": ["${PLUGIN_DIR}", "@vendor/keep"],\n}`);
    fs.chmodSync(configPath, 0o600);

    unregisterMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(fs.statSync(configPath).mode & 0o777, 0o600, "unregister must not widen permissions");

    registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(fs.statSync(configPath).mode & 0o777, 0o600, "register must not widen permissions");
  });

  it("sweeps a MASKED stale path in a lower-priority file (R8 P1 scenario)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-mimocode-stale-"));
    const jsoncPath = path.join(dir, "mimocode.jsonc");
    const jsonPath = path.join(dir, "mimocode.json");
    fs.writeFileSync(jsoncPath, `{\n  "plugin": ["${PLUGIN_DIR}"],\n}`);
    fs.writeFileSync(jsonPath, '{\n  "plugin": ["/old/install/hooks/mimocode-plugin"]\n}');
    const res = unregisterMimocodePlugin({ silent: true, configPath: jsoncPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.removed, 2, "current entry + masked stale path");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin, []);
  });

  it("removes stale absolute paths by basename — ownership matches register (R8 P1)", () => {
    // Register treats an absolute path ending in mimocode-plugin as a stale
    // Clawd install; unregister must apply the SAME rule or the stale entry
    // survives the sweep and can resurrect from a lower-priority file.
    const { configPath } = tmpConfig(`{\n  "plugin": ["/elsewhere/hooks/mimocode-plugin"],\n}`);
    const res = unregisterMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.removed, 1);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(configPath, "utf8")).plugin, []);
  });

  it("never removes npm package specifiers, even scoped ones ending in mimocode-plugin", () => {
    const { configPath } = tmpConfig(`{\n  "plugin": ["@vendor/mimocode-plugin", "mimocode-plugin"],\n}`);
    const res = unregisterMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.removed, 0);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(configPath, "utf8")).plugin, ["@vendor/mimocode-plugin", "mimocode-plugin"]);
  });

  it("tolerates ENOENT and a missing plugin array", () => {
    const missing = tmpConfig(undefined);
    assert.deepStrictEqual(
      unregisterMimocodePlugin({ silent: true, configPath: missing.configPath, pluginDir: PLUGIN_DIR }),
      { removed: 0, changed: false, skipped: true, configPath: missing.configPath, pluginDir: PLUGIN_DIR }
    );
    const noArray = tmpConfig('{\n  // nothing here\n  "model": "mimo/base",\n}');
    const res = unregisterMimocodePlugin({ silent: true, configPath: noArray.configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.removed, 0);
    assert.strictEqual(res.skipped, true);
  });

  it("writes a backup of the PRE-EDIT text when options.backup is set", () => {
    const original = `{\n  // precious\n  "plugin": ["${PLUGIN_DIR}"],\n}`;
    const { configPath } = tmpConfig(original);
    const res = unregisterMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR, backup: true });
    assert.strictEqual(res.removed, 1);
    assert.ok(res.backupPath, "backupPath must be reported when backup: true");
    assert.strictEqual(fs.readFileSync(res.backupPath, "utf8"), original, "backup must hold the pre-edit text");
  });

  it("throws on corrupt JSONC instead of guessing", () => {
    const { configPath } = tmpConfig("{ oops");
    assert.throws(
      () => unregisterMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR }),
      /Failed to read/
    );
  });
});

// MiMo v0.1.6 merges config.json → mimocode.json → mimocode.jsonc (later
// wins; "plugin" arrays are REPLACED, not concatenated). The installer must
// edit the file whose plugin array is effectively live and sweep all
// candidates on unregister (#607 review).
describe("mimocode JSONC installer — merged dual-file semantics", () => {
  function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "clawd-mimocode-merged-"));
  }
  function inDir(dir, name, text) {
    const p = path.join(dir, name);
    if (text !== undefined) fs.writeFileSync(p, text);
    return p;
  }

  it("edits mimocode.json when it is the only file declaring plugin (no .jsonc created)", () => {
    const dir = tmpDir();
    const jsonPath = inDir(dir, "mimocode.json", '{\n  "plugin": ["@vendor/keep"]\n}');
    const configPath = path.join(dir, "mimocode.jsonc"); // create-default, does not exist
    const res = registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.added, true);
    assert.strictEqual(res.created, false);
    assert.strictEqual(res.configPath, jsonPath, "must edit the live plugin owner, not the create-default");
    assert.ok(!fs.existsSync(configPath), "creating .jsonc here would MASK the user's .json plugins");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin, ["@vendor/keep", PLUGIN_DIR]);
  });

  it("edits .jsonc when BOTH declare plugin (priority), leaving .json byte-identical", () => {
    const dir = tmpDir();
    const jsonText = '{\n  "plugin": ["@vendor/in-json"]\n}';
    const jsonPath = inDir(dir, "mimocode.json", jsonText);
    const jsoncPath = inDir(dir, "mimocode.jsonc", '{\n  // live file\n  "plugin": ["@vendor/in-jsonc"],\n}');
    const res = registerMimocodePlugin({ silent: true, configPath: jsoncPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.configPath, jsoncPath);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsoncPath, "utf8")).plugin, ["@vendor/in-jsonc", PLUGIN_DIR]);
    assert.strictEqual(fs.readFileSync(jsonPath, "utf8"), jsonText, ".json must stay untouched");
  });

  it("edits .json when it declares plugin and .jsonc exists WITHOUT plugin", () => {
    const dir = tmpDir();
    const jsonPath = inDir(dir, "mimocode.json", '{\n  "plugin": ["@vendor/live"]\n}');
    const jsoncText = '{\n  // model prefs only\n  "model": "mimo/base",\n}';
    const jsoncPath = inDir(dir, "mimocode.jsonc", jsoncText);
    const res = registerMimocodePlugin({ silent: true, configPath: jsoncPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.configPath, jsonPath, "plugin lives in .json — writing .jsonc would mask it");
    assert.strictEqual(fs.readFileSync(jsoncPath, "utf8"), jsoncText, ".jsonc must stay untouched");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin, ["@vendor/live", PLUGIN_DIR]);
  });

  it("supports the legacy config.json tier as the effective owner", () => {
    const dir = tmpDir();
    const legacyPath = inDir(dir, "config.json", '{\n  "plugin": ["@vendor/legacy"]\n}');
    const configPath = path.join(dir, "mimocode.jsonc");
    const res = registerMimocodePlugin({ silent: true, configPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.configPath, legacyPath);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(legacyPath, "utf8")).plugin, ["@vendor/legacy", PLUGIN_DIR]);
  });

  it("prefers the existing highest-priority file when NO candidate declares plugin", () => {
    const dir = tmpDir();
    inDir(dir, "mimocode.json", '{\n  "model": "mimo/base"\n}');
    const jsoncPath = inDir(dir, "mimocode.jsonc", '{\n  // prefs\n  "theme": "dark",\n}');
    const res = registerMimocodePlugin({ silent: true, configPath: jsoncPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.configPath, jsoncPath);
    const tree = parseJsonc(fs.readFileSync(jsoncPath, "utf8"));
    assert.deepStrictEqual(tree.plugin, [PLUGIN_DIR]);
    assert.strictEqual(tree.theme, "dark");
  });

  it("unregister sweeps managed entries from ALL candidates (masked entries cannot resurrect)", () => {
    const dir = tmpDir();
    const jsoncPath = inDir(dir, "mimocode.jsonc", `{\n  // live\n  "plugin": ["${PLUGIN_DIR}", "@vendor/keep"],\n}`);
    const jsonPath = inDir(dir, "mimocode.json", `{\n  "plugin": ["${PLUGIN_DIR}", "${PLUGIN_DIR}"]\n}`);
    const legacyPath = inDir(dir, "config.json", `{\n  "plugin": ["${PLUGIN_DIR}"]\n}`);
    const res = unregisterMimocodePlugin({ silent: true, configPath: jsoncPath, pluginDir: PLUGIN_DIR, backup: true });
    assert.strictEqual(res.removed, 4, "1 live + 2 masked in .json + 1 masked in config.json");
    assert.strictEqual(res.changed, true);
    assert.strictEqual(res.backupPaths.length, 3, "each changed file gets a backup");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsoncPath, "utf8")).plugin, ["@vendor/keep"]);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin, []);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(legacyPath, "utf8")).plugin, []);
    assert.ok(fs.readFileSync(jsoncPath, "utf8").includes("// live"), "comments survive the sweep");
  });

  it("survives SINGLE-LINE plugin arrays on removal (jsonc-parser 3.3.1 emits corrupt edits there)", () => {
    // Upstream modify() drops a dangling quote when removing elements from a
    // one-line array — the module must fall back to whole-array replacement.
    const dir = tmpDir();
    const jsoncPath = inDir(dir, "mimocode.jsonc", `{\n  "plugin": ["${PLUGIN_DIR}", "@vendor/keep", "${PLUGIN_DIR}"]\n}`);
    const res = unregisterMimocodePlugin({ silent: true, configPath: jsoncPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.removed, 2);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsoncPath, "utf8")).plugin, ["@vendor/keep"]);
  });

  it("refuses to edit when ANY existing candidate is corrupt", () => {
    const dir = tmpDir();
    const jsoncPath = inDir(dir, "mimocode.jsonc", '{\n  "plugin": [],\n}');
    const jsonText = "{ broken";
    const jsonPath = inDir(dir, "mimocode.json", jsonText);
    assert.throws(
      () => registerMimocodePlugin({ silent: true, configPath: jsoncPath, pluginDir: PLUGIN_DIR }),
      /Failed to read/
    );
    assert.strictEqual(fs.readFileSync(jsonPath, "utf8"), jsonText);
  });

  it("tolerates a UTF-8 BOM and CRLF line endings in the target file", () => {
    const dir = tmpDir();
    const bomCrlf = "﻿{\r\n  // windows-authored\r\n  \"plugin\": [\"@vendor/keep\"],\r\n}";
    const jsoncPath = inDir(dir, "mimocode.jsonc", bomCrlf);
    const res = registerMimocodePlugin({ silent: true, configPath: jsoncPath, pluginDir: PLUGIN_DIR });
    assert.strictEqual(res.added, true);
    const text = fs.readFileSync(jsoncPath, "utf8");
    assert.ok(text.includes("// windows-authored"), "CRLF comments must survive");
    assert.deepStrictEqual(parseJsonc(text).plugin, ["@vendor/keep", PLUGIN_DIR]);
  });
});

describe("mimocode installer wrapper surface (plan §5 contract)", () => {
  it("exports the complete legacy surface and family default paths", () => {
    const mod = require("../hooks/mimocode-install");
    for (const key of [
      "DEFAULT_PARENT_DIR",
      "DEFAULT_CONFIG_PATH",
      "registerMimocodePlugin",
      "unregisterMimocodePlugin",
      "resolvePluginDir",
      "__test",
    ]) {
      assert.ok(key in mod, `missing export: ${key}`);
    }
    assert.ok(
      DEFAULT_CONFIG_PATH.replace(/\\/g, "/").endsWith(".config/mimocode/mimocode.jsonc"),
      `unexpected default config path: ${DEFAULT_CONFIG_PATH}`
    );
    assert.ok(mod.resolvePluginDir("/x/hooks").endsWith("/x/hooks/mimocode-plugin"));
  });

  it("register reports the mimocode-not-found reason integration-sync branches on", () => {
    // Same contract pin as the opencode wrapper test: the shared installer
    // emits `${agentId}-not-found`, and integration-sync's mimocode branch
    // must consume exactly "mimocode-not-found". The real skip behavior runs
    // in the CLI polite-skip case below.
    const familySrc = fs.readFileSync(require.resolve("../hooks/opencode-family-install.js"), "utf8");
    assert.match(familySrc, /reason: `\$\{agentId\}-not-found`/);
    const syncSrc = fs.readFileSync(require.resolve("../src/integration-sync.js"), "utf8");
    assert.match(syncSrc, /"mimocode-not-found"/);
  });
});

function spawnCli(args, homeDir) {
  const result = spawnSync(process.execPath, [INSTALLER_PATH, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  });
  return { status: result.status, stdout: `${result.stdout || ""}${result.stderr || ""}` };
}

describe("mimocode installer CLI entry (node hooks/mimocode-install.js)", () => {
  it("registers on default invocation and unregisters with --uninstall", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-mimocode-cli-"));
    const configDir = path.join(homeDir, ".config", "mimocode");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "mimocode.jsonc"), '{\n  // hand config\n  "plugin": [],\n}');

    const reg = spawnCli([], homeDir);
    assert.strictEqual(reg.status, 0, reg.stdout);
    assert.match(reg.stdout, /Clawd mimocode plugin → /);
    assert.match(reg.stdout, /Registered: /);
    const text = fs.readFileSync(path.join(configDir, "mimocode.jsonc"), "utf8");
    assert.ok(text.includes("// hand config"), "CLI register must preserve comments");
    assert.strictEqual(parseJsonc(text).plugin.length, 1);

    const un = spawnCli(["--uninstall"], homeDir);
    assert.strictEqual(un.status, 0, un.stdout);
    assert.match(un.stdout, /Clawd mimocode plugin entries removed: 1/);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(path.join(configDir, "mimocode.jsonc"), "utf8")).plugin, []);
  });

  it("skips politely when mimocode is not installed (exit 0, no config created)", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-mimocode-cli-empty-"));
    const res = spawnCli([], homeDir);
    assert.strictEqual(res.status, 0, res.stdout);
    assert.match(res.stdout, /not found — skipping mimocode plugin registration/);
    assert.ok(!fs.existsSync(path.join(homeDir, ".config", "mimocode", "mimocode.jsonc")));
  });
});
