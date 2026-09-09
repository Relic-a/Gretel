import { RefObject, useEffect, useRef } from "react";

/** Closes an open, non-modal surface when focus moves outside its boundary. */
export function usePopoverDismissal(
  surfaceRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  enabled = true
) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;

    function dismissWhenOutside(event: PointerEvent) {
      if (!surfaceRef.current?.contains(event.target as Node)) {
        onDismissRef.current();
      }
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDismissRef.current();
      }
    }

    document.addEventListener("pointerdown", dismissWhenOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissWhenOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [enabled, surfaceRef]);
}
