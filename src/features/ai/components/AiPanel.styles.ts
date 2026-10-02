// Generated from the former AiPanel.module.css. The panel renders from the
// Spicetify extension, where stylesheets are not loaded, so styles are injected.
export const AI_PANEL_CSS = ".tgai-panel {\n  position: fixed;\n  top: 72px;\n  right: 16px;\n  bottom: 104px;\n  z-index: 9999;\n  display: flex;\n  flex-direction: column;\n  width: min(440px, calc(100vw - 32px));\n  overflow: hidden;\n  color: var(--spice-text);\n  font-size: 13px;\n  background: var(--spice-card);\n  border: 1px solid rgb(255 255 255 / 12%);\n  border-radius: 14px;\n  box-shadow: 0 24px 70px rgb(0 0 0 / 55%);\n}\n\n.tgai-header {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  justify-content: space-between;\n  padding: 12px 14px;\n  background: linear-gradient(135deg, rgb(185 140 255 / 16%), transparent 70%);\n  border-bottom: 1px solid rgb(255 255 255 / 8%);\n}\n\n.tgai-title {\n  display: flex;\n  min-width: 0;\n  gap: 8px;\n  align-items: center;\n  font-size: 15px;\n  font-weight: 700;\n}\n\n.tgai-spark {\n  color: #b98cff;\n}\n\n.tgai-context {\n  overflow: hidden;\n  padding: 2px 8px;\n  color: var(--spice-subtext);\n  font-size: 11px;\n  font-weight: 500;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  border: 1px solid var(--spice-button-disabled);\n  border-radius: 999px;\n}\n\n.tgai-headerActions {\n  display: flex;\n  flex: none;\n  gap: 2px;\n}\n\n.tgai-icon {\n  width: 28px;\n  height: 28px;\n  padding: 0;\n  color: var(--spice-subtext);\n  font-size: 14px;\n  cursor: pointer;\n  background: transparent;\n  border: 0;\n  border-radius: 6px;\n}\n\n.tgai-icon:hover,\n.tgai-icon.tgai-active {\n  color: var(--spice-text);\n  background: rgb(255 255 255 / 8%);\n}\n\n.tgai-messages {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: 8px;\n  padding: 12px 14px;\n  overflow-y: auto;\n}\n\n.tgai-empty {\n  padding: 24px 8px;\n  color: var(--spice-subtext);\n  line-height: 1.5;\n  text-align: center;\n}\n\n.tgai-user,\n.tgai-assistant,\n.tgai-error {\n  max-width: 92%;\n  padding: 8px 11px;\n  line-height: 1.45;\n  white-space: pre-wrap;\n  border-radius: 10px;\n}\n\n.tgai-user {\n  align-self: flex-end;\n  background: rgb(185 140 255 / 18%);\n}\n\n.tgai-assistant {\n  align-self: flex-start;\n  background: rgb(255 255 255 / 6%);\n}\n\n.tgai-error {\n  align-self: flex-start;\n  color: #ffb4b4;\n  background: rgb(255 80 80 / 12%);\n}\n\n.tgai-tool {\n  color: var(--spice-subtext);\n  font-size: 11px;\n  font-style: italic;\n}\n\n.tgai-proposal {\n  padding: 10px 12px;\n  background: color-mix(in srgb, var(--spice-main) 85%, black 15%);\n  border: 1px solid rgb(185 140 255 / 35%);\n  border-radius: 10px;\n}\n\n.tgai-proposalSummary {\n  margin-bottom: 8px;\n  font-weight: 600;\n  line-height: 1.4;\n}\n\n.tgai-changes {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  max-height: 320px;\n  overflow-y: auto;\n}\n\n.tgai-change {\n  display: grid;\n  grid-template-columns: auto minmax(0, 1fr);\n  gap: 4px 8px;\n  align-items: start;\n  padding: 5px 4px;\n  cursor: pointer;\n  border-radius: 6px;\n}\n\n.tgai-change:hover {\n  background: rgb(255 255 255 / 4%);\n}\n\n.tgai-changeTrack {\n  display: flex;\n  min-width: 0;\n  flex-direction: column;\n}\n\n.tgai-changeName {\n  overflow: hidden;\n  font-weight: 600;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.tgai-changeArtist {\n  color: var(--spice-subtext);\n  font-size: 11px;\n}\n\n.tgai-chips {\n  display: flex;\n  flex-wrap: wrap;\n  grid-column: 2;\n  gap: 4px;\n}\n\n.tgai-chipAdd,\n.tgai-chipRemove,\n.tgai-chipNeutral {\n  padding: 1px 7px;\n  font-size: 11px;\n  font-weight: 600;\n  border-radius: 999px;\n}\n\n.tgai-chipAdd {\n  color: #7ff0a7;\n  background: rgb(30 215 96 / 14%);\n}\n\n.tgai-chipRemove {\n  color: #ff9d9d;\n  background: rgb(255 80 80 / 14%);\n}\n\n.tgai-chipNeutral {\n  color: var(--spice-subtext);\n  background: rgb(255 255 255 / 8%);\n}\n\n.tgai-proposalActions {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  justify-content: flex-end;\n  margin-top: 10px;\n}\n\n.tgai-status,\n.tgai-statusOk {\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.tgai-status {\n  color: var(--spice-subtext);\n}\n\n.tgai-statusOk {\n  color: #1ed760;\n}\n\n.tgai-primary,\n.tgai-secondary {\n  padding: 6px 12px;\n  font-size: 12px;\n  font-weight: 600;\n  cursor: pointer;\n  border: 1px solid transparent;\n  border-radius: 6px;\n}\n\n.tgai-primary {\n  color: #000;\n  background: #1ed760;\n}\n\n.tgai-primary:hover:not(:disabled) {\n  background: #3be477;\n}\n\n.tgai-secondary {\n  color: var(--spice-text);\n  background: transparent;\n  border-color: var(--spice-button-disabled);\n}\n\n.tgai-secondary:hover:not(:disabled) {\n  background: rgb(255 255 255 / 8%);\n}\n\n.tgai-primary:disabled,\n.tgai-secondary:disabled {\n  cursor: default;\n  opacity: 0.5;\n}\n\n.tgai-composer {\n  display: flex;\n  gap: 8px;\n  align-items: flex-end;\n  padding: 10px 12px;\n  border-top: 1px solid rgb(255 255 255 / 8%);\n}\n\n.tgai-composer textarea {\n  flex: 1;\n  min-height: 38px;\n  max-height: 140px;\n  padding: 8px 10px;\n  color: var(--spice-text);\n  font: inherit;\n  resize: vertical;\n  background: rgb(255 255 255 / 6%);\n  border: 1px solid var(--spice-button-disabled);\n  border-radius: 8px;\n}\n\n.tgai-footer {\n  padding: 0 14px 10px;\n  color: var(--spice-subtext);\n  font-size: 11px;\n}\n\n.tgai-settings {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  padding: 16px 14px;\n}\n\n.tgai-settings label {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  font-weight: 600;\n}\n\n.tgai-settings input,\n.tgai-settings select {\n  padding: 8px 10px;\n  color: var(--spice-text);\n  font: inherit;\n  font-weight: 400;\n  background: rgb(255 255 255 / 6%);\n  border: 1px solid var(--spice-button-disabled);\n  border-radius: 8px;\n}\n\n.tgai-hint {\n  color: var(--spice-subtext);\n  font-size: 11px;\n  font-weight: 400;\n}\n\n.tgai-hint a {\n  color: #b98cff;\n}\n\n.tgai-history {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: 8px;\n  padding: 12px 14px;\n  overflow-y: auto;\n}\n\n.tgai-historyItem {\n  display: flex;\n  gap: 10px;\n  align-items: center;\n  justify-content: space-between;\n  padding: 10px 12px;\n  background: rgb(255 255 255 / 4%);\n  border-radius: 10px;\n}\n";

export const styles = {
  "active": "tgai-active",
  "assistant": "tgai-assistant",
  "change": "tgai-change",
  "changeArtist": "tgai-changeArtist",
  "changeName": "tgai-changeName",
  "changeTrack": "tgai-changeTrack",
  "changes": "tgai-changes",
  "chipAdd": "tgai-chipAdd",
  "chipNeutral": "tgai-chipNeutral",
  "chipRemove": "tgai-chipRemove",
  "chips": "tgai-chips",
  "composer": "tgai-composer",
  "context": "tgai-context",
  "empty": "tgai-empty",
  "error": "tgai-error",
  "footer": "tgai-footer",
  "header": "tgai-header",
  "headerActions": "tgai-headerActions",
  "hint": "tgai-hint",
  "history": "tgai-history",
  "historyItem": "tgai-historyItem",
  "icon": "tgai-icon",
  "messages": "tgai-messages",
  "panel": "tgai-panel",
  "primary": "tgai-primary",
  "proposal": "tgai-proposal",
  "proposalActions": "tgai-proposalActions",
  "proposalSummary": "tgai-proposalSummary",
  "secondary": "tgai-secondary",
  "settings": "tgai-settings",
  "spark": "tgai-spark",
  "status": "tgai-status",
  "statusOk": "tgai-statusOk",
  "title": "tgai-title",
  "tool": "tgai-tool",
  "user": "tgai-user"
} as const;

const STYLE_ID = "tagify-ai-styles";

export function injectAiPanelStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = AI_PANEL_CSS;
  document.head.appendChild(el);
}
