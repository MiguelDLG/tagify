import React from "react";
import AiPanel from "./components/AiPanel";
import { injectAiPanelStyles } from "./components/AiPanel.styles";
import type { AiContext } from "./model/ai.types";

export { OPEN_AI_EVENT } from "./ai.events";

let host: HTMLElement | null = null;
let root: { render(el: unknown): void; unmount(): void } | null = null;

function ensureHost(): HTMLElement {
  if (!host || !document.body.contains(host)) {
    host = document.createElement("div");
    host.id = "tagify-ai-root";
    document.body.appendChild(host);
    root = null;
  }
  return host;
}

export function closeAiPanel(): void {
  const ReactDOM: any = Spicetify.ReactDOM;
  if (root) {
    root.unmount();
    root = null;
  } else if (host) {
    ReactDOM.unmountComponentAtNode?.(host);
  }
}

/** Open the floating AI panel over whatever Spotify page is showing. */
export function openAiPanel(context: AiContext): void {
  const ReactDOM: any = Spicetify.ReactDOM;
  injectAiPanelStyles();
  const element = <AiPanel key={Date.now()} context={context} onClose={closeAiPanel} />;
  const container = ensureHost();
  if (ReactDOM.createRoot) {
    root = root ?? ReactDOM.createRoot(container);
    root!.render(element);
  } else {
    ReactDOM.render(element, container);
  }
}
