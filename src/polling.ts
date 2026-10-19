import { ApiError } from './api';
import type { ChatApi, RawBody } from './types';

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollNotifications(
  api: ChatApi, signal: AbortSignal,
  onNotification: (body: RawBody) => void,
  onStatus: (text: string, fatal?: boolean) => void,
) {
  let pendingReceipt: number | null = null;
  let failures = 0;
  while (!signal.aborted) {
    try {
      if (pendingReceipt !== null) {
        // Retry ACK, not receipt processing; one serial consumer, no setInterval overlap.
        await api.acknowledge(pendingReceipt, signal);
        pendingReceipt = null;
      } else {
        const notification = await api.receive(signal);
        if (signal.aborted) return;
        if (notification) {
          onNotification(notification.body);
          pendingReceipt = notification.receiptId;
        } else await delay(250, signal);
      }
      failures = 0;
      if (!signal.aborted) onStatus('Получение подключено');
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError && error.permanent) {
        onStatus(`${error.message} Получение остановлено.`, true);
        return;
      }
      failures += 1;
      const wait = Math.min(2000 * 2 ** (failures - 1), 15_000);
      onStatus(`Сбой получения. Повтор через ${wait / 1000} с.`);
      try { await delay(wait, signal); } catch { return; }
    }
  }
}
