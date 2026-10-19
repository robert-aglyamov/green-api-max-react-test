import { useEffect, useReducer, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError, GreenApi, normalizePhone } from './api';
import { DemoApi } from './demo';
import { chatReducer, initialState } from './model';
import { pollNotifications } from './polling';
import type { ChatApi, Credentials, MessageStatus } from './types';

type Session = { api: ChatApi; demo: boolean; controller: AbortController };
const emptyCredentials: Credentials = { apiUrl: 'https://api.green-api.com', idInstance: '', apiTokenInstance: '' };
const statusLabels: Record<MessageStatus, string> = {
  sending: 'Отправляется', accepted: 'Принято API', sent: 'Отправлено',
  delivered: 'Доставлено', read: 'Прочитано', failed: 'Ошибка отправки', unknown: 'Исход неизвестен',
};
const time = (timestamp: number) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(timestamp);

function Icon({ name }: { name: 'chat' | 'plus' | 'send' | 'back' | 'exit' | 'lock' }) {
  const paths = {
    chat: 'M5 5h14v11H9l-4 4V5Z', plus: 'M12 5v14M5 12h14', send: 'm3 3 19 9-19 9 4-9-4-9Zm4 9h15',
    back: 'm14 5-7 7 7 7', exit: 'M10 4H4v16h6m5-13 5 5-5 5m-7-5h12', lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function App() {
  const [credentials, setCredentials] = useState<Credentials>(emptyCredentials);
  const [consent, setConsent] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const connectionAbort = useRef<AbortController | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [selected, setSelected] = useState<string | null>(null);
  const [newChat, setNewChat] = useState(false);
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState('');
  const [chatError, setChatError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('Подключение получения…');
  const [pollFatal, setPollFatal] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const chat = state.chats.find(c => c.id === selected);
  const messages = state.messages.filter(m => m.chatId === selected);
  const draft = selected ? drafts[selected] ?? '' : '';

  useEffect(() => () => connectionAbort.current?.abort(), []);
  useEffect(() => {
    if (!session) return;
    const local = new AbortController();
    const signal = AbortSignal.any([local.signal, session.controller.signal]);
    void pollNotifications(session.api, signal,
      body => { if (!signal.aborted) dispatch({ type: 'notification', body }); },
      (text, fatal) => { if (!signal.aborted) { setConnectionStatus(text); setPollFatal(Boolean(fatal)); } },
    );
    return () => local.abort();
  }, [session]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [selected, state.messages.length]);

  function enterSession(api: ChatApi, demo: boolean) {
    setError(''); setPollFatal(false); setConnectionStatus('Подключение получения…');
    setSession({ api, demo, controller: new AbortController() });
    setCredentials(emptyCredentials); setConsent(false);
    if (demo) {
      const id = 'demo:70000000000';
      dispatch({ type: 'chat', chat: { id, name: 'Демо-собеседник' } });
      dispatch({ type: 'message', message: {
        id: 'demo-welcome', chatId: id, outgoing: false, timestamp: Date.now(), status: 'accepted',
        text: 'Привет! Здесь можно проверить интерфейс: отправьте сообщение, и я отвечу.\nДеморежим не подключается к MAX и ничего не отправляет реальным людям.',
      } });
      setSelected(id);
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (connectingRef.current || !consent) return;
    connectingRef.current = true; setConnecting(true); setError('');
    const controller = new AbortController(); connectionAbort.current = controller;
    try {
      const api = new GreenApi(credentials);
      const instanceState = await api.state(controller.signal);
      if (instanceState !== 'authorized') throw new Error(`Инстанс не авторизован (${instanceState}). Сначала подключите MAX в кабинете GREEN-API.`);
      const settings = await api.settings(controller.signal);
      if (settings.webhookUrl?.trim()) throw new Error('У инстанса настроен webhook. Не отключайте рабочую интеграцию: используйте отдельный тестовый инстанс с HTTP API.');
      if (settings.incomingWebhook === 'no') throw new Error('В кабинете GREEN-API включите входящие уведомления для тестового инстанса. Приложение само настройки не меняет.');
      if (!controller.signal.aborted) enterSession(api, false);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Не удалось подключиться.'); }
    finally { connectingRef.current = false; setConnecting(false); }
  }

  function disconnect() {
    session?.controller.abort(); connectionAbort.current?.abort();
    setSession(null); setSelected(null); setNewChat(false); setPhone(''); setDrafts({});
    setSending(false); sendingRef.current = false; setCreating(false); creatingRef.current = false;
    setCredentials(emptyCredentials); setConsent(false); setError(''); setChatError('');
    dispatch({ type: 'reset' });
  }

  async function createChat(event: FormEvent) {
    event.preventDefault();
    if (!session || creatingRef.current) return;
    setChatError('');
    try {
      const normalized = normalizePhone(phone);
      const existing = state.chats.find(c => c.phone === normalized);
      if (existing) { setSelected(existing.id); setNewChat(false); setPhone(''); return; }
      creatingRef.current = true; setCreating(true);
      const id = await session.api.resolvePhone(normalized, session.controller.signal);
      if (session.controller.signal.aborted) return;
      dispatch({ type: 'chat', chat: { id, name: session.demo ? 'Демо-собеседник' : `+${normalized}`, phone: normalized } });
      setSelected(id); setNewChat(false); setPhone('');
    } catch (caught) { if (!session.controller.signal.aborted) setChatError(caught instanceof Error ? caught.message : 'Не удалось создать чат.'); }
    finally { if (!session.controller.signal.aborted) { creatingRef.current = false; setCreating(false); } }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!session || !selected || !draft.trim() || draft.length > 4000 || sendingRef.current) return;
    const currentChat = selected; const text = draft; const id = crypto.randomUUID();
    sendingRef.current = true; setSending(true); setError('');
    setDrafts(old => ({ ...old, [currentChat]: '' }));
    dispatch({ type: 'message', message: { id, chatId: currentChat, text, outgoing: true, timestamp: Date.now(), status: 'sending' } });
    try {
      const serverId = await session.api.send(currentChat, text, session.controller.signal);
      if (!session.controller.signal.aborted) dispatch({ type: 'sent', id, serverId });
    } catch (caught) {
      if (session.controller.signal.aborted) return;
      const uncertain = caught instanceof ApiError && caught.uncertain;
      dispatch({ type: 'failure', id, uncertain });
      setError(uncertain ? 'Сервис не подтвердил результат отправки. Сообщение могло уйти — проверьте MAX перед ручным повтором. Автоповтора нет.' : caught instanceof Error ? caught.message : 'Не удалось отправить сообщение.');
    } finally { if (!session.controller.signal.aborted) { sendingRef.current = false; setSending(false); } }
  }

  if (!session) return <main className="login-page">
    <section className="intro">
      <span className="brand"><span className="brand-mark"><Icon name="chat" /></span>MAX <small>React client</small></span>
      <div><p className="eyebrow">ТЕСТОВОЕ ЗАДАНИЕ · GREEN-API</p><h1>Начнём<br />с сообщения.</h1><p className="intro-copy">Простой чат. Настоящая интеграция.<br />Только то, что нужно для диалога.</p></div>
      <p className="intro-foot">React · TypeScript · HTTP API<br /><span>Роберт Аглямов</span></p>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={connect}>
        <div className="card-icon"><Icon name="lock" /></div>
        <h2>Подключить MAX</h2><p className="muted">Введите данные отдельного тестового инстанса из кабинета GREEN-API.</p>
        <Field label="apiUrl"><input type="url" autoComplete="off" required value={credentials.apiUrl} onChange={e => setCredentials({ ...credentials, apiUrl: e.target.value })} placeholder="https://3100.api.green-api.com" /></Field>
        <Field label="idInstance"><input inputMode="numeric" autoComplete="off" required value={credentials.idInstance} onChange={e => setCredentials({ ...credentials, idInstance: e.target.value })} placeholder="Идентификатор инстанса" /></Field>
        <Field label="apiTokenInstance"><input type="password" autoComplete="off" required value={credentials.apiTokenInstance} onChange={e => setCredentials({ ...credentials, apiTokenInstance: e.target.value })} placeholder="Секретный токен" /></Field>
        <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>Это отдельный тестовый инстанс. После обработки приложение удаляет уведомления из его очереди. История чата и токен хранятся только до выхода или обновления страницы.</span></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={!consent || connecting} type="submit">{connecting ? 'Проверяем подключение…' : 'Подключиться'}<span aria-hidden="true">↗</span></button>
        <div className="divider"><span>или сначала посмотрите</span></div>
        <button className="secondary" type="button" disabled={connecting} onClick={() => enterSession(new DemoApi(), true)}>Открыть деморежим</button>
        <p className="privacy-note">Без регистрации в приложении. Без аналитики.<br />В деморежиме нет реальных API-запросов.</p>
      </form>
      <p className="disclaimer">Учебный клиент. Не является официальным приложением MAX.</p>
    </section>
  </main>;

  return <div className={`app-shell ${selected ? 'has-selection' : ''}`}>
    {session.demo && <div className="demo-banner"><span className="demo-dot" />ДЕМОРЕЖИМ<span>Ответы симулируются. Связи с MAX нет.</span></div>}
    <main className="workspace">
      <aside className="sidebar" aria-label="Список чатов">
        <header className="sidebar-header"><span className="brand"><span className="brand-mark"><Icon name="chat" /></span>MAX <small>React</small></span><button className="icon-button" aria-label="Выйти и очистить сессию" title="Выйти и очистить сессию" onClick={disconnect}><Icon name="exit" /></button></header>
        <div className="sidebar-title"><h1>Сообщения <span>{state.chats.length}</span></h1><button className="icon-button new-button" aria-label="Новый чат" onClick={() => { setNewChat(true); setChatError(''); }}><Icon name="plus" /></button></div>
        <p className={`connection ${pollFatal ? 'connection-error' : ''}`} role="status"><span />{session.demo ? 'Симуляция HTTP API' : connectionStatus}</p>
        <nav className="chat-list" aria-label="Диалоги">
          {state.chats.map(item => {
            const last = state.messages.filter(m => m.chatId === item.id).at(-1);
            return <button key={item.id} className={`chat-item ${selected === item.id ? 'active' : ''}`} onClick={() => { setSelected(item.id); setError(''); }} aria-current={selected === item.id ? 'true' : undefined}>
              <span className="avatar">{item.name[0] === '+' ? '#' : item.name[0]}</span>
              <span className="chat-item-body"><span className="chat-item-top"><strong>{item.name}</strong><time>{last ? time(last.timestamp) : ''}</time></span><span className="preview">{last?.text ?? 'Начните диалог'}</span></span>
            </button>;
          })}
          {state.chats.length === 0 && <div className="no-chats"><Icon name="chat" /><p>Пока нет диалогов</p><span>Нажмите + и введите номер получателя.</span></div>}
        </nav>
        <footer className="sidebar-footer"><span className="green-dot" />{session.demo ? 'Демонстрация · без отправок' : 'GREEN-API · только текст'}<small>Данные только в текущей сессии</small></footer>
      </aside>
      <section className="conversation" aria-label="Переписка">
        {chat ? <>
          <header className="conversation-header"><button className="icon-button back-button" aria-label="К списку чатов" onClick={() => setSelected(null)}><Icon name="back" /></button><span className="avatar small">{chat.name[0] === '+' ? '#' : chat.name[0]}</span><div><h2>{chat.name}</h2><p>{session.demo ? 'Демо-собеседник · симуляция' : 'MAX · текстовые сообщения'}</p></div><span className="session-tag">Текущая сессия</span></header>
          {!session.demo && pollFatal && <p className="error polling-alert" role="alert">{connectionStatus} Выйдите и подключитесь после проверки настроек.</p>}
          <div className="message-scroll" role="log" aria-label="Сообщения" aria-live="polite" aria-relevant="additions">
            <div className="session-note">История до подключения не загружается</div>
            {messages.length === 0 && <div className="conversation-empty"><div className="empty-symbol"><Icon name="chat" /></div><h3>Всё начинается с «Привет»</h3><p>Напишите первое сообщение.<br />Ответ появится здесь автоматически.</p></div>}
            {messages.map(message => <article key={message.id} className={`message ${message.outgoing ? 'outgoing' : 'incoming'} ${['failed', 'unknown'].includes(message.status) ? 'message-error' : ''}`}>
              <p>{message.text}</p><footer><time dateTime={new Date(message.timestamp).toISOString()}>{time(message.timestamp)}</time>{message.outgoing && <span className="message-status" aria-label={statusLabels[message.status]}>{statusLabels[message.status]}</span>}</footer>
            </article>)}<div ref={end} />
          </div>
          <div className="composer-wrap">{error && <p className="error" role="alert">{error}</p>}<form className="composer" onSubmit={send}>
            <label className="sr-only" htmlFor="message-input">Сообщение</label>
            <textarea id="message-input" rows={1} value={draft} placeholder="Написать сообщение…" maxLength={4000} onChange={e => setDrafts(old => ({ ...old, [selected!]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            <button className="send-button" type="submit" aria-label="Отправить сообщение" disabled={!draft.trim() || sending}><Icon name="send" /></button>
          </form><div className="composer-help"><span>Enter — отправить · Shift+Enter — новая строка</span><span>{draft.length}/4000</span></div></div>
        </> : <div className="welcome"><div className="empty-symbol"><Icon name="chat" /></div><h2>Ваши диалоги — здесь</h2><p>Создайте чат по номеру телефона<br />и начните переписку в MAX.</p><button className="primary" onClick={() => { setNewChat(true); setChatError(''); }}><Icon name="plus" />Новый чат</button></div>}
      </section>
    </main>
    {newChat && <div className="modal-backdrop" onKeyDown={e => { if (e.key === 'Escape' && !creating) setNewChat(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-chat-title"><form onSubmit={createChat}>
      <div className="modal-heading"><h2 id="new-chat-title">Новый диалог</h2><button type="button" className="icon-button" aria-label="Закрыть" disabled={creating} onClick={() => setNewChat(false)}>×</button></div>
      <p className="muted">Номер РФ или Беларуси. MAX chatId получим через CheckAccount.</p>
      <Field label="Телефон получателя"><input type="tel" autoFocus value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 999 123-45-67" required /></Field>
      {chatError && <p className="error" role="alert">{chatError}</p>}
      <button type="submit" className="primary" disabled={creating}>{creating ? 'Проверяем номер…' : 'Создать чат'}</button>
    </form></section></div>}
  </div>;
}
