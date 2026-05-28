import { describe, expect, test } from 'vitest';
import { installFocusTrap } from '../focus-trap';

function makeContainer(): {
  container: HTMLElement;
  btn: HTMLButtonElement;
  sentinels: HTMLElement[];
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const top = document.createElement('div');
  top.tabIndex = 0;
  top.className = 'trap-sentinel';
  const btn = document.createElement('button');
  btn.textContent = 'X';
  const bottom = document.createElement('div');
  bottom.tabIndex = 0;
  bottom.className = 'trap-sentinel';
  container.append(top, btn, bottom);
  return { container, btn, sentinels: [top, bottom] };
}

describe('installFocusTrap', () => {
  test('focuses the first focusable on install', () => {
    const { container, btn } = makeContainer();
    installFocusTrap(container);
    expect(container.ownerDocument.activeElement).toBe(btn);
  });

  test('focusing top sentinel wraps to bottom focusable', () => {
    const { container, btn, sentinels } = makeContainer();
    installFocusTrap(container);
    sentinels[0].focus();
    sentinels[0].dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    expect(container.ownerDocument.activeElement).toBe(btn);
  });

  test('focusing bottom sentinel wraps to top focusable', () => {
    const { container, btn, sentinels } = makeContainer();
    installFocusTrap(container);
    sentinels[1].focus();
    sentinels[1].dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    expect(container.ownerDocument.activeElement).toBe(btn);
  });

  test('uninstall restores prior focus', () => {
    const prior = document.createElement('input');
    document.body.appendChild(prior);
    prior.focus();
    const { container } = makeContainer();
    const uninstall = installFocusTrap(container);
    uninstall();
    expect(document.activeElement).toBe(prior);
  });
});
