// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { pollNotifications } from './polling';
import type { ChatApi } from './types';

afterEach(() => vi.useRealTimers());
const event = { receiptId: 17, body: { typeWebhook: 'incomingMessageReceived', idMessage: 'message-1' } };
function api() {
  return { state: vi.fn(), settings: vi.fn(), resolvePhone: vi.fn(), send: vi.fn(), receive: vi.fn(), acknowledge: vi.fn().mockResolvedValue(undefined) } satisfies ChatApi;
}

describe('serial HTTP polling', () => {
  it('processes before ACK and requests the next item only afterwards', async () => {
    const controller = new AbortController(), client = api(), order: string[] = [];
    client.receive.mockResolvedValueOnce(event).mockImplementation(async () => { order.push('next'); controller.abort(); return null; });
    client.acknowledge.mockImplementation(async () => { order.push('ack'); });
    await pollNotifications(client, controller.signal, () => order.push('process'), vi.fn());
    expect(order).toEqual(['process', 'ack', 'next']);
    expect(client.acknowledge.mock.calls[0][0]).toBe(17);
  });
  it('retries a failed ACK without reprocessing or consuming the next item', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(), client = api(), process = vi.fn();
    client.receive.mockResolvedValueOnce(event).mockImplementation(async () => { controller.abort(); return null; });
    client.acknowledge.mockRejectedValueOnce(new ApiError('temporary', 503)).mockResolvedValue(undefined);
    const task = pollNotifications(client, controller.signal, process, vi.fn());
    await vi.advanceTimersByTimeAsync(2000); await task;
    expect(client.acknowledge).toHaveBeenCalledTimes(2); expect(process).toHaveBeenCalledTimes(1); expect(client.receive).toHaveBeenCalledTimes(2);
  });
  it('stops on bad credentials instead of retrying indefinitely', async () => {
    const client = api(), status = vi.fn(); client.receive.mockRejectedValue(new ApiError('invalid token', 401));
    await pollNotifications(client, new AbortController().signal, vi.fn(), status);
    expect(client.receive).toHaveBeenCalledTimes(1); expect(status).toHaveBeenLastCalledWith(expect.stringContaining('остановлено'), true);
  });
  it('does not ACK an event whose handler failed', async () => {
    vi.useFakeTimers();
    const client = api(), controller = new AbortController(); client.receive.mockResolvedValue(event);
    const task = pollNotifications(client, controller.signal, () => { throw Error('not processed'); }, vi.fn());
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await task;
    expect(client.acknowledge).not.toHaveBeenCalled();
  });
});
