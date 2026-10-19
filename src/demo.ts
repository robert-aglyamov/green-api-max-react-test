import { delay } from './polling';
import type { ChatApi, Notification } from './types';

// Deliberately separate simulation: no fetch, no external services, no real recipient.
export class DemoApi implements ChatApi {
  private queue: { ready: number; notification: Notification }[] = [];
  private counter = 1;
  async state() { return 'authorized'; }
  async settings() { return { incomingWebhook: 'yes' }; }
  async resolvePhone(phone: string) { return `demo:${phone}`; }
  async send(chatId: string, text: string) {
    const id = `demo-out-${this.counter++}`;
    this.queue.push({ ready: Date.now() + 700, notification: { receiptId: this.counter++, body: {
      typeWebhook: 'incomingMessageReceived', idMessage: `demo-in-${this.counter++}`, timestamp: Math.floor(Date.now() / 1000),
      senderData: { chatId, chatName: 'Демо-собеседник' },
      messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: `Получил: «${text}»\nЭто симуляция ответа — реальные сообщения не отправлялись.` } },
    } } });
    return id;
  }
  async receive(signal: AbortSignal) {
    await delay(250, signal);
    return this.queue[0]?.ready <= Date.now() ? this.queue[0].notification : null;
  }
  async acknowledge(receiptId: number) { this.queue = this.queue.filter(x => x.notification.receiptId !== receiptId); }
}
