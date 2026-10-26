/**
 * The 3D backdrops react to what the app is doing (a question being answered,
 * a note saved) without the app knowing which scene is mounted.
 */
export type CosmosSignal = "pulse" | "think-start" | "think-end";

const EVENT = "apkh:cosmos";

export function emitCosmos(signal: CosmosSignal) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CosmosSignal>(EVENT, { detail: signal }));
}

export function onCosmos(handler: (signal: CosmosSignal) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<CosmosSignal>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
