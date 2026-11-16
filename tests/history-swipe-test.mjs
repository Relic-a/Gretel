import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const code = ts.transpileModule(readFileSync("app/components/use-history-swipe.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function fixture() {
  const listeners = new Map();
  const navigations = [];
  let cleanup, modal = false;
  class Element {
    scrollWidth = 100;
    clientWidth = 100;
    parentElement = null;
    interactive = false;
    closest() { return this.interactive; }
  }
  const window = {
    innerWidth: 1000,
    history: { back: () => navigations.push("back"), forward: () => navigations.push("forward") },
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => { assert.equal(listeners.get(name), handler); listeners.delete(name); }
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: () => ({ useEffect: effect => { cleanup = effect(); } }),
    window, document: { querySelector: () => modal }, Element,
    getComputedStyle: element => ({ overflowX: element.overflowX || "visible" })
  });
  exports.useHistorySwipe();
  const target = new Element();
  function emit(name, fields = {}) {
    const event = { target, timeStamp: 100, cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...fields };
    listeners.get(name)(event);
    return event;
  }
  const point = (x, y = 100, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  function swipe(dx, dy = 0, duration = 200) {
    emit("touchstart", { touches: [point(200)] });
    emit("touchend", { touches: [], changedTouches: [point(200 + dx, 100 + dy)], timeStamp: 100 + duration });
  }
  return { emit, point, swipe, navigations, target, listeners, cleanup: () => cleanup(), modal: value => { modal = value; } };
}

test("left and right touch swipes use history, with distance, angle, and duration guards", () => {
  const f = fixture();
  f.swipe(-100); f.swipe(100);
  assert.deepEqual(f.navigations, ["back", "forward"]);
  f.swipe(20); f.swipe(90, 100); f.swipe(100, 0, 1000);
  assert.equal(f.navigations.length, 2);
});

test("vertical scroll, multitouch, and canceled touches cannot become navigation", () => {
  const f = fixture();
  for (const cancel of [
    () => f.emit("touchmove", { touches: [f.point(205, 150)] }),
    () => f.emit("touchmove", { touches: [f.point(200), f.point(250, 100, 2)] }),
    () => f.emit("touchcancel")
  ]) {
    f.emit("touchstart", { touches: [f.point(200)] });
    cancel();
    f.emit("touchend", { touches: [], changedTouches: [f.point(90)] });
  }
  assert.deepEqual(f.navigations, []);
});

test("horizontal touch movement suppresses native swiping while vertical movement stays scrollable", () => {
  const f = fixture();
  f.emit("touchstart", { touches: [f.point(200)] });
  assert.equal(f.emit("touchmove", { touches: [f.point(170)] }).defaultPrevented, true);
  f.emit("touchcancel");
  f.emit("touchstart", { touches: [f.point(200)] });
  assert.equal(f.emit("touchmove", { touches: [f.point(200, 150)] }).defaultPrevented, false);
});

test("trackpad movement navigates once per gesture, including momentum, and supports both directions", () => {
  const f = fixture();
  for (const timeStamp of [100, 120, 140, 160, 180]) f.emit("wheel", { deltaX: 40, deltaY: 0, timeStamp });
  assert.deepEqual(f.navigations, ["back"]);
  f.emit("wheel", { deltaX: -100, deltaY: 0, timeStamp: 500 });
  assert.deepEqual(f.navigations, ["back", "forward"]);
  f.emit("wheel", { deltaX: 0, deltaY: 100, timeStamp: 800 });
  f.emit("wheel", { deltaX: 100, deltaY: 0, ctrlKey: true, timeStamp: 1100 });
  f.emit("wheel", { deltaX: 100, deltaY: 0, shiftKey: true, timeStamp: 1400 });
  assert.equal(f.navigations.length, 2);
});

test("inputs, modal dialogs, and horizontal scroll containers retain their gestures", () => {
  const f = fixture();
  f.target.interactive = true; f.swipe(-100);
  f.target.interactive = false; f.modal(true); f.swipe(-100);
  f.modal(false); f.target.scrollWidth = 200; f.target.overflowX = "auto"; f.swipe(-100);
  assert.equal(f.emit("wheel", { deltaX: 100, deltaY: 0 }).defaultPrevented, false);
  assert.deepEqual(f.navigations, []);
  f.cleanup();
  assert.equal(f.listeners.size, 0);
});
