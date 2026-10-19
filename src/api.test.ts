// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ApiError, GreenApi, normalizePhone, validateCredentials } from './api';

const credentials = { apiUrl: 'https://3100.api.green-api.com', idInstance: '3100000000', apiTokenInstance: 'synthetic-token-not-a-secret' };
const signal = () => new AbortController().signal;
function withResponse(body: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return { api: new GreenApi(credentials, fetcher as typeof fetch), fetcher };
}

describe('input validation', () => {
  it.each([['+7 (999) 123-45-67', '79991234567'], ['8 999 123 45 67', '79991234567'], ['+375 29 123-45-67', '375291234567']])('normalizes %s', (input, normalized) => expect(normalizePhone(input)).toBe(normalized));
  it.each(['123', '79991234567@c.us', 'https://example.com', '+1 202 555 0100'])('rejects %s', value => expect(() => normalizePhone(value)).toThrow());
  it.each(['http://api.green-api.com', 'https://api.green-api.com.evil.test', 'https://green-api.com@evil.test', 'https://api.green-api.com/path', 'https://evil.test'])('refuses token exfiltration host %s', apiUrl => expect(() => validateCredentials({ ...credentials, apiUrl })).toThrow());
  it('trims credentials without storing them elsewhere', () => expect(validateCredentials({ ...credentials, idInstance: ' 3100000000 ', apiUrl: 'https://3100.api.green-api.com/' }).idInstance).toBe('3100000000'));
});

describe('GREEN-API adapter', () => {
  it('resolves phone to canonical MAX chatId', async () => {
    const { api, fetcher } = withResponse({ exist: true, chatId: '10000001' });
    expect(await api.resolvePhone('+7 999 123-45-67', signal())).toBe('10000001');
    expect(fetcher.mock.calls[0][0]).toBe(`${credentials.apiUrl}/waInstance3100000000/checkAccount/${credentials.apiTokenInstance}`);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ phoneNumber: 79991234567 });
  });
  it('does not create a fabricated chat when MAX account is absent', async () => {
    await expect(withResponse({ exist: false, chatId: '' }).api.resolvePhone('79991234567', signal())).rejects.toThrow('не найден');
  });
  it('sends the exact text once; API acceptance is not delivery', async () => {
    const { api, fetcher } = withResponse({ idMessage: 'server-1' });
    expect(await api.send('10000001', 'Привет\nВторая строка 👋', signal())).toBe('server-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ chatId: '10000001', message: 'Привет\nВторая строка 👋' });
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    expect(fetcher.mock.calls[0][1].credentials).toBe('omit');
  });
  it('rejects blank messages without HTTP request', async () => {
    const { api, fetcher } = withResponse({});
    await expect(api.send('1', ' \n ', signal())).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts empty long-poll response', async () => expect(await withResponse(null).api.receive(signal())).toBeNull());
  it('refuses malformed notification; does not invent receiptId', async () => await expect(withResponse({ body: {} }).api.receive(signal())).rejects.toThrow('формат'));
  it('acknowledges the exact receipt with DELETE', async () => {
    const { api, fetcher } = withResponse({ result: true });
    await api.acknowledge(123, signal());
    expect(fetcher.mock.calls[0][0]).toContain('/deleteNotification/synthetic-token-not-a-secret/123');
    expect(fetcher.mock.calls[0][1].method).toBe('DELETE');
  });
  it('does not claim an unsuccessful ACK succeeded', async () => await expect(withResponse({ result: false }).api.acknowledge(123, signal())).rejects.toThrow('не подтверждено'));
  it('surfaces authentication failure without token or raw response', async () => {
    const { api } = withResponse({ error: credentials.apiTokenInstance }, 401);
    try { await api.state(signal()); throw Error('must fail'); }
    catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as Error).message).not.toContain(credentials.apiTokenInstance); expect((error as ApiError).permanent).toBe(true); }
  });
  it('marks network failure on send as uncertain and never retries', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(`fetch failed: ${credentials.apiTokenInstance}`));
    const api = new GreenApi(credentials, fetcher as typeof fetch);
    try { await api.send('10000001', 'Привет', signal()); throw Error('must fail'); }
    catch (error) { expect((error as ApiError).uncertain).toBe(true); expect((error as Error).message).not.toContain(credentials.apiTokenInstance); }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('marks a 5xx send result as uncertain', async () => {
    await expect(withResponse({}, 503).api.send('1', 'Привет', signal())).rejects.toMatchObject({ uncertain: true });
  });
  it('honors caller cancellation without retry', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn().mockRejectedValue(controller.signal.reason);
    await expect(new GreenApi(credentials, fetcher as typeof fetch).state(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
