const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MAIN = path.join(ROOT, "src", "main.js");
const DOCK_ICON = path.join(ROOT, "assets", "dock-icon.png");
const pkg = require("../package.json");

test("macOS runtime dock icon asset is packaged", () => {
  assert.ok(fs.existsSync(DOCK_ICON), "assets/dock-icon.png should exist");
  assert.ok(
    pkg.build.files.includes("assets/dock-icon.png"),
    "build.files should include assets/dock-icon.png"
  );
});

test("macOS runtime dock icon override respects hidden Dock preference", () => {
  const source = fs.readFileSync(MAIN, "utf8");
  const setIcon = 'app.dock.setIcon(path.join(__dirname, "..", "assets", "dock-icon.png"))';
  const guard = 'if (isMac && app.dock && _settingsController.get("showDock") !== false)';
  const setIconIndex = source.indexOf(setIcon);
  const guardIndex = source.lastIndexOf(guard, setIconIndex);

  assert.ok(setIconIndex >= 0, "main.js should set the runtime macOS dock icon");
  assert.ok(guardIndex >= 0, "dock icon override should be guarded by showDock !== false");
  assert.ok(
    setIconIndex - guardIndex < 250,
    "showDock guard should wrap the dock icon override"
  );
});
