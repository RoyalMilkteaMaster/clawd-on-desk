"use strict";

const { dedupeKey, isCompletion } = require("./telegram-companion");
const { pickTemplate, renderTemplate } = require("./line-notification-style");
const MAX_COMPLETION_KEYS = 500;
const RESULT_SUMMARY_MAX = 350;
const EMPTY_RESULT_SUMMARY = "Agent 沒有留下可顯示的成果摘要，請回到電腦查看。";

const TEXT = Object.freeze({
  en: {
    complete: "Task complete",
    interrupted: "Task interrupted",
    attention: "Clawd needs your input",
    permission: "Permission confirmation",
    choice: "Question / choice",
    task: "Task",
    agent: "Agent",
    project: "Project",
    session: "Session",
    returnToComputer: "Please return to your computer to continue.",
  },
  "zh-TW": {
    complete: "任務完成",
    interrupted: "任務中斷",
    attention: "Clawd 正在等待你",
    permission: "權限確認",
    choice: "問題／選擇",
    task: "任務",
    agent: "Agent",
    project: "專案",
    session: "Session",
    returnToComputer: "請回到電腦繼續處理。",
  },
  zh: {
    complete: "任务完成",
    interrupted: "任务中断",
    attention: "Clawd 正在等待你",
    permission: "权限确认",
    choice: "问题／选择",
    task: "任务",
    agent: "Agent",
    project: "项目",
    session: "Session",
    returnToComputer: "请回到电脑继续处理。",
  },
});

function localeFor(lang) {
  return TEXT[lang] || TEXT.en;
}

function folderName(cwd) {
  if (!cwd) return "";
  const parts = String(cwd).replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function shortId(id) {
  const value = String(id || "");
  return value.length > 8 ? value.slice(-8) : value;
}

function identity(entry = {}, taskTitle = "") {
  const project = folderName(entry.cwd);
  return {
    title: taskTitle || entry.displayTitle || entry.sessionTitle || project || (entry.id ? `#${shortId(entry.id)}` : "Clawd"),
    agentId: entry.agentId || "",
    project,
    sessionId: shortId(entry.id),
  };
}

function formatIdentity(lines, value, locale) {
  lines.push(`${locale.task}：${value.title}`);
  if (value.agentId) lines.push(`${locale.agent}：${value.agentId}`);
  if (value.project) lines.push(`${locale.project}：${value.project}`);
  if (value.sessionId) lines.push(`${locale.session}：#${value.sessionId}`);
}

function templateValues(entry, taskTitle, style = {}) {
  const value = identity(entry, taskTitle);
  const nickname = typeof style.nickname === "string" ? style.nickname.trim() : "";
  return {
    ...value,
    nickname,
    accountName: style.accountName || "Clawd",
    owner: nickname ? `${nickname}主~人~♡` : "主~人~♡",
    task: value.title,
    result: summarizeResult(entry && entry.assistantLastOutput),
    agent: value.agentId,
    session: value.sessionId,
  };
}

function summarizeResult(value, maxLength = RESULT_SUMMARY_MAX) {
  if (typeof value !== "string" || !value.trim()) return EMPTY_RESULT_SUMMARY;
  const cleaned = value
    .replace(/```[\s\S]*?```/g, "[程式碼內容已省略]")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return EMPTY_RESULT_SUMMARY;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trimEnd()}…` : cleaned;
}

function formatCompletion(entry, lang, taskTitle = "", style = null, selectedTemplate = "") {
  const interrupted = entry && entry.badge === "interrupted";
  const configured = style && style.templates && style.templates[interrupted ? "interrupted" : "complete"];
  const template = selectedTemplate || pickTemplate(configured);
  if (template) return renderTemplate(template, templateValues(entry, taskTitle, style));
  const locale = localeFor(lang);
  const lines = [interrupted ? locale.interrupted : locale.complete, ""];
  formatIdentity(lines, identity(entry, taskTitle), locale);
  return lines.join("\n");
}

function formatAttention(permission, sessionEntry, lang, taskTitle = "", style = null) {
  const locale = localeFor(lang);
  const entry = sessionEntry || {
    id: permission && permission.sessionId,
    agentId: permission && permission.agentId,
    cwd: permission && permission.cwd,
  };
  const templateKey = permission && permission.isElicitation ? "choice" : "permission";
  const template = style && style.templates && style.templates[templateKey];
  if (template) return renderTemplate(template, templateValues(entry, taskTitle, style));
  const kind = permission && permission.isElicitation ? locale.choice : locale.permission;
  const lines = [locale.attention, "", `${kind}`, ""];
  formatIdentity(lines, identity(entry, taskTitle), locale);
  lines.push("", locale.returnToComputer);
  return lines.join("\n");
}

function permissionKey(permission) {
  if (!permission) return "";
  const stableId = permission.toolUseId
    || permission.familyRequestId
    || permission.toolInputFingerprint
    || permission.permissionGateId;
  return stableId
    ? `${permission.sessionId || ""}:${stableId}`
    : `${permission.sessionId || ""}:${permission.toolName || ""}:${permission.createdAt || ""}`;
}

function isAttentionPermission(permission) {
  return !!permission
    && !permission.isCodexNotify
    && !permission.isKimiNotify;
}

function createNotificationCompanion({
  getClient,
  getConfig,
  getLang = () => "en",
  getTaskTitle = () => "",
  getStyle = () => null,
  transportName = "Notification",
  log = () => {},
} = {}) {
  const completed = new Map();
  const permissions = new Set();
  const sessions = new Map();
  let lastCompleteTemplate = "";
  let primed = false;

  function config() {
    const value = typeof getConfig === "function" ? getConfig() : null;
    return value && typeof value === "object" ? value : {};
  }

  function safeLog(message, meta) {
    try { log("warn", message, meta); } catch {}
  }

  function send(text, meta) {
    const client = typeof getClient === "function" ? getClient() : null;
    if (!client || typeof client.sendNotification !== "function") return;
    Promise.resolve(client.sendNotification(text)).then((result) => {
      if (!result || result.ok !== true) safeLog(`${transportName} notification not delivered`, { ...meta, errorClass: result && result.errorClass });
    }).catch((err) => safeLog(`${transportName} notification threw`, { ...meta, error: err && err.message }));
  }

  function taskTitle(entry) {
    try {
      const value = getTaskTitle(entry);
      return typeof value === "string" ? value.trim() : "";
    } catch {
      return "";
    }
  }

  function style() {
    try {
      const value = getStyle();
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  function rememberCompletion(id, key) {
    completed.delete(id);
    completed.set(id, key);
    while (completed.size > MAX_COMPLETION_KEYS) completed.delete(completed.keys().next().value);
  }

  function onSnapshot(snapshot) {
    const entries = snapshot && Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
    const currentIds = new Set();
    const toSend = [];
    const currentConfig = config();
    const priming = !primed;

    for (const entry of entries) {
      if (!entry || !entry.id) continue;
      currentIds.add(entry.id);
      sessions.set(entry.id, entry);
      if (!isCompletion(entry)) continue;
      const key = dedupeKey(entry);
      if (completed.get(entry.id) === key) continue;
      rememberCompletion(entry.id, key);
      if (
        !priming
        && entry.headless !== true
        && entry.codexSource !== "subagent"
        && currentConfig.enabled === true
        && currentConfig.notifyOnComplete !== false
      ) toSend.push(entry);
    }

    for (const id of Array.from(sessions.keys())) if (!currentIds.has(id)) sessions.delete(id);
    primed = true;

    for (const entry of toSend) {
      const currentStyle = style();
      const configured = currentStyle && currentStyle.templates
        ? currentStyle.templates[entry.badge === "interrupted" ? "interrupted" : "complete"]
        : null;
      const selected = pickTemplate(configured, { previous: lastCompleteTemplate });
      if (entry.badge !== "interrupted" && selected) lastCompleteTemplate = selected;
      send(formatCompletion(entry, getLang(), taskTitle(entry), currentStyle, selected), { kind: "completion", sessionId: entry.id });
    }
  }

  function onPermissionAdded(permission) {
    if (!isAttentionPermission(permission)) return;
    const key = permissionKey(permission);
    if (key && permissions.has(key)) return;
    if (key) permissions.add(key);

    const currentConfig = config();
    if (currentConfig.enabled !== true || currentConfig.notifyOnAttention === false) return;
    const entry = sessions.get(permission.sessionId) || {
      id: permission.sessionId,
      agentId: permission.agentId,
      cwd: permission.cwd,
    };
    send(
      formatAttention(permission, entry, getLang(), taskTitle(entry), style()),
      { kind: "attention", sessionId: permission.sessionId }
    );
  }

  function onPermissionResolved(permission) {
    const key = permissionKey(permission);
    if (key) permissions.delete(key);
  }

  return {
    onSnapshot,
    onPermissionAdded,
    onPermissionResolved,
    _completed: completed,
    _permissions: permissions,
  };
}

function createLineCompanion(options = {}) {
  return createNotificationCompanion({ ...options, transportName: "LINE" });
}

module.exports = {
  createNotificationCompanion,
  createLineCompanion,
  formatCompletion,
  formatAttention,
  summarizeResult,
  permissionKey,
  isAttentionPermission,
};
