/**
 * Espelhamento de grupo do Telegram: tipos de link que o fluxo sabe converter.
 * Cada tipo tem um conversor próprio no serviço `linker` (navegador logado na conta de afiliado).
 */
export const MIRROR_LINK_TYPES = {
  MERCADOLIVRE: {
    label: 'Mercado Livre',
    hint: 'links meli.la: o linker gera o nosso link no gerador de afiliados (navegador logado)',
  },
  AMAZON: {
    label: 'Amazon',
    hint: 'links amzn.to / amazon.com.br: troca a tag de afiliado de quem postou pela nossa (AMAZON_PARTNER_TAG)',
  },
} as const;

export type MirrorLinkType = keyof typeof MIRROR_LINK_TYPES;
export const MIRROR_LINK_TYPE_KEYS = Object.keys(MIRROR_LINK_TYPES) as MirrorLinkType[];

/** Atraso padrão e máximo (segundos) entre a mensagem no grupo observado e o nosso post. */
export const MIRROR_DEFAULT_MAX_DELAY_SEC = 150;
export const MIRROR_MAX_DELAY_LIMIT_SEC = 600;

/** Qual conversor trata este link (null = o fluxo ignora). Só o host decide: nada é acessado aqui. */
export function mirrorLinkType(url: string): MirrorLinkType | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  // meli.la é o encurtador que o Programa de Afiliados do Mercado Livre gera
  if (host === 'meli.la' || host.endsWith('.meli.la')) return 'MERCADOLIVRE';
  // encurtadores oficiais da Amazon (amzn.to, a.co) ou a loja brasileira direto
  if (host === 'amzn.to' || host === 'a.co' || host === 'amazon.com.br' || host.endsWith('.amazon.com.br')) return 'AMAZON';
  return null;
}

/** Fila BullMQ entre o worker (ouve o Telegram) e o linker (converte no navegador). */
export const MIRROR_QUEUE = 'mirror';
export interface MirrorJob {
  /** SourceEvent criado pelo worker; o linker lê dele o link, a fonte e a hora de postar. */
  eventId: string;
}

/** Chaves de status no Redis (com validade): o painel mostra se cada peça está no ar. */
export const MIRROR_STATUS_KEYS = {
  listener: 'mirror:status:listener',
  linker: 'mirror:status:linker',
} as const;
