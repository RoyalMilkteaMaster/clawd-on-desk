# Clawd on Desk v0.12.1-notifications.10

這是以 Clawd on Desk 為基礎的通知整合版本。

## 新增

- Discord Bot 完成通知與設定頁。
- LINE Messaging API 手機通知與設定頁。
- 獨立「通知回應」頁面，可用一般表單修改暱稱、完成／中斷／權限／選擇回應。
- 完成回應隨機抽選，避免立即重複上一則。
- Discord／LINE 選配通知安裝與除錯指南。

## 狀態列

- 恢復原始簡潔狀態列，不顯示 Codex 子 agent。
- Codex 預設標題為 `Codex` 時，改用 cwd 的專案資料夾名稱。
- 滑鼠停留時顯示完整專案名稱與 cwd；移開後關閉。

## 通知規則

- 只有大專案／根任務完成會傳送完成通知。
- Codex 子 agent 完成不會各自傳送訊息。
- Discord 與 LINE 共用通知回應設定。
- Discord 與 LINE 預設關閉，Token 不包含在安裝檔中。

## Windows 安裝檔

`Clawd-on-Desk-Setup-0.12.1-notifications.10-x64.exe`

安裝與常見問題請閱讀 [Discord／LINE 選配通知安裝指南](../guides/notifications.zh-TW.md)。
