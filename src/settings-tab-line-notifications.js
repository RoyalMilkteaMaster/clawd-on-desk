"use strict";

(function initSettingsTabLineNotifications(root) {
  let state = null;
  let helpers = null;
  let ops = null;

  const view = {
    pending: false,
    tokenInfo: { loaded: false, loading: false, configured: false, masked: "" },
  };

  function t(key) { return helpers.t(key); }

  function currentConfig() {
    const value = state.snapshot && state.snapshot.lineNotifications;
    return {
      enabled: !!(value && value.enabled),
      userId: value && typeof value.userId === "string" ? value.userId : "",
      notifyOnComplete: !value || value.notifyOnComplete !== false,
      notifyOnAttention: !value || value.notifyOnAttention !== false,
    };
  }

  function rerender() { ops.requestRender({ content: true }); }

  function runCommand(action, payload) {
    if (!window.settingsAPI || typeof window.settingsAPI.command !== "function") {
      return Promise.resolve({ status: "error", message: "settings API unavailable" });
    }
    return window.settingsAPI.command(action, payload);
  }

  function loadTokenInfo(force = false) {
    if (view.tokenInfo.loading || (view.tokenInfo.loaded && !force)) return;
    view.tokenInfo.loading = true;
    runCommand("lineNotifications.tokenInfo").then((result) => {
      view.tokenInfo = {
        loaded: true,
        loading: false,
        configured: !!(result && result.configured),
        masked: result && typeof result.masked === "string" ? result.masked : "",
      };
      rerender();
    }).catch(() => {
      view.tokenInfo = { loaded: true, loading: false, configured: false, masked: "" };
      rerender();
    });
  }

  function saveConfig(next, successKey = "lineNotificationsSaved") {
    if (view.pending) return;
    view.pending = true;
    rerender();
    window.settingsAPI.update("lineNotifications", next).then((result) => {
      view.pending = false;
      if (!result || result.status !== "ok") {
        ops.showToast((result && result.message) || t("toastSaveFailed"), { error: true });
      } else {
        ops.showToast(t(successKey));
      }
      rerender();
    }).catch((err) => {
      view.pending = false;
      ops.showToast((err && err.message) || t("toastSaveFailed"), { error: true });
      rerender();
    });
  }

  function textBlock(labelKey, descKey) {
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t(labelKey);
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t(descKey);
    text.append(label, desc);
    return text;
  }

  function switchRow(labelKey, descKey, checked, toggle, disabled = false) {
    const row = document.createElement("div");
    row.className = "row";
    if (disabled) row.classList.add("tg-approval-row-disabled");
    row.appendChild(textBlock(labelKey, descKey));

    const control = document.createElement("div");
    control.className = "row-control";
    const sw = document.createElement("div");
    sw.className = "switch";
    sw.setAttribute("role", "switch");
    sw.setAttribute("tabindex", "0");
    helpers.setSwitchVisual(sw, checked, { pending: view.pending });
    if (disabled || view.pending) {
      sw.classList.add("disabled");
      sw.setAttribute("aria-disabled", "true");
      sw.removeAttribute("tabindex");
    } else {
      const activate = () => toggle(!checked);
      sw.addEventListener("click", activate);
      sw.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          activate();
        }
      });
    }
    control.appendChild(sw);
    row.appendChild(control);
    return row;
  }

  function inputRow(labelKey, descKey, { type = "text", value = "", placeholderKey, buttonKey, onSave }) {
    const row = document.createElement("div");
    row.className = "row tg-approval-token-edit-row";
    row.appendChild(textBlock(labelKey, descKey));

    const control = document.createElement("div");
    control.className = "row-control tg-approval-input-row";
    const input = document.createElement("input");
    input.type = type;
    input.className = "tg-approval-input";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.value = value;
    input.placeholder = t(placeholderKey);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "soft-btn accent";
    button.textContent = t(buttonKey);
    button.disabled = view.pending;
    button.addEventListener("click", () => onSave(input.value));
    control.append(input, button);
    row.appendChild(control);
    return row;
  }

  function buildTokenRow() {
    const descKey = view.tokenInfo.configured
      ? "lineNotificationsTokenConfiguredDesc"
      : "lineNotificationsTokenDesc";
    return inputRow("lineNotificationsTokenLabel", descKey, {
      type: "password",
      placeholderKey: "lineNotificationsTokenPlaceholder",
      buttonKey: "lineNotificationsSaveToken",
      onSave(value) {
        const token = String(value || "").trim();
        if (!token) {
          ops.showToast(t("lineNotificationsTokenRequired"), { error: true });
          return;
        }
        view.pending = true;
        rerender();
        runCommand("lineNotifications.setToken", { token }).then((result) => {
          view.pending = false;
          if (!result || result.status !== "ok") {
            ops.showToast((result && result.message) || t("lineNotificationsTokenSaveFailed"), { error: true });
          } else {
            ops.showToast(t("lineNotificationsTokenSaved"));
            view.tokenInfo.loaded = false;
            loadTokenInfo(true);
          }
          rerender();
        }).catch((err) => {
          view.pending = false;
          ops.showToast((err && err.message) || t("lineNotificationsTokenSaveFailed"), { error: true });
          rerender();
        });
      },
    });
  }

  function buildUserIdRow() {
    const cfg = currentConfig();
    return inputRow("lineNotificationsUserIdLabel", "lineNotificationsUserIdDesc", {
      value: cfg.userId,
      placeholderKey: "lineNotificationsUserIdPlaceholder",
      buttonKey: "lineNotificationsSaveUserId",
      onSave(value) {
        saveConfig({ ...cfg, userId: String(value || "").trim() });
      },
    });
  }

  function buildTestRow() {
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(textBlock("lineNotificationsTestLabel", "lineNotificationsTestDesc"));
    const control = document.createElement("div");
    control.className = "row-control";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "soft-btn accent";
    button.textContent = t("lineNotificationsSendTest");
    button.disabled = view.pending;
    button.addEventListener("click", () => {
      view.pending = true;
      rerender();
      runCommand("lineNotifications.test").then((result) => {
        view.pending = false;
        if (!result || result.status !== "ok") {
          ops.showToast((result && result.message) || t("lineNotificationsTestFailed"), { error: true });
        } else {
          ops.showToast(t("lineNotificationsTestSent"));
        }
        rerender();
      }).catch((err) => {
        view.pending = false;
        ops.showToast((err && err.message) || t("lineNotificationsTestFailed"), { error: true });
        rerender();
      });
    });
    control.appendChild(button);
    row.appendChild(control);
    return row;
  }

  function render(parent) {
    loadTokenInfo();
    const cfg = currentConfig();
    const ready = view.tokenInfo.configured && /^U[0-9a-f]{32}$/i.test(cfg.userId);

    const title = document.createElement("h1");
    title.textContent = t("lineNotificationsTitle");
    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("lineNotificationsSubtitle");
    parent.append(title, subtitle);

    parent.appendChild(helpers.buildSection(t("lineNotificationsSetupTitle"), [
      buildTokenRow(),
      buildUserIdRow(),
      buildTestRow(),
    ]));

    parent.appendChild(helpers.buildSection(t("lineNotificationsControlTitle"), [
      switchRow(
        "lineNotificationsEnableLabel",
        ready ? "lineNotificationsEnableDesc" : "lineNotificationsEnableNeedsSetup",
        cfg.enabled,
        (enabled) => saveConfig({ ...cfg, enabled }),
        !cfg.enabled && !ready
      ),
      switchRow(
        "lineNotificationsCompleteLabel",
        "lineNotificationsCompleteDesc",
        cfg.notifyOnComplete,
        (notifyOnComplete) => saveConfig({ ...cfg, notifyOnComplete }),
        !cfg.enabled
      ),
      switchRow(
        "lineNotificationsAttentionLabel",
        "lineNotificationsAttentionDesc",
        cfg.notifyOnAttention,
        (notifyOnAttention) => saveConfig({ ...cfg, notifyOnAttention }),
        !cfg.enabled
      ),
    ]));
  }

  function init(core) {
    state = core.state;
    helpers = core.helpers;
    ops = core.ops;
    core.tabs["line-notifications"] = { render };
  }

  root.ClawdSettingsTabLineNotifications = { init };
})(globalThis);
