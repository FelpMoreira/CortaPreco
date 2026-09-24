import { config } from './config.js';

/**
 * Envio pelo WhatsApp via Evolution API (não oficial, baseada no WhatsApp Web).
 * NOTA: API não oficial viola os Termos do WhatsApp — número pode ser banido.
 * Use chip dedicado, aquecido, nunca o número pessoal. Validar com a instância real.
 */
interface EvolutionResponse {
  key?: { id?: string };
  message?: unknown;
  error?: string;
  response?: { message?: unknown };
}

// "digitando…" por alguns segundos antes de enviar: comportamento humano
const typingDelay = () => 1500 + Math.floor(Math.random() * 2500);

async function call(path: string, body: Record<string, unknown>): Promise<string | null> {
  const { url, apiKey, instance } = config.evolution;
  if (!url || !apiKey || !instance) throw new Error('Evolution API não configurada (EVOLUTION_API_URL/KEY/INSTANCE)');
  const res = await fetch(`${url.replace(/\/+$/, '')}/message/${path}/${encodeURIComponent(instance)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as EvolutionResponse;
  if (!res.ok) {
    const detail = json.error ?? JSON.stringify(json.response?.message ?? json).slice(0, 200);
    throw new Error(`WhatsApp (Evolution ${res.status}): ${detail}`);
  }
  return json.key?.id ?? null;
}

// legenda de mídia no WhatsApp: acima disso manda como texto (com prévia do link)
const CAPTION_LIMIT = 1024;

export async function sendWhatsApp(target: string, text: string, imageUrl: string | null): Promise<string | null> {
  if (imageUrl && text.length <= CAPTION_LIMIT) {
    try {
      return await call('sendMedia', {
        number: target,
        mediatype: 'image',
        media: imageUrl,
        caption: text,
        delay: typingDelay(),
      });
    } catch (err) {
      console.warn(`[whatsapp] imagem falhou, enviando texto: ${(err as Error).message}`);
    }
  }
  return call('sendText', { number: target, text, linkPreview: true, delay: typingDelay() });
}
