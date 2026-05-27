/**
 * Sentinel-based focus trap. Caller passes a container that already has two
 * `.trap-sentinel` elements (first child and last child) and at least one
 * focusable element between them. The trap installs `focus` listeners on the
 * sentinels that bounce focus to the first/last focusable inside.
 *
 * Returns an uninstall function that removes listeners and restores the
 * previously-active element (recorded at install time).
 *
 * Pure DOM — no chrome.*, safe for src/core.
 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not(.trap-sentinel)';

export function installFocusTrap(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const priorActive = doc.activeElement as HTMLElement | null;
  const focusables = (): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const sentinels = container.querySelectorAll<HTMLElement>('.trap-sentinel');
  if (sentinels.length !== 2) {
    throw new Error('installFocusTrap: container must contain exactly two .trap-sentinel elements');
  }
  const [top, bottom] = sentinels;

  const onTopFocus = () => {
    const f = focusables();
    if (f.length > 0) f[f.length - 1].focus();
  };
  const onBottomFocus = () => {
    const f = focusables();
    if (f.length > 0) f[0].focus();
  };
  top.addEventListener('focus', onTopFocus);
  bottom.addEventListener('focus', onBottomFocus);

  const initial = focusables()[0];
  if (initial) initial.focus();

  return () => {
    top.removeEventListener('focus', onTopFocus);
    bottom.removeEventListener('focus', onBottomFocus);
    if (priorActive && typeof priorActive.focus === 'function') priorActive.focus();
  };
}
