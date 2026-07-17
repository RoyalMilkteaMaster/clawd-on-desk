const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SCRIPT_PATH = path.join(__dirname, "..", "scripts", "remote-deploy.sh");
const HOOKS_DIR = path.join(__dirname, "..", "hooks");

function parseDeployedFiles() {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const block = script.match(/FILES=\(\s*\n([\s\S]*?)\n\s*\)/);
  if (!block) throw new Error("FILES=() block not found in remote-deploy.sh");
  const entries = [...block[1].matchAll(/"\$HOOKS_DIR\/([^"]+)"/g)];
  return entries.map((m) => m[1]);
}

function findRelativeRequires(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const matches = [...content.matchAll(/require\(["']\.\/([^"')]+)["']\)/g)];
  return matches.map((m) => (m[1].endsWith(".js") ? m[1] : `${m[1]}.js`));
}

describe("scripts/remote-deploy.sh FILES manifest", () => {
  it("ships every relative require target of every listed file", () => {
    const deployed = parseDeployedFiles();
    assert.ok(deployed.length > 0, "FILES array parsed as empty");
    const deployedSet = new Set(deployed);

    for (const name of deployed) {
      const absPath = path.join(HOOKS_DIR, name);
      assert.ok(fs.existsSync(absPath), `listed file missing: hooks/${name}`);

      const deps = findRelativeRequires(absPath);
      for (const dep of deps) {
        assert.ok(
          deployedSet.has(dep),
          `hooks/${name} requires './${dep.replace(/\.js$/, "")}' but ${dep} is not in scripts/remote-deploy.sh FILES — add it or the remote deploy will ship a broken subset`
        );
      }
    }
  });

  // plan §4.1 guard: remote SSH hosts have NO node_modules, so no file in
  // either manifest may pull a real npm dependency — bare or subpath
  // (`jsonc-parser/lib/...` crashes there just as hard as `jsonc-parser`).
  // The relative-require closure test above cannot see bare requires, so
  // this allowlists Node builtins and rejects everything else (R8 P2).
  it("remote manifests require ONLY Node builtins; the family JSONC editor never ships", () => {
    const { builtinModules } = require("node:module");
    const builtinRoots = new Set(builtinModules.map((name) => name.split("/")[0]));

    const sshSource = fs.readFileSync(path.join(__dirname, "..", "src", "remote-ssh-deploy.js"), "utf8");
    const sshBlock = sshSource.match(/const HOOK_FILES = \[\s*\n([\s\S]*?)\n\];/);
    assert.ok(sshBlock, "HOOK_FILES block not found in remote-ssh-deploy.js");
    const sshFiles = [...sshBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(sshFiles.length > 0, "HOOK_FILES parsed as empty");

    const manifests = new Set([...parseDeployedFiles(), ...sshFiles]);
    for (const name of manifests) {
      assert.notStrictEqual(
        name,
        "opencode-family-jsonc.js",
        "the family JSONC editor must not be deployed to dep-free remote hosts"
      );
      const content = fs.readFileSync(path.join(HOOKS_DIR, name), "utf8");
      assert.ok(
        !content.includes("opencode-family-jsonc"),
        `hooks/${name} must not reference the family JSONC editor`
      );
      for (const match of content.matchAll(/require\(["']([^."'][^"']*)["']\)/g)) {
        const spec = match[1];
        const root = (spec.startsWith("node:") ? spec.slice(5) : spec).split("/")[0];
        assert.ok(
          builtinRoots.has(root),
          `hooks/${name} requires "${spec}" — remote hosts have no node_modules, only Node builtins are deployable`
        );
      }
    }
  });

  it("registers Codex official hooks in remote mode", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");

    assert.match(script, /codex-install\.js/);
    assert.match(script, /remote_node_command codex-install\.js --remote/);
  });

  it("resolves a remote Node binary before registering hooks", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");

    assert.match(script, /REMOTE_NODE_PROBE=/);
    assert.match(script, /CLAWD_REMOTE_NODE_BIN/);
    assert.match(script, /REMOTE_NODE_BIN=/);
    assert.doesNotMatch(script, /ssh "\$SSH_TARGET" "node ~\/\.claude\/hooks\/install\.js --remote"/);
  });
});
