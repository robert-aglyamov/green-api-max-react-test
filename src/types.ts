export type Credentials = { apiUrl: string; idInstance: string; apiTokenInstance: string };
export type RawBody = {
  typeWebhook?: string;
  idMessage?: string;
  timestamp?: number;
  chatId?: string;
  status?: string;
  senderData?: { chatId?: string; chatName?: string; senderName?: string; senderPhoneNumber?: number };
  messageData?: {
    typeMessage?: string;
    textMessageData?: { textMessage?: string };
    extendedTextMessageData?: { text?: string };
  };
};
export type Notification = { receiptId: number; body: RawBody };
export type ChatApi = {
  state(signal: AbortSignal): Promise<string>;
  settings(signal: AbortSignal): Promise<{ webhookUrl?: string; incomingWebhook?: string }>;
  resolvePhone(phone: string, signal: AbortSignal): Promise<string>;
  send(chatId: string, text: string, signal: AbortSignal): Promise<string>;
  receive(signal: AbortSignal): Promise<Notification | null>;
  acknowledge(receiptId: number, signal: AbortSignal): Promise<void>;
};
export type MessageStatus = 'sending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown';
export type Message = { id: string; serverId?: string; chatId: string; text: string; outgoing: boolean; timestamp: number; status: MessageStatus };
export type Chat = { id: string; name: string; phone?: string };
export type ChatState = { chats: Chat[]; messages: Message[]; statuses: Record<string, MessageStatus> };
