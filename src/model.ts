import type { Chat, ChatState, Message, MessageStatus, RawBody } from './types';

export const initialState: ChatState = { chats: [], messages: [], statuses: {} };
export type Action =
  | { type: 'reset' }
  | { type: 'chat'; chat: Chat }
  | { type: 'message'; message: Message }
  | { type: 'sent'; id: string; serverId: string }
  | { type: 'failure'; id: string; uncertain: boolean }
  | { type: 'notification'; body: RawBody };

const ranks: Partial<Record<MessageStatus, number>> = { sending: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };

export function chatReducer(state: ChatState, action: Action): ChatState {
  if (action.type === 'reset') return initialState;
  if (action.type === 'chat') {
    return state.chats.some(c => c.id === action.chat.id) ? state : { ...state, chats: [...state.chats, action.chat] };
  }
  if (action.type === 'message') {
    if (state.messages.some(m => m.id === action.message.id)) return state;
    return { ...state, messages: [...state.messages, action.message] };
  }
  if (action.type === 'sent') {
    // A server echo can arrive before the POST response; collapse it into the optimistic row.
    const echo = state.messages.find(m => m.id !== action.id && m.serverId === action.serverId);
    const savedStatus = state.statuses[action.serverId];
    return { ...state, messages: state.messages.filter(m => m !== echo).map(m => m.id === action.id
      ? { ...m, serverId: action.serverId, status: savedStatus ?? echo?.status ?? 'accepted' } : m) };
  }
  if (action.type === 'failure') return { ...state, messages: state.messages.map(m => m.id === action.id ? { ...m, status: action.uncertain ? 'unknown' : 'failed' } : m) };
  const body = action.body;
  if (body.typeWebhook === 'outgoingMessageStatus' && body.idMessage) {
    const status = body.status as MessageStatus;
    if (!Object.hasOwn(ranks, status)) return state;
    const previous = state.statuses[body.idMessage];
    const newest = (ranks[previous] ?? -1) > (ranks[status] ?? -1) ? previous : status;
    return { ...state, statuses: { ...state.statuses, [body.idMessage]: newest }, messages: state.messages.map(m => m.serverId === body.idMessage && (ranks[newest] ?? 0) > (ranks[m.status] ?? 0) ? { ...m, status: newest } : m) };
  }
  const supported = ['incomingMessageReceived', 'outgoingMessageReceived', 'outgoingAPIMessageReceived'];
  const chatId = body.senderData?.chatId;
  const text = body.messageData?.textMessageData?.textMessage ?? body.messageData?.extendedTextMessageData?.text;
  if (!supported.includes(body.typeWebhook ?? '') || !body.idMessage || !chatId || typeof text !== 'string') return state;
  const outgoing = body.typeWebhook !== 'incomingMessageReceived';
  if (state.messages.some(m => m.serverId === body.idMessage && m.chatId === chatId)) return state;
  const chats = state.chats.some(c => c.id === chatId) ? state.chats : [...state.chats, {
    id: chatId, name: body.senderData?.chatName || body.senderData?.senderName || chatId,
  }];
  return { ...state, chats, messages: [...state.messages, {
    id: `remote:${chatId}:${body.idMessage}`, serverId: body.idMessage, chatId, text, outgoing,
    timestamp: body.timestamp ? body.timestamp * 1000 : Date.now(), status: outgoing ? state.statuses[body.idMessage] ?? 'sent' : 'accepted',
  }] };
}
