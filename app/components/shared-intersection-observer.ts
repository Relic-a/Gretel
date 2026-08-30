type IntersectionCallback = (entry: IntersectionObserverEntry) => void;

const callbacks = new Map<Element, IntersectionCallback>();
let observer: IntersectionObserver | null = null;

export function observeCardIntersection(element: Element, callback: IntersectionCallback) {
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        callbacks.get(entry.target)?.(entry);
      }
    });
  }

  callbacks.set(element, callback);
  observer.observe(element);

  return () => {
    callbacks.delete(element);
    observer?.unobserve(element);

    if (callbacks.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}
