/**
 * Spicetify 2.45.1 looks up Spotify's context-menu item component by source
 * markers ("handleMouseEnter" + "menuItemButton"). Spotify 1.3.3 wraps that
 * component in forwardRef behind a props-forwarding function, so the lookup
 * falls back to an unrelated waveform component and every extension's
 * right-click entry silently disappears. This finds the real component and
 * puts it back on Spicetify.ReactComponent.MenuItem.
 */

type WebpackRequire = ((id: string) => unknown) & {
  m?: Record<string, unknown>;
  c?: Record<string, { exports?: unknown } | undefined>;
};

const FORWARD_REF = Symbol.for("react.forward_ref");
const PROPS_FORWARDER = /forceV2LeadingIcon:\s*[\w$]+\.forceV2LeadingIcon/;

function source(fn: unknown): string {
  try {
    return Function.prototype.toString.call(fn);
  } catch {
    return "";
  }
}

function values(obj: unknown): unknown[] {
  if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return [];
  try {
    return Object.values(obj);
  } catch {
    return [];
  }
}

function renderSource(component: unknown): string {
  if (typeof component === "function") return source(component);
  if (component && typeof component === "object" && (component as any).$$typeof === FORWARD_REF) {
    return source((component as any).render);
  }
  return "";
}

/** True when the component is Spotify's menu item rather than a false match. */
export function isMenuItemComponent(component: unknown): boolean {
  const src = renderSource(component);
  return src.includes("menuItemButton") || PROPS_FORWARDER.test(src);
}

function getWebpackRequire(): WebpackRequire | null {
  const w = window as any;
  const chunks = w.rspackChunk || w.rspackChunkclient_web || w.webpackChunkclient_web;
  if (!chunks?.push) return null;
  let captured: WebpackRequire | null = null;
  const returned = chunks.push([[Symbol("tagify-menu-compat")], {}, (req: WebpackRequire) => {
    captured = req;
    return req;
  }]);
  return typeof returned === "function" ? returned : captured;
}

function moduleExports(req: WebpackRequire): unknown[] {
  const ids = Object.keys(req.m ?? {});
  const out: unknown[] = [];
  for (const id of ids) {
    let exports = req.c?.[id]?.exports;
    if (exports === undefined) {
      try {
        exports = req(id);
      } catch {
        continue;
      }
    }
    out.push(...values(exports));
  }
  return out;
}

/** Pick Spotify's menu item from a list of webpack exports. */
export function findMenuItemComponent(exports: unknown[]): unknown {
  return (
    exports.find((e) => typeof e === "function" && PROPS_FORWARDER.test(source(e))) ??
    exports.find((e) => {
      const src = renderSource(e);
      return src.includes("menuItemButton") && src.includes("leadingIcon") && src.includes("onClick");
    })
  );
}

/**
 * Restore Spicetify.ReactComponent.MenuItem when Spicetify bound the wrong
 * component. Waits for the wrapper to populate it first so our fix is not
 * overwritten. Returns what happened, for logging.
 */
export async function repairSpicetifyMenuItem(
  getRequire: () => WebpackRequire | null = getWebpackRequire,
  timeoutMs = 30000,
): Promise<"ok" | "repaired" | "not-found" | "unavailable"> {
  const started = Date.now();
  while (!Spicetify.ReactComponent?.MenuItem) {
    if (Date.now() - started > timeoutMs) return "unavailable";
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (isMenuItemComponent(Spicetify.ReactComponent.MenuItem)) return "ok";

  const req = getRequire();
  const component = req ? findMenuItemComponent(moduleExports(req)) : undefined;
  if (!component) return "not-found";
  (Spicetify.ReactComponent as any).MenuItem = component;
  return "repaired";
}
