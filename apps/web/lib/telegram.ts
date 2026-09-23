// Helpers do preview da mensagem (roda no navegador).

const ALLOWED_TAG = /<\/?(b|strong|i|em|u|ins|s|strike|del|code|pre)>/gi;

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Converte o HTML do Telegram em HTML seguro para `dangerouslySetInnerHTML`:
 * só as tags de formatação sem atributos sobrevivem, todo o resto vira texto.
 */
export function telegramToSafeHtml(message: string): string {
  let out = '';
  let last = 0;
  for (const m of message.matchAll(ALLOWED_TAG)) {
    out += escape(decode(message.slice(last, m.index ?? 0)));
    out += m[0].toLowerCase();
    last = (m.index ?? 0) + m[0].length;
  }
  return out + escape(decode(message.slice(last)));
}

/** Tamanho como o Telegram conta (sem as tags, entidades decodificadas). */
export function telegramLength(message: string): number {
  return decode(message.replace(/<[^>]+>/g, '')).length;
}

/** Limite de legenda de foto; acima disso o worker manda só texto. */
export const CAPTION_LIMIT = 1024;
