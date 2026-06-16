import { describe, it, expect, vi } from 'vitest';
import { createPopupHistoryClient } from '../client';

function apiWith(sendMessage: ReturnType<typeof vi.fn>): typeof chrome {
  return { runtime: { sendMessage } } as unknown as typeof chrome;
}

describe('PopupHistoryClient — full-history management over RPC', () => {
  it('list() sends position/list and returns the entries', async () => {
    const entries = [
      { url: 'https://a/', position: { wordIndex: 1, totalWords: 10, lastReadAt: 5 } },
    ];
    const sendMessage = vi.fn(async () => ({ ok: true, data: entries }));
    const client = createPopupHistoryClient(apiWith(sendMessage));
    await expect(client.list()).resolves.toEqual(entries);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'position/list' });
  });

  it('list() returns [] on an error response (graceful degradation)', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: { kind: 'invalid-payload' } }));
    const client = createPopupHistoryClient(apiWith(sendMessage));
    await expect(client.list()).resolves.toEqual([]);
  });

  it('delete(url) sends position/delete with the trusted url param', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: undefined }));
    const client = createPopupHistoryClient(apiWith(sendMessage));
    await client.delete('https://a/');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'position/delete', url: 'https://a/' });
  });

  it('delete() rejects on an error response', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: { kind: 'invalid-payload' } }));
    const client = createPopupHistoryClient(apiWith(sendMessage));
    await expect(client.delete('https://a/')).rejects.toBeTruthy();
  });

  it('clearAll() sends position/clear-all', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: undefined }));
    const client = createPopupHistoryClient(apiWith(sendMessage));
    await client.clearAll();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'position/clear-all' });
  });

  it('clearAll() rejects on an error response', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: { kind: 'invalid-payload' } }));
    const client = createPopupHistoryClient(apiWith(sendMessage));
    await expect(client.clearAll()).rejects.toBeTruthy();
  });
});
