import { config } from './config.js';

export interface SendResult {
  ok: boolean;
  messageId?: number;
}

const BASE = 'https://api.telegram.org';

/**
 * Grupo comum que virou supergrupo (ex.: ligaram "histórico visível para novos membros") MUDA de ID
 * (-123 → -100…). O Telegram recusa o ID antigo e informa o novo em `parameters.migrate_to_chat_id`.
 * Visto em 2026-09-26: os dois grupos migraram e 45 posts falharam até alguém perceber.
 */
export class ChatMigratedError extends Error {
  constructor(
    readonly oldChatId: string,
    readonly newChatId: string,
  ) {
    super(`Telegram: o grupo virou supergrupo; ID novo ${newChatId}`);
    this.name = 'ChatMigratedError';
  }
}

type TgResponse = {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
  parameters?: { migrate_to_chat_id?: number };
};

function check(json: TgResponse, chatId: string): SendResult {
  if (!json.ok) {
    const moved = json.parameters?.migrate_to_chat_id;
    if (moved) throw new ChatMigratedError(chatId, String(moved));
    throw new Error(`Telegram: ${json.description ?? 'erro desconhecido'}`);
  }
  return { ok: true, messageId: json.result?.message_id };
}

/** Envio direto pela Bot API. Sem dependência do bot app no MVP. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<SendResult> {
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  }
  const res = await fetch(`${BASE}/bot${config.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      disable_notification: false,
    }),
  });
  return check((await res.json()) as TgResponse, chatId);
}

/** Envia com foto do produto (caption em HTML). */
export async function sendTelegramPhoto(chatId: string, photoUrl: string, caption: string): Promise<SendResult> {
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  }
  const res = await fetch(`${BASE}/bot${config.telegramBotToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
      disable_notification: false,
    }),
  });
  return check((await res.json()) as TgResponse, chatId);
}