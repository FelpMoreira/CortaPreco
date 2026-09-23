import { config } from './config.js';

export interface SendResult {
  ok: boolean;
  messageId?: number;
}

/** Envio direto pela Bot API (sendMessage). Sem dependência do bot app no MVP. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<SendResult> {
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  }
  const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
      disable_notification: false,
    }),
  });
  const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
  if (!json.ok) {
    throw new Error(`Telegram: ${json.description ?? 'erro desconhecido'}`);
  }
  return { ok: true, messageId: json.result?.message_id };
}