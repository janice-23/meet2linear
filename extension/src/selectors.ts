// Every Google Meet DOM selector lives here — this file is the blast radius
// when Google changes Meet's UI. Approach borrowed from transcriptonic:
// prefer ARIA attributes and Google Symbols icon-font ligature names, which
// survive class-name churn; obfuscated class names are optional extras.

export const CAPTION_REGION = 'div[role="region"][tabindex="0"]';

export const ICONS = {
  leaveCall: "call_end",
  captionsOff: "closed_caption_off",
  captionsOn: "closed_caption",
} as const;

// Obfuscated, may break at any time — used only to normalize the "You" speaker
// label to a real name. Failure degrades gracefully.
export const OWN_NAME = ".awLEm";

/** Find the Google Symbols icon element whose ligature text is `name`. */
export function findIcon(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(".google-symbols, i[translate='no']")) {
    if (el.textContent?.trim() === name) return el;
  }
  return null;
}

/** Find the clickable button wrapping an icon (walk up to a button-ish ancestor). */
export function iconButton(name: string): HTMLElement | null {
  const icon = findIcon(name);
  if (!icon) return null;
  return icon.closest<HTMLElement>("button, [role='button']") ?? icon.parentElement;
}

export function captionRegion(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CAPTION_REGION);
}
