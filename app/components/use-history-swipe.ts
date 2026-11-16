import { useEffect } from "react";

const threshold = 80;

/** Left goes back; right goes forward through the existing navigation history. */
export function useHistorySwipe() {
  useEffect(() => {
    let touch: { id: number; x: number; y: number; time: number } | null = null;
    let wheelDistance = 0;
    let wheelHandled = false;
    let lastWheelAt = 0;

    function blocked(target: EventTarget | null) {
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return true;
      if (!(target instanceof Element)) return true;
      if (target.closest('input, textarea, select, iframe, video, .player-shell, [role="slider"], [contenteditable]:not([contenteditable="false"])')) return true;
      // Leave carousels and other horizontal controls in charge of their swipes.
      for (let element: Element | null = target; element; element = element.parentElement) {
        if (element.scrollWidth > element.clientWidth && /auto|scroll/.test(getComputedStyle(element).overflowX)) return true;
      }
      return false;
    }

    function navigate(direction: number) {
      if (direction < 0) window.history.back();
      else window.history.forward();
    }

    function touchStart(event: TouchEvent) {
      touch = null;
      if (event.defaultPrevented || event.touches.length !== 1 || blocked(event.target)) return;
      const point = event.touches[0];
      touch = { id: point.identifier, x: point.clientX, y: point.clientY, time: event.timeStamp };
    }

    function touchMove(event: TouchEvent) {
      if (!touch) return;
      if (event.defaultPrevented || event.touches.length !== 1 || blocked(event.target)) {
        touch = null;
        return;
      }
      const point = event.touches[0];
      const dx = Math.abs(point.clientX - touch.x);
      const dy = Math.abs(point.clientY - touch.y);
      if (dy > 12 && dy >= dx) touch = null;
      else if (dx > 12 && dx > dy * 1.5 && event.cancelable) event.preventDefault();
    }

    function touchEnd(event: TouchEvent) {
      const start = touch;
      touch = null;
      if (!start || event.defaultPrevented || event.touches.length || blocked(event.target)) return;
      const point = Array.from(event.changedTouches).find(point => point.identifier === start.id);
      if (!point || event.timeStamp - start.time > 800) return;
      const dx = point.clientX - start.x;
      if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(point.clientY - start.y) * 1.5) {
        if (event.cancelable) event.preventDefault();
        navigate(dx);
      }
    }

    function touchCancel() { touch = null; }

    function wheel(event: WheelEvent) {
      if (event.timeStamp - lastWheelAt > 200) {
        wheelDistance = 0;
        wheelHandled = false;
      }
      lastWheelAt = event.timeStamp;
      if (event.defaultPrevented || event.ctrlKey || event.shiftKey || blocked(event.target) ||
          Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) {
        wheelDistance = 0;
        return;
      }
      if (event.cancelable) event.preventDefault();
      if (wheelHandled) return;
      // Wheel deltas follow content movement, opposite the finger direction.
      const delta = event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerWidth : 1);
      if (Math.sign(delta) !== Math.sign(wheelDistance)) wheelDistance = 0;
      wheelDistance += delta;
      if (Math.abs(wheelDistance) >= threshold) {
        wheelHandled = true;
        navigate(-wheelDistance);
      }
    }

    window.addEventListener("touchstart", touchStart, { passive: true });
    window.addEventListener("touchmove", touchMove, { passive: false });
    window.addEventListener("touchend", touchEnd, { passive: false });
    window.addEventListener("touchcancel", touchCancel);
    window.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("touchend", touchEnd);
      window.removeEventListener("touchcancel", touchCancel);
      window.removeEventListener("wheel", wheel);
    };
  }, []);
}
