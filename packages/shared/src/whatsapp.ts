/**
 * Converte a mensagem no HTML do Telegram para a formatação do WhatsApp
 * (*negrito*, _itálico_, ~riscado~, ```mono```). O admin edita um texto só;
 * cada canal recebe no próprio formato.
 */
const MARKS: Record<string, string> = {
  b: '*',
  strong: '*',
  i: '_',
  em: '_',
  s: '~',
  strike: '~',
  del: '~',
  code: '```',
  pre: '```',
};

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

export function telegramHtmlToWhatsApp(html: string): string {
  const out = html
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (_m, href: string, text: string) =>
      text && text !== href ? `${text} ${href}` : href,
    )
    .replace(/<\/?([a-z]+)[^>]*>/gi, (_m, tag: string) => MARKS[tag.toLowerCase()] ?? '');
  // marcador colado em espaço não formata no WhatsApp: "* texto *" → "*texto*"
  return decode(out)
    .replace(/([*_~])\s+/g, (m, c: string, off: number, str: string) => (isOpening(str, off) ? c : m))
    .replace(/[ \t]+\n/g, '\n');
}

// marcador de abertura = precedido por início, espaço ou pontuação
function isOpening(str: string, off: number): boolean {
  return off === 0 || /[\s(\[]/.test(str[off - 1] ?? ' ');
}
