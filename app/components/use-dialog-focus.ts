import { RefObject, useEffect, useRef } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  dismissible: boolean,
  onDismiss: () => void
) {
  const dismissibleRef = useRef(dismissible);
  const onDismissRef = useRef(onDismiss);
  dismissibleRef.current = dismissible;
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (!dialog) return;
    const dialogElement = dialog;

    const getFocusableElements = () =>
      Array.from(dialogElement.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getAttribute("aria-hidden") !== "true"
      );

    const animationFrame = window.requestAnimationFrame(() => {
      const preferred = dialogElement.querySelector<HTMLElement>("[autofocus]");
      (preferred || getFocusableElements()[0] || dialogElement).focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && dismissibleRef.current) {
        event.preventDefault();
        onDismissRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialogElement.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogElement.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [dialogRef]);
}
