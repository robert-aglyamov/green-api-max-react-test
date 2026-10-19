import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

afterEach(cleanup);

describe('React interface', () => {
  it('keeps real connection disabled until separate-instance acknowledgement', () => {
    render(<App />);
    expect((screen.getByRole('button', { name: 'Подключиться' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('apiTokenInstance') as HTMLInputElement).type).toBe('password');
  });
  it('runs demo send and receive without a real network request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('network forbidden in demo'));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: 'Открыть деморежим' }));
    expect(screen.getByText('ДЕМОРЕЖИМ')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Проверка 👋{Enter}');
    await waitFor(() => expect(within(screen.getByRole('log')).getByText(/Получил: «Проверка 👋»/)).toBeTruthy(), { timeout: 3000 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('validates recipient without creating a chat', async () => {
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: 'Открыть деморежим' }));
    await user.click(screen.getByRole('button', { name: 'Новый чат' }));
    await user.type(screen.getByLabelText('Телефон получателя'), '123');
    await user.click(screen.getByRole('button', { name: 'Создать чат' }));
    expect(screen.getByRole('alert').textContent).toContain('Для MAX нужен номер');
  });
  it('does not carry private messages across logout and a new session', async () => {
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: 'Открыть деморежим' }));
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'PRIVATE-SESSION-CONTENT{Enter}');
    await user.click(screen.getByRole('button', { name: 'Выйти и очистить сессию' }));
    await user.click(screen.getByRole('button', { name: 'Открыть деморежим' }));
    expect(screen.queryByText('PRIVATE-SESSION-CONTENT')).toBeNull();
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
});
