/**
 * Pure unit tests for `buildMenuItems`. No chrome stub needed — the
 * factory is intentionally pure (per spec §"File Layout" boundary
 * discipline). Tests assert shape, ordering, title rendering, and
 * checkbox-state propagation.
 */

import { describe, it, expect } from 'vitest';
import type { SettingsV7 } from '../../../../core/settings';
import { DEFAULT_SETTINGS } from '../../../../core/settings/defaults';
import { buildMenuItems, type CtxMenuItemId } from '../factory';

const HTTP = ['http://*/*', 'https://*/*'];

function withSettings(partial: Partial<SettingsV7>): SettingsV7 {
  return { ...DEFAULT_SETTINGS, ...partial };
}

describe('buildMenuItems', () => {
  it('emits 8 items in the documented order for default settings', () => {
    const items = buildMenuItems(DEFAULT_SETTINGS);
    expect(items.map((i) => i.id)).toEqual([
      'speedreader.ctx.parent.v1',
      'speedreader.ctx.lastUsed.v1',
      'speedreader.ctx.preset.300.v1',
      'speedreader.ctx.preset.500.v1',
      'speedreader.ctx.preset.custom.v1',
      'speedreader.ctx.separator.v1',
      'speedreader.ctx.toggle.showContext.v1',
      'speedreader.ctx.toggle.startFromWord1.v1',
    ] satisfies CtxMenuItemId[]);
  });

  it('renders lastUsed title from settings.lastUsedWpm (250 default)', () => {
    const items = buildMenuItems(withSettings({ lastUsedWpm: 250 }));
    const lastUsed = items.find((i) => i.id === 'speedreader.ctx.lastUsed.v1');
    expect(lastUsed?.title).toBe('250 wpm · last used');
  });

  it('renders lastUsed title with a custom value', () => {
    const items = buildMenuItems(withSettings({ lastUsedWpm: 420 }));
    const lastUsed = items.find((i) => i.id === 'speedreader.ctx.lastUsed.v1');
    expect(lastUsed?.title).toBe('420 wpm · last used');
  });

  it('keeps lastUsed and preset.300 as distinct items when lastUsedWpm === 300', () => {
    // Spec test surface: "no preset-vs-lastUsed title collision when
    // lastUsedWpm exactly equals a preset value". They share semantic
    // meaning but stay distinct IDs so the listener dispatch arms remain
    // unambiguous.
    const items = buildMenuItems(withSettings({ lastUsedWpm: 300 }));
    const lastUsed = items.find((i) => i.id === 'speedreader.ctx.lastUsed.v1');
    const preset300 = items.find((i) => i.id === 'speedreader.ctx.preset.300.v1');
    expect(lastUsed?.id).not.toBe(preset300?.id);
    expect(lastUsed?.title).toBe('300 wpm · last used');
    expect(preset300?.title).toBe('300 wpm');
  });

  it('propagates contextLine: true to toggle.showContext.checked', () => {
    const items = buildMenuItems(withSettings({ contextLine: true }));
    const toggle = items.find((i) => i.id === 'speedreader.ctx.toggle.showContext.v1');
    expect(toggle?.checked).toBe(true);
    expect(toggle?.type).toBe('checkbox');
  });

  it('propagates contextLine: false to toggle.showContext.checked', () => {
    const items = buildMenuItems(withSettings({ contextLine: false }));
    const toggle = items.find((i) => i.id === 'speedreader.ctx.toggle.showContext.v1');
    expect(toggle?.checked).toBe(false);
  });

  it('propagates startFromWordOne: true to toggle.startFromWord1.checked', () => {
    const items = buildMenuItems(withSettings({ startFromWordOne: true }));
    const toggle = items.find((i) => i.id === 'speedreader.ctx.toggle.startFromWord1.v1');
    expect(toggle?.checked).toBe(true);
    expect(toggle?.type).toBe('checkbox');
  });

  it('propagates startFromWordOne: false to toggle.startFromWord1.checked', () => {
    const items = buildMenuItems(withSettings({ startFromWordOne: false }));
    const toggle = items.find((i) => i.id === 'speedreader.ctx.toggle.startFromWord1.v1');
    expect(toggle?.checked).toBe(false);
  });

  it('marks separator with type: "separator"', () => {
    const items = buildMenuItems(DEFAULT_SETTINGS);
    const sep = items.find((i) => i.id === 'speedreader.ctx.separator.v1');
    expect(sep?.type).toBe('separator');
  });

  it('all non-parent items carry the parent id', () => {
    const items = buildMenuItems(DEFAULT_SETTINGS);
    for (const item of items) {
      if (item.id === 'speedreader.ctx.parent.v1') {
        expect(item.parentId).toBeUndefined();
      } else {
        expect(item.parentId).toBe('speedreader.ctx.parent.v1');
      }
    }
  });

  it('every item declares contexts: ["selection"] and http(s)-only patterns', () => {
    const items = buildMenuItems(DEFAULT_SETTINGS);
    for (const item of items) {
      expect([...item.contexts]).toEqual(['selection']);
      expect([...item.documentUrlPatterns]).toEqual(HTTP);
    }
  });

  it('preset titles are stable (do not depend on settings)', () => {
    const items = buildMenuItems(withSettings({ lastUsedWpm: 420 }));
    expect(items.find((i) => i.id === 'speedreader.ctx.preset.300.v1')?.title).toBe('300 wpm');
    expect(items.find((i) => i.id === 'speedreader.ctx.preset.500.v1')?.title).toBe('500 wpm');
    expect(items.find((i) => i.id === 'speedreader.ctx.preset.custom.v1')?.title).toBe('Custom…');
  });
});
