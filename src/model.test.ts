// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chatReducer, initialState } from './model';
import type { Message, RawBody } from './types';

const body: RawBody = { typeWebhook: 'incomingMessageReceived', idMessage: 'server-1', timestamp: 1760000000, senderData: { chatId: '100', chatName: 'Тестовый контакт' }, messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Привет' } } };
const outgoing: Message = { id: 'local-1', chatId: '100', text: 'Привет', timestamp: 1, outgoing: true, status: 'sending' };

describe('chat state', () => {
  it('routes an incoming text to its canonical chat', () => {
    const next = chatReducer(initialState, { type: 'notification', body });
    expect(next.chats[0].id).toBe('100'); expect(next.messages[0].text).toBe('Привет'); expect(next.messages[0].timestamp).toBe(1760000000000);
  });
  it('deduplicates repeated notification delivery', () => {
    const once = chatReducer(initialState, { type: 'notification', body });
    expect(chatReducer(once, { type: 'notification', body }).messages).toHaveLength(1);
  });
  it('ignores media and service notifications in text UI', () => {
    expect(chatReducer(initialState, { type: 'notification', body: { typeWebhook: 'stateInstanceChanged' } })).toEqual(initialState);
    expect(chatReducer(initialState, { type: 'notification', body: { ...body, messageData: { typeMessage: 'imageMessage' } } })).toEqual(initialState);
  });
  it('marks POST success as accepted, not delivered', () => {
    const state = chatReducer(initialState, { type: 'message', message: outgoing });
    expect(chatReducer(state, { type: 'sent', id: 'local-1', serverId: 'server-1' }).messages[0].status).toBe('accepted');
  });
  it('merges API echo arriving before POST response', () => {
    let state = chatReducer(initialState, { type: 'message', message: outgoing });
    state = chatReducer(state, { type: 'notification', body: { ...body, typeWebhook: 'outgoingAPIMessageReceived' } });
    state = chatReducer(state, { type: 'sent', id: 'local-1', serverId: 'server-1' });
    expect(state.messages).toHaveLength(1); expect(state.messages[0].serverId).toBe('server-1');
  });
  it('remembers a read event arriving before POST response', () => {
    let state = chatReducer(initialState, { type: 'message', message: outgoing });
    state = chatReducer(state, { type: 'notification', body: { typeWebhook: 'outgoingMessageStatus', idMessage: 'server-1', status: 'read' } });
    state = chatReducer(state, { type: 'sent', id: 'local-1', serverId: 'server-1' });
    expect(state.messages[0].status).toBe('read');
    state = chatReducer(state, { type: 'notification', body: { typeWebhook: 'outgoingMessageStatus', idMessage: 'server-1', status: 'sent' } });
    expect(state.messages[0].status).toBe('read');
  });
  it('does not confuse text in different chats', () => {
    let state = chatReducer(initialState, { type: 'notification', body });
    state = chatReducer(state, { type: 'notification', body: { ...body, idMessage: 'server-2', senderData: { chatId: '200' } } });
    expect(state.chats).toHaveLength(2); expect(state.messages.map(m => m.chatId)).toEqual(['100', '200']);
  });
  it('clears all messages and delivery state on logout', () => {
    const state = chatReducer(initialState, { type: 'notification', body });
    expect(chatReducer(state, { type: 'reset' })).toEqual({ chats: [], messages: [], statuses: {} });
  });
});
