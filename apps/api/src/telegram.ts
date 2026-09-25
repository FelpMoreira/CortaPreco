// Consultas ao Telegram feitas pela API (validar canal no cadastro e mensagem de teste).
const BASE = 'https://api.telegram.org';

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  const res = await fetch(`${BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({ ok: false }))) as TgResponse<T>;
  // a descrição do Telegram nunca contém o token; seguro repassar
  if (!json.ok || json.result === undefined) {
    const d = json.description ?? `erro ${res.status}`;
    if (/chat not found/i.test(d)) throw new Error('O bot não está nesse grupo/canal, ou o ID está errado. Adicione o bot e use /chatid lá dentro.');
    if (/bot was kicked|not a member/i.test(d)) throw new Error('O bot foi removido desse grupo/canal. Adicione-o de novo como administrador.');
    throw new Error(`Telegram: ${d}`);
  }
  return json.result;
}

/**
 * Confere que o bot enxerga o chat e pode postar. Devolve o título do grupo/canal.
 * `target`: id numérico (-100…) ou @usuario do canal.
 */
export async function checkTelegramChat(target: string): Promise<{ title: string; type: string }> {
  const chat = await call<{ id: number; title?: string; type: string }>('getChat', { chat_id: target });
  const me = await call<{ id: number }>('getMe', {});
  const member = await call<{ status: string; can_post_messages?: boolean }>('getChatMember', { chat_id: target, user_id: me.id });
  const canPost =
    member.status === 'creator' ||
    (member.status === 'administrator' && (chat.type !== 'channel' || member.can_post_messages !== false)) ||
    (member.status === 'member' && chat.type !== 'channel');
  if (!canPost) throw new Error('O bot está no chat, mas não pode postar. Coloque-o como administrador.');
  return { title: chat.title ?? target, type: chat.type };
}

export async function sendTelegramTest(target: string, text: string): Promise<void> {
  await call('sendMessage', { chat_id: target, text, parse_mode: 'HTML', disable_notification: true });
}
