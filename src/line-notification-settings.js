"use strict";

const fsDefault = require("fs");
const pathDefault = require("path");

const DEFAULT_LINE_NOTIFICATIONS = Object.freeze({
  enabled: false,
  userId: "",
  notifyOnComplete: true,
  notifyOnAttention: true,
});

const LINE_USER_ID_RE = /^U[0-9a-f]{32}$/i;
const TOKEN_RE = /^\S{20,2048}$/;

function cloneDefaultLineNotifications() {
  return { ...DEFAULT_LINE_NOTIFICATIONS };
}

function normalizeLineNotifications(value) {
  const next = cloneDefaultLineNotifications();
  if (!value || typeof value !== "object") return next;
  next.enabled = value.enabled === true;
  next.userId = typeof value.userId === "string" ? value.userId.trim() : "";
  next.notifyOnComplete = value.notifyOnComplete !== false;
  next.notifyOnAttention = value.notifyOnAttention !== false;
  return next;
}

function validateLineNotifications(value) {
  const next = normalizeLineNotifications(value);
  if (next.userId && !LINE_USER_ID_RE.test(next.userId)) {
    return { status: "error", message: "LINE user ID must start with U followed by 32 hexadecimal characters" };
  }
  return { status: "ok" };
}

function validateChannelAccessToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!TOKEN_RE.test(token)) {
    return { status: "error", message: "LINE channel access token is missing or invalid" };
  }
  return { status: "ok", token };
}

function tokenFilePath(userDataDir, path = pathDefault) {
  return path.join(userDataDir, "line-notifications-token");
}

function readTokenFile(filePath, fs = fsDefault) {
  try {
    const token = String(fs.readFileSync(filePath, "utf8") || "").trim();
    return TOKEN_RE.test(token) ? token : "";
  } catch {
    return "";
  }
}

function writeTokenFile(filePath, value, { fs = fsDefault, path = pathDefault } = {}) {
  const valid = validateChannelAccessToken(value);
  if (valid.status !== "ok") return valid;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${valid.token}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: err && err.message ? err.message : "Could not save LINE token" };
  }
}

function maskToken(token) {
  const value = typeof token === "string" ? token.trim() : "";
  if (!value) return "";
  if (value.length <= 10) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function readiness(config, token) {
  const next = normalizeLineNotifications(config);
  if (!next.enabled) return { ready: false, reason: "disabled", config: next };
  if (!LINE_USER_ID_RE.test(next.userId)) return { ready: false, reason: "missing-user-id", config: next };
  if (!TOKEN_RE.test(String(token || "").trim())) return { ready: false, reason: "missing-token", config: next };
  return { ready: true, config: next };
}

module.exports = {
  DEFAULT_LINE_NOTIFICATIONS,
  LINE_USER_ID_RE,
  TOKEN_RE,
  cloneDefaultLineNotifications,
  normalizeLineNotifications,
  validateLineNotifications,
  validateChannelAccessToken,
  tokenFilePath,
  readTokenFile,
  writeTokenFile,
  maskToken,
  readiness,
};
