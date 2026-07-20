"use strict";

const fsDefault = require("fs");
const pathDefault = require("path");

const DEFAULT_DISCORD_BOT = Object.freeze({
  enabled: false,
  channelId: "",
  notifyOnComplete: true,
});

const DISCORD_SNOWFLAKE_RE = /^\d{17,20}$/;
const BOT_TOKEN_RE = /^\S{20,2048}$/;

function cloneDefaultDiscordBot() {
  return { ...DEFAULT_DISCORD_BOT };
}

function normalizeDiscordBot(value) {
  const next = cloneDefaultDiscordBot();
  if (!value || typeof value !== "object") return next;
  next.enabled = value.enabled === true;
  next.channelId = typeof value.channelId === "string" ? value.channelId.trim() : "";
  next.notifyOnComplete = value.notifyOnComplete !== false;
  return next;
}

function validateDiscordBot(value) {
  const next = normalizeDiscordBot(value);
  if (next.channelId && !DISCORD_SNOWFLAKE_RE.test(next.channelId)) {
    return { status: "error", message: "Discord channel ID must be a 17-20 digit number" };
  }
  return { status: "ok" };
}

function validateBotToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!BOT_TOKEN_RE.test(token)) {
    return { status: "error", message: "Discord bot token is missing or invalid" };
  }
  return { status: "ok", token };
}

function tokenFilePath(userDataDir, path = pathDefault) {
  return path.join(userDataDir, "discord-bot-token");
}

function readTokenFile(filePath, fs = fsDefault) {
  try {
    const token = String(fs.readFileSync(filePath, "utf8") || "").trim();
    return BOT_TOKEN_RE.test(token) ? token : "";
  } catch {
    return "";
  }
}

function writeTokenFile(filePath, value, { fs = fsDefault, path = pathDefault } = {}) {
  const valid = validateBotToken(value);
  if (valid.status !== "ok") return valid;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${valid.token}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: err && err.message ? err.message : "Could not save Discord bot token" };
  }
}

function maskToken(token) {
  const value = typeof token === "string" ? token.trim() : "";
  if (!value) return "";
  if (value.length <= 10) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function readiness(config, token) {
  const next = normalizeDiscordBot(config);
  if (!next.enabled) return { ready: false, reason: "disabled", config: next };
  if (!DISCORD_SNOWFLAKE_RE.test(next.channelId)) return { ready: false, reason: "missing-channel-id", config: next };
  if (!BOT_TOKEN_RE.test(String(token || "").trim())) return { ready: false, reason: "missing-token", config: next };
  return { ready: true, config: next };
}

module.exports = {
  DEFAULT_DISCORD_BOT,
  DISCORD_SNOWFLAKE_RE,
  BOT_TOKEN_RE,
  cloneDefaultDiscordBot,
  normalizeDiscordBot,
  validateDiscordBot,
  validateBotToken,
  tokenFilePath,
  readTokenFile,
  writeTokenFile,
  maskToken,
  readiness,
};
