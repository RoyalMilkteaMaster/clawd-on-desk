"use strict";

(function initSettingsTabMobile(root) {
  let runtime = null;
  let helpers = null;
  let state = null;
  let infoContainer = null;

  function t(key) {
    return helpers.t(key);
  }

  function escapeHtml(str) {
    return helpers.escapeHtml(str);
  }

  function fetchMobileInfo() {
    if (!window.settingsAPI || typeof window.settingsAPI.getMobileConnectionInfo !== "function") {
      return Promise.resolve(null);
    }
    return window.settingsAPI.getMobileConnectionInfo().catch(() => null);
  }

  function renderConnectionInfo(container) {
    container.innerHTML = "";
    const snapshot = (state && state.snapshot) || {};
    const enabled = snapshot.mobilePreviewEnabled === true;
    if (!enabled) {
      container.innerHTML = `<p class="mobile-info-loading">${escapeHtml(t("mobileDisabled") || "Enable the toggle above to start the LAN bridge.")}</p>`;
      return;
    }

    container.innerHTML = `<div class="mobile-info-loading">${escapeHtml(t("mobileLoading") || "Loading...")}</div>`;

    fetchMobileInfo().then((info) => {
      if (!container.parentNode) return;
      if (!info || info.status !== "ok") {
        container.innerHTML = `<p class="mobile-info-error">${escapeHtml(t("mobileError") || "Unable to load connection info.")}</p>`;
        return;
      }

      let html = '';

      // Connection details
      html += '<div class="mobile-conn-details">';
      html += `<div class="mobile-conn-row"><span class="mobile-conn-label">LAN IP</span><span class="mobile-conn-value">${escapeHtml(info.lanIp)}</span>`;
      html += `<button class="mobile-copy-btn" data-copy="${escapeHtml(info.lanIp)}">Copy</button></div>`;
      html += `<div class="mobile-conn-row"><span class="mobile-conn-label">Port</span><span class="mobile-conn-value">${info.port}</span>`;
      html += `<button class="mobile-copy-btn" data-copy="${String(info.port)}">Copy</button></div>`;
      html += `<div class="mobile-conn-row"><span class="mobile-conn-label">Token</span><span class="mobile-conn-value mobile-token">${escapeHtml(info.token)}</span>`;
      html += `<button class="mobile-copy-btn" data-copy="${escapeHtml(info.token)}">Copy</button></div>`;

      // Pair URL
      if (info.pairUrl) {
        html += `<div class="mobile-conn-row"><span class="mobile-conn-label">URL</span><span class="mobile-conn-value mobile-pair-url">${escapeHtml(info.pairUrl)}</span>`;
        html += `<button class="mobile-copy-btn" data-copy="${escapeHtml(info.pairUrl)}">Copy</button></div>`;
      }

      html += '</div>';

      container.innerHTML = html;

      // Copy button handlers
      container.querySelectorAll(".mobile-copy-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const text = btn.getAttribute("data-copy");
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
              btn.textContent = "Copied!";
              setTimeout(() => { btn.textContent = "Copy"; }, 1500);
            });
          }
        });
      });
    });
  }

  function renderMobileTab(container, core) {
    runtime = core.runtime;
    helpers = core.helpers;
    state = core.state;

    const section = document.createElement("div");
    section.className = "settings-tab-section";

    // Title & description
    const title = document.createElement("h3");
    title.textContent = t("mobileTitle") || "Mobile / PWA";
    section.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "settings-tab-desc";
    desc.textContent = t("mobileDesc") || "Connect your phone to monitor sessions and approve permissions remotely.";
    section.appendChild(desc);

    // Enable toggle
    section.appendChild(helpers.buildSwitchRow({
      key: "mobilePreviewEnabled",
      labelKey: "mobileToggle",
      descKey: "mobileToggleDesc",
    }));

    // Connection info (re-renders on toggle)
    infoContainer = document.createElement("div");
    infoContainer.id = "mobile-connection-info";
    section.appendChild(infoContainer);

    container.appendChild(section);

    renderConnectionInfo(infoContainer);

    // Re-render connection info when toggle changes
    if (window.settingsAPI && typeof window.settingsAPI.onChanged === "function") {
      window.settingsAPI.onChanged((evt) => {
        if (evt && evt.changes && Object.prototype.hasOwnProperty.call(evt.changes, "mobilePreviewEnabled")) {
          renderConnectionInfo(infoContainer);
        }
      });
    }
  }

  function init(core) {
    runtime = core.runtime;
    helpers = core.helpers;
    core.tabs["mobile"] = { render: renderMobileTab };
  }

  root.ClawdSettingsTabMobile = { init };
})(globalThis);
