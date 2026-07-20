"use strict";

(function initSettingsTabDiscordBot(root) {
  let state = null;
  let helpers = null;
  let ops = null;

  const view = {
    pending: false,
    tokenInfo: { loaded: false, loading: false, configured: false, masked: "" },
    styleInfo: { loaded: false, loading: false, value: null },
    activeTextarea: null,
  };

  function t(key) { return helpers.t(key); }

  function currentConfig() {
    const value = state.snapshot && state.snapshot.discordBot;
    return {
      enabled: !!(value && value.enabled),
      channelId: value && typeof value.channelId === "string" ? value.channelId : "",
      notifyOnComplete: !value || value.notifyOnComplete !== false,
    };
  }

  function rerender() { ops.requestRender({ content: true }); }

  function cloneStyle(value) {
    return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : null;
  }

  function runCommand(action, payload) {
    if (!window.settingsAPI || typeof window.settingsAPI.command !== "function") {
      return Promise.resolve({ status: "error", message: "settings API unavailable" });
    }
    return window.settingsAPI.command(action, payload);
  }

  function loadTokenInfo(force = false) {
    if (view.tokenInfo.loading || (view.tokenInfo.loaded && !force)) return;
    view.tokenInfo.loading = true;
    runCommand("discordBot.tokenInfo").then((result) => {
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

  function loadStyle(force = false) {
    if (view.styleInfo.loading || (view.styleInfo.loaded && !force)) return;
    view.styleInfo.loading = true;
    runCommand("discordBot.style.get").then((result) => {
      view.styleInfo = {
        loaded: true,
        loading: false,
        value: result && result.status === "ok" ? cloneStyle(result.style) : null,
      };
      rerender();
    }).catch(() => {
      view.styleInfo = { loaded: true, loading: false, value: null };
      rerender();
    });
  }

  function saveConfig(next) {
    if (view.pending) return;
    view.pending = true;
    rerender();
    window.settingsAPI.update("discordBot", next).then((result) => {
      view.pending = false;
      if (!result || result.status !== "ok") {
        ops.showToast((result && result.message) || t("toastSaveFailed"), { error: true });
      } else {
        ops.showToast(t("discordBotSaved"));
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

  function buildTokenRow() {
    const descKey = view.tokenInfo.configured
      ? "discordBotTokenConfiguredDesc"
      : "discordBotTokenDesc";
    return inputRow("discordBotTokenLabel", descKey, {
      type: "password",
      placeholderKey: "discordBotTokenPlaceholder",
      buttonKey: "discordBotSaveToken",
      onSave(value) {
        const token = String(value || "").trim();
        if (!token) {
          ops.showToast(t("discordBotTokenRequired"), { error: true });
          return;
        }
        view.pending = true;
        rerender();
        runCommand("discordBot.setToken", { token }).then((result) => {
          view.pending = false;
          if (!result || result.status !== "ok") {
            ops.showToast((result && result.message) || t("discordBotTokenSaveFailed"), { error: true });
          } else {
            ops.showToast(t("discordBotTokenSaved"));
            view.tokenInfo.loaded = false;
            loadTokenInfo(true);
          }
          rerender();
        }).catch((err) => {
          view.pending = false;
          ops.showToast((err && err.message) || t("discordBotTokenSaveFailed"), { error: true });
          rerender();
        });
      },
    });
  }

  function buildChannelRow() {
    const cfg = currentConfig();
    return inputRow("discordBotChannelIdLabel", "discordBotChannelIdDesc", {
      value: cfg.channelId,
      placeholderKey: "discordBotChannelIdPlaceholder",
      buttonKey: "discordBotSaveChannelId",
      onSave(value) {
        saveConfig({ ...cfg, channelId: String(value || "").trim() });
      },
    });
  }

  function buildTestRow() {
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(textBlock("discordBotTestLabel", "discordBotTestDesc"));
    const control = document.createElement("div");
    control.className = "row-control";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "soft-btn accent";
    button.textContent = t("discordBotSendTest");
    button.disabled = view.pending;
    button.addEventListener("click", () => {
      view.pending = true;
      rerender();
      runCommand("discordBot.test").then((result) => {
        view.pending = false;
        if (!result || result.status !== "ok") {
          ops.showToast((result && result.message) || t("discordBotTestFailed"), { error: true });
        } else {
          ops.showToast(t("discordBotTestSent"));
        }
        rerender();
      }).catch((err) => {
        view.pending = false;
        ops.showToast((err && err.message) || t("discordBotTestFailed"), { error: true });
        rerender();
      });
    });
    control.appendChild(button);
    row.appendChild(control);
    return row;
  }

  function ensureStyleDraft() {
    const style = view.styleInfo.value;
    if (!style || typeof style !== "object") return null;
    if (!style.templates || typeof style.templates !== "object") style.templates = {};
    if (!Array.isArray(style.templates.complete)) style.templates.complete = [""];
    for (const key of ["interrupted", "permission", "choice"]) {
      if (typeof style.templates[key] !== "string") style.templates[key] = "";
    }
    if (typeof style.nickname !== "string") style.nickname = "";
    if (typeof style.accountName !== "string") style.accountName = "Clawd";
    return style;
  }

  function renderPreview(template) {
    return String(template || "").replace(/\{(nickname|accountName|owner|task|result|project|agent|session)\}/g, (_match, key) => ({
      nickname: ensureStyleDraft() ? ensureStyleDraft().nickname : "",
      accountName: "Clawd",
      owner: "@owner",
      task: t("discordBotPreviewTask"),
      result: t("discordBotPreviewResult"),
      project: t("discordBotPreviewProject"),
      agent: "Codex",
      session: "12345678",
    })[key] || "");
  }

  function refreshPreview(textarea) {
    if (!view.previewElement || !textarea) return;
    view.previewElement.textContent = renderPreview(textarea.value);
  }

  function insertVariable(textarea, token) {
    const value = String(textarea.value || "");
    const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : value.length;
    const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
    textarea.value = `${value.slice(0, start)}${token}${value.slice(end)}`;
    textarea.selectionStart = textarea.selectionEnd = start + token.length;
    const inputEvent = typeof Event === "function"
      ? new Event("input", { bubbles: true })
      : { type: "input", bubbles: true };
    textarea.dispatchEvent(inputEvent);
    if (typeof textarea.focus === "function") textarea.focus();
  }

  function buildVariableBar(textarea) {
    const bar = document.createElement("div");
    bar.className = "discord-style-variable-bar";
    const label = document.createElement("span");
    label.className = "discord-style-variable-label";
    label.textContent = t("discordBotInsertValue");
    bar.appendChild(label);
    for (const [key, token] of [
      ["discordBotVariableOwner", "{owner}"],
      ["discordBotVariableTask", "{task}"],
      ["discordBotVariableProject", "{project}"],
      ["discordBotVariableAgent", "{agent}"],
      ["discordBotVariableSession", "{session}"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "discord-style-variable soft-btn";
      button.textContent = t(key);
      button.dataset.templateVariable = token;
      button.disabled = view.pending;
      button.addEventListener("click", () => insertVariable(textarea, token));
      bar.appendChild(button);
    }
    return bar;
  }

  function buildReplyTextarea(value, labelKey, onInput, className = "") {
    const textarea = document.createElement("textarea");
    textarea.className = `discord-style-textarea${className ? ` ${className}` : ""}`;
    textarea.value = value;
    textarea.rows = 5;
    textarea.maxLength = 1800;
    textarea.disabled = view.pending;
    textarea.setAttribute("aria-label", t(labelKey));
    textarea.addEventListener("focus", () => {
      view.activeTextarea = textarea;
      refreshPreview(textarea);
    });
    textarea.addEventListener("input", () => {
      onInput(textarea.value);
      view.activeTextarea = textarea;
      refreshPreview(textarea);
    });
    return textarea;
  }

  function buildSingleReply(style, key, labelKey, descKey) {
    const block = document.createElement("div");
    block.className = "discord-style-reply-block";
    block.appendChild(textBlock(labelKey, descKey));
    const textarea = buildReplyTextarea(style.templates[key], labelKey, (value) => {
      style.templates[key] = value;
    }, `discord-style-${key}-textarea`);
    block.append(textarea, buildVariableBar(textarea));
    return block;
  }

  function validateStyleDraft(style) {
    if (!style.templates.complete.length) return t("discordBotAtLeastOneReply");
    const replies = [
      ...style.templates.complete,
      style.templates.interrupted,
      style.templates.permission,
      style.templates.choice,
    ];
    return replies.some((reply) => !String(reply || "").trim())
      ? t("discordBotEmptyReply")
      : "";
  }

  function saveStyle(style) {
    const error = validateStyleDraft(style);
    if (error) {
      ops.showToast(error, { error: true });
      return;
    }
    view.pending = true;
    rerender();
    runCommand("discordBot.style.save", cloneStyle(style)).then((result) => {
      view.pending = false;
      if (!result || result.status !== "ok") {
        ops.showToast((result && result.message) || t("discordBotRepliesSaveFailed"), { error: true });
      } else {
        view.styleInfo.value = cloneStyle(result.style || style);
        ops.showToast(t("discordBotRepliesSaved"));
      }
      rerender();
    }).catch((err) => {
      view.pending = false;
      ops.showToast((err && err.message) || t("discordBotRepliesSaveFailed"), { error: true });
      rerender();
    });
  }

  function resetStyle() {
    if (!window.confirm(t("discordBotResetRepliesConfirm"))) return;
    view.pending = true;
    rerender();
    runCommand("discordBot.style.reset").then((result) => {
      view.pending = false;
      if (!result || result.status !== "ok") {
        ops.showToast((result && result.message) || t("discordBotRepliesSaveFailed"), { error: true });
      } else {
        view.styleInfo.value = cloneStyle(result.style);
        ops.showToast(t("discordBotRepliesReset"));
      }
      rerender();
    }).catch((err) => {
      view.pending = false;
      ops.showToast((err && err.message) || t("discordBotRepliesSaveFailed"), { error: true });
      rerender();
    });
  }

  function buildStyleEditorRow() {
    const row = document.createElement("div");
    row.className = "row discord-style-editor-row";
    const style = ensureStyleDraft();
    if (!style) {
      const message = document.createElement("span");
      message.className = "row-desc";
      message.textContent = view.styleInfo.loading
        ? t("discordBotRepliesLoading")
        : t("discordBotRepliesLoadFailed");
      row.appendChild(message);
      return row;
    }

    const nicknameBlock = document.createElement("div");
    nicknameBlock.className = "discord-style-reply-block";
    nicknameBlock.appendChild(textBlock("discordBotNicknameLabel", "discordBotNicknameDesc"));
    const nickname = document.createElement("input");
    nickname.type = "text";
    nickname.className = "tg-approval-input discord-style-nickname-input";
    nickname.value = style.nickname;
    nickname.maxLength = 80;
    nickname.placeholder = t("discordBotNicknamePlaceholder");
    nickname.disabled = view.pending;
    nickname.addEventListener("input", () => { style.nickname = nickname.value; });
    nicknameBlock.appendChild(nickname);
    row.appendChild(nicknameBlock);

    const completeBlock = document.createElement("div");
    completeBlock.className = "discord-style-reply-block discord-style-complete-block";
    completeBlock.appendChild(textBlock("discordBotCompleteRepliesLabel", "discordBotCompleteRepliesDesc"));
    const list = document.createElement("div");
    list.className = "discord-style-complete-list";
    style.templates.complete.forEach((reply, index) => {
      const card = document.createElement("div");
      card.className = "discord-style-complete-card";
      const header = document.createElement("div");
      header.className = "discord-style-card-header";
      const number = document.createElement("span");
      number.className = "discord-style-card-number";
      number.textContent = `${t("discordBotReplyLabel")} ${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "soft-btn discord-style-remove-reply";
      remove.textContent = t("discordBotDeleteReply");
      remove.disabled = view.pending || style.templates.complete.length <= 1;
      remove.addEventListener("click", () => {
        if (style.templates.complete.length <= 1) {
          ops.showToast(t("discordBotAtLeastOneReply"), { error: true });
          return;
        }
        style.templates.complete.splice(index, 1);
        rerender();
      });
      header.append(number, remove);
      const textarea = buildReplyTextarea(reply, "discordBotCompleteRepliesLabel", (value) => {
        style.templates.complete[index] = value;
      }, "discord-style-complete-textarea");
      card.append(header, textarea, buildVariableBar(textarea));
      list.appendChild(card);
    });
    completeBlock.appendChild(list);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "soft-btn accent discord-style-add-reply";
    add.textContent = t("discordBotAddReply");
    add.disabled = view.pending || style.templates.complete.length >= 20;
    add.addEventListener("click", () => {
      if (style.templates.complete.length >= 20) return;
      style.templates.complete.push("");
      rerender();
    });
    completeBlock.appendChild(add);
    row.appendChild(completeBlock);

    row.appendChild(buildSingleReply(style, "interrupted", "discordBotInterruptedReplyLabel", "discordBotInterruptedReplyDesc"));
    row.appendChild(buildSingleReply(style, "permission", "discordBotPermissionReplyLabel", "discordBotPermissionReplyDesc"));
    row.appendChild(buildSingleReply(style, "choice", "discordBotChoiceReplyLabel", "discordBotChoiceReplyDesc"));

    const previewBlock = document.createElement("div");
    previewBlock.className = "discord-style-preview-block";
    const previewLabel = document.createElement("span");
    previewLabel.className = "row-label";
    previewLabel.textContent = t("discordBotPreviewLabel");
    const preview = document.createElement("pre");
    preview.className = "discord-style-preview";
    preview.textContent = renderPreview(style.templates.complete[0]);
    view.previewElement = preview;
    previewBlock.append(previewLabel, preview);
    row.appendChild(previewBlock);

    const actions = document.createElement("div");
    actions.className = "discord-style-actions";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "soft-btn";
    reset.textContent = t("discordBotResetReplies");
    reset.disabled = view.pending;
    reset.addEventListener("click", resetStyle);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "soft-btn accent discord-style-save";
    save.textContent = t("discordBotSaveReplies");
    save.disabled = view.pending;
    save.addEventListener("click", () => saveStyle(style));
    actions.append(reset, save);
    row.appendChild(actions);
    return row;
  }

  function renderDiscordBot(parent) {
    loadTokenInfo();
    const cfg = currentConfig();
    const ready = view.tokenInfo.configured && /^\d{17,20}$/.test(cfg.channelId);
    const title = document.createElement("h1");
    title.textContent = t("discordBotTitle");
    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("discordBotSubtitle");
    parent.append(title, subtitle);
    parent.appendChild(helpers.buildSection(t("discordBotSetupTitle"), [
      buildTokenRow(),
      buildChannelRow(),
      buildTestRow(),
    ]));
    parent.appendChild(helpers.buildSection(t("discordBotControlTitle"), [
      switchRow(
        "discordBotEnableLabel",
        ready ? "discordBotEnableDesc" : "discordBotEnableNeedsSetup",
        cfg.enabled,
        (enabled) => saveConfig({ ...cfg, enabled }),
        !cfg.enabled && !ready
      ),
      switchRow(
        "discordBotCompleteLabel",
        "discordBotCompleteDesc",
        cfg.notifyOnComplete,
        (notifyOnComplete) => saveConfig({ ...cfg, notifyOnComplete }),
        !cfg.enabled
      ),
    ]));
  }

  function renderNotificationReplies(parent) {
    loadStyle();
    const title = document.createElement("h1");
    title.textContent = t("notificationRepliesTitle");
    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("notificationRepliesSubtitle");
    parent.append(title, subtitle);
    parent.appendChild(helpers.buildSection(t("discordBotRepliesTitle"), [
      buildStyleEditorRow(),
    ]));
  }

  function init(core) {
    state = core.state;
    helpers = core.helpers;
    ops = core.ops;
    core.tabs["discord-bot"] = { render: renderDiscordBot };
    core.tabs["notification-replies"] = { render: renderNotificationReplies };
  }

  root.ClawdSettingsTabDiscordBot = { init };
})(globalThis);
