import type { ChatApi, Credentials, Notification } from './types';

export class ApiError extends Error {
  constructor(message: string, public readonly status = 0, public readonly uncertain = false) {
    super(message);
    this.name = 'ApiError';
  }
  get permanent() { return [400, 401, 403, 404, 469].includes(this.status); }
}

export function normalizePhone(raw: string): string {
  if (!/^[+\d\s()\-]+$/.test(raw)) throw new Error('Введите номер телефона, а не ссылку или chatId.');
  let phone = raw.replace(/\D/g, '');
  if (/^8\d{10}$/.test(phone)) phone = `7${phone.slice(1)}`;
  if (!/^(7\d{10}|375\d{9})$/.test(phone)) {
    throw new Error('Для MAX нужен номер РФ (+7, 11 цифр) или Беларуси (+375, 12 цифр).');
  }
  return phone;
}

export function validateCredentials(input: Credentials): Credentials {
  const apiUrl = input.apiUrl.trim().replace(/\/$/, '');
  // Never send a user's token to an arbitrary user-supplied host.
  if (!/^https:\/\/(?:[a-z0-9-]+\.)+green-api\.com$/i.test(apiUrl)) {
    throw new Error('apiUrl должен быть HTTPS-адресом GREEN-API из личного кабинета, без пути.');
  }
  const idInstance = input.idInstance.trim();
  const apiTokenInstance = input.apiTokenInstance.trim();
  if (!/^\d{5,20}$/.test(idInstance)) throw new Error('Проверьте idInstance: ожидаются только цифры.');
  if (!/^[a-zA-Z0-9_-]{8,256}$/.test(apiTokenInstance)) throw new Error('Введите apiTokenInstance из личного кабинета.');
  return { apiUrl, idInstance, apiTokenInstance };
}

export class GreenApi implements ChatApi {
  private readonly credentials: Credentials;
  constructor(input: Credentials, private readonly fetcher: typeof fetch = fetch) {
    this.credentials = validateCredentials(input);
  }
  private async request<T>(method: string, action: string, signal: AbortSignal, body?: object, suffix = ''): Promise<T> {
    const { apiUrl, idInstance, apiTokenInstance } = this.credentials;
    const url = `${apiUrl}/waInstance${idInstance}/${action}/${encodeURIComponent(apiTokenInstance)}${suffix}`;
    try {
      const response = await this.fetcher(url, {
        method, signal: AbortSignal.any([signal, AbortSignal.timeout(action === 'receiveNotification' ? 30_000 : 20_000)]),
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
      });
      if (!response.ok) {
        const explanations: Record<number, string> = {
          400: 'GREEN-API отклонил запрос. Проверьте параметры и настройки HTTP API.',
          401: 'Неверные учётные данные GREEN-API.', 403: 'Нет доступа: проверьте токен и тариф инстанса.',
          404: 'Инстанс или метод не найден. Проверьте apiUrl и idInstance.',
          429: 'Лимит запросов GREEN-API. Подождите перед следующей попыткой.',
          469: 'MAX ограничил поиск номеров. Остановите проверки и повторите позже.',
        };
        throw new ApiError(explanations[response.status] ?? `Сервис временно недоступен (HTTP ${response.status}).`, response.status, method === 'POST' && action === 'sendMessage' && response.status >= 500);
      }
      try { return await response.json() as T; }
      catch { throw new ApiError('GREEN-API вернул некорректный ответ.', 502, action === 'sendMessage'); }
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      if (error instanceof ApiError) throw error;
      // Do not include URL / raw provider body / fetch exception: they may contain the token.
      throw new ApiError('Не удалось получить ответ. Проверьте сеть и apiUrl; при работе в браузере возможна ошибка CORS.', 0, action === 'sendMessage');
    }
  }
  async state(signal: AbortSignal) {
    const data = await this.request<{ stateInstance?: string }>('GET', 'getStateInstance', signal);
    return data.stateInstance ?? 'unknown';
  }
  settings(signal: AbortSignal) {
    return this.request<{ webhookUrl?: string; incomingWebhook?: string }>('GET', 'getSettings', signal);
  }
  async resolvePhone(phone: string, signal: AbortSignal) {
    const data = await this.request<{ exist?: boolean; chatId?: string }>('POST', 'checkAccount', signal, { phoneNumber: Number(normalizePhone(phone)) });
    if (!data.exist || typeof data.chatId !== 'string' || !data.chatId) throw new ApiError('MAX-аккаунт не найден или скрыт настройками приватности.');
    return data.chatId;
  }
  async send(chatId: string, text: string, signal: AbortSignal) {
    if (!text.trim() || text.length > 4000) throw new ApiError('Сообщение должно содержать от 1 до 4000 символов.');
    const data = await this.request<{ idMessage?: string }>('POST', 'sendMessage', signal, { chatId, message: text });
    if (typeof data.idMessage !== 'string' || !data.idMessage) throw new ApiError('API не вернул ID отправки. Не повторяйте отправку автоматически.', 502, true);
    return data.idMessage;
  }
  async receive(signal: AbortSignal) {
    const data = await this.request<Notification | null>('GET', 'receiveNotification', signal, undefined, '?receiveTimeout=5');
    if (data === null) return null;
    if (!data || !Number.isSafeInteger(data.receiptId) || data.receiptId <= 0 || typeof data.body !== 'object' || !data.body) {
      throw new ApiError('Неверный формат уведомления. Очередь не подтверждена.', 400);
    }
    return data;
  }
  async acknowledge(receiptId: number, signal: AbortSignal) {
    const data = await this.request<{ result?: boolean }>('DELETE', 'deleteNotification', signal, undefined, `/${receiptId}`);
    if (data.result !== true) throw new ApiError('Уведомление не подтверждено или уже обработано другим клиентом. Используйте отдельный тестовый инстанс.', 400);
  }
}
