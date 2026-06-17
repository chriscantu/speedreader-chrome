import { describe, it, expect, vi } from 'vitest';
import { createContentPositionClient } from '../client';

function apiWith(sendMessage: ReturnType<typeof vi.fn>): typeof chrome {
  return { runtime: { sendMessage } } as unknown as typeof chrome;
}

describe('ContentPositionClient — sender-bound RPCs (no url in any payload)', () => {
  it('read() sends position/get with NO url and returns the record', async () => {
    const sendMessage = vi.fn(async () => ({
      ok: true,
      data: { wordIndex: 5, totalWords: 50, lastReadAt: 1000 },
    }));
    const client = createContentPositionClient(apiWith(sendMessage));
    const pos = await client.read();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'position/get' });
    expect(pos).toEqual({ wordIndex: 5, totalWords: 50, lastReadAt: 1000 });
  });

  it('read() returns undefined when the SW reports no record (data null)', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: null }));
    const client = createContentPositionClient(apiWith(sendMessage));
    await expect(client.read()).resolves.toBeUndefined();
  });

  it('read() degrades to undefined on an error response (no throw)', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: { kind: 'invalid-payload' } }));
    const client = createContentPositionClient(apiWith(sendMessage));
    await expect(client.read()).resolves.toBeUndefined();
  });

  it('write() sends position/set carrying ONLY wordIndex + totalWords (no url)', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: undefined }));
    const client = createContentPositionClient(apiWith(sendMessage));
    await client.write({ wordIndex: 3, totalWords: 80 });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'position/set',
      wordIndex: 3,
      totalWords: 80,
    });
  });

  it('write() rejects on an error response so callers can log', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: { kind: 'invalid-payload' } }));
    const client = createContentPositionClient(apiWith(sendMessage));
    await expect(client.write({ wordIndex: 1, totalWords: 2 })).rejects.toBeTruthy();
  });

  it('write() rejects with no-response when the SW is asleep (sendMessage → undefined)', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const client = createContentPositionClient(apiWith(sendMessage));
    await expect(client.write({ wordIndex: 1, totalWords: 2 })).rejects.toThrow('no-response');
  });

  it('clear() rejects with no-response when the SW is asleep (sendMessage → undefined)', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const client = createContentPositionClient(apiWith(sendMessage));
    await expect(client.clear()).rejects.toThrow('no-response');
  });

  it('read() degrades to undefined when the SW is asleep (sendMessage → undefined)', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const client = createContentPositionClient(apiWith(sendMessage));
    await expect(client.read()).resolves.toBeUndefined();
  });

  it('clear() sends position/clear with NO url', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: undefined }));
    const client = createContentPositionClient(apiWith(sendMessage));
    await client.clear();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'position/clear' });
  });
});
