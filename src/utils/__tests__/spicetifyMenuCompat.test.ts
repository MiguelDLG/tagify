import { afterEach, describe, expect, it } from "vitest";
import {
  findMenuItemComponent,
  isMenuItemComponent,
  repairSpicetifyMenuItem,
} from "../spicetifyMenuCompat";

// Shapes copied from Spotify 1.3.3's xpui-modules.js (minified bodies trimmed).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const waveform = ({ threeBandWaveform: e, durationMs: t }: any) => {
  const handleMouseEnter = () => e;
  return { onClick: handleMouseEnter, t };
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const propsForwarder = (e: any) => ({ leadingIcon: e.leadingIcon, forceV2LeadingIcon: e.forceV2LeadingIcon, onClick: () => e.onClick?.() });
const forwardRefItem = {
  $$typeof: Symbol.for("react.forward_ref"),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render: function ({ leadingIcon, onClick }: any) {
    return { className: "menuItemButton", onClick, leadingIcon };
  },
};

describe("spicetifyMenuCompat", () => {
  const original = (globalThis as any).Spicetify.ReactComponent;
  afterEach(() => {
    (globalThis as any).Spicetify.ReactComponent = original;
  });

  it("tells the waveform false match apart from the menu item", () => {
    expect(isMenuItemComponent(waveform)).toBe(false);
    expect(isMenuItemComponent(propsForwarder)).toBe(true);
    expect(isMenuItemComponent(forwardRefItem)).toBe(true);
  });

  it("prefers the props-forwarding export", () => {
    expect(findMenuItemComponent([waveform, forwardRefItem, propsForwarder])).toBe(propsForwarder);
    expect(findMenuItemComponent([waveform, forwardRefItem])).toBe(forwardRefItem);
    expect(findMenuItemComponent([waveform])).toBeUndefined();
  });

  it("replaces a wrong binding and leaves a correct one alone", async () => {
    const req: any = (id: string) => req.c[id].exports;
    req.m = { a: {}, b: {} };
    req.c = { a: { exports: { W: waveform } }, b: { exports: { D: propsForwarder, x: 1 } } };

    (globalThis as any).Spicetify.ReactComponent = { MenuItem: waveform };
    expect(await repairSpicetifyMenuItem(() => req)).toBe("repaired");
    expect((globalThis as any).Spicetify.ReactComponent.MenuItem).toBe(propsForwarder);

    expect(await repairSpicetifyMenuItem(() => req)).toBe("ok");
  });

  it("reports when the component cannot be found", async () => {
    const req: any = () => ({ W: waveform });
    req.m = { a: {} };
    (globalThis as any).Spicetify.ReactComponent = { MenuItem: waveform };
    expect(await repairSpicetifyMenuItem(() => req)).toBe("not-found");
    expect((globalThis as any).Spicetify.ReactComponent.MenuItem).toBe(waveform);
  });
});
