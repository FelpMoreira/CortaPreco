/**
 * Categorias dos grupos de ofertas. Cada canal escolhe as que recebe (nenhuma = recebe tudo).
 * O classificador por palavra-chave dá o primeiro palpite; o admin confirma ou troca no painel.
 */
export const CATEGORIES = [
  { slug: 'games', label: 'Games', words: ['ps5', 'ps4', 'playstation', 'xbox', 'nintendo', 'switch', 'dualsense', 'controle sem fio', 'joystick', 'gamer', 'gaming', 'game', 'jogo', 'headset gamer', 'console', 'steam',
    // periféricos e hardware de PC gamer (2026-09-26: "Teclado Mecânico AJAZZ" caía em eletrônicos e ia para o geral)
    'teclado mecânico', 'teclado mecanico', 'mouse gamer', 'headset', 'mousepad', 'gabinete', 'placa de vídeo', 'placa de video', 'water cooler', 'cadeira gamer', 'controlador de jogo', 'gamepad', 'rtx', 'radeon', 'ryzen'] },
  { slug: 'eletronicos', label: 'Eletrônicos', words: ['fone', 'bluetooth', 'celular', 'smartphone', 'smartwatch', 'relógio inteligente', 'carregador', 'cabo usb', 'usb-c', 'notebook', 'mouse', 'teclado', 'monitor', 'câmera', 'camera', 'tablet', 'echo dot', 'alexa', 'caixa de som', 'pilha', 'filtro de linha', 'ssd', 'pendrive', 'webcam', 'tv ', 'projetor', 'drone', 'powerbank', 'power bank'] },
  { slug: 'casa', label: 'Casa e cozinha', words: ['cozinha', 'panela', 'liquidificador', 'air fryer', 'fritadeira', 'sanduicheira', 'chaleira', 'cafeteira', 'organizador', 'detergente', 'lava louça', 'lava louças', 'limpeza', 'desinfetante', 'toalha', 'lençol', 'travesseiro', 'luminária', 'fita led', 'decoração', 'pinça', 'utensílio', 'garrafa', 'copo', 'aspirador', 'ventilador', 'balança'] },
  { slug: 'moda', label: 'Moda', words: ['camiseta', 'camisa', 'calça', 'vestido', 'jaqueta', 'moletom', 'tênis', 'sapato', 'sandália', 'bolsa', 'mochila', 'óculos', 'relógio', 'bermuda', 'meia', 'cueca', 'sutiã', 'boné', 'carteira'] },
  { slug: 'beleza', label: 'Beleza e cuidados', words: ['perfume', 'maquiagem', 'batom', 'pente', 'escova de cabelo', 'secador', 'chapinha', 'shampoo', 'hidratante', 'skincare', 'barbeador', 'aparador', 'depilador', 'unha', 'cabelo', 'poros', 'cravos'] },
  { slug: 'esportes', label: 'Esportes e lazer', words: ['ciclismo', 'bicicleta', 'academia', 'halter', 'yoga', 'corrida', 'camping', 'acampamento', 'pesca', 'isca', 'futebol', 'garrafa térmica', 'squeeze', 'patins'] },
  { slug: 'ferramentas', label: 'Ferramentas', words: ['ferramenta', 'furadeira', 'parafusadeira', 'chave de fenda', 'alicate', 'trena', 'multímetro', 'kit de chaves', 'serra', 'magnética', 'soldador'] },
  { slug: 'automotivo', label: 'Automotivo', words: ['carro', 'automotivo', 'moto', 'pneu', 'retrovisor', 'suporte veicular', 'rastreamento', 'gps', 'som automotivo'] },
  { slug: 'infantil', label: 'Infantil e brinquedos', words: ['brinquedo', 'infantil', 'bebê', 'bebe', 'lego', 'boneca', 'carrinho de controle', 'pelúcia', 'fralda'] },
  { slug: 'outros', label: 'Outros', words: [] },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.label])) as Record<CategorySlug, string>;
export const isCategory = (s: unknown): s is CategorySlug => CATEGORIES.some((c) => c.slug === s);

const norm = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;

/**
 * Palpite de categoria pelo título (e pela categoria que a loja informar, se houver).
 * Games vem antes de eletrônicos: "controle sem fio DualSense" é game, não eletrônico genérico.
 */
export function classifyCategory(title: string, storeCategory?: string | null): CategorySlug {
  const text = norm(`${title} ${storeCategory ?? ''}`);
  // pontua pelo tamanho dos termos encontrados: termo longo é mais específico ("ciclismo" > "jaqueta")
  let best: { slug: CategorySlug; score: number } = { slug: 'outros', score: 0 };
  // "teclado mecânico fidget / anti-stress" é brinquedo, não periférico gamer
  const toy = /fidget|anti-?stress|antiestresse/.test(text);
  for (const c of CATEGORIES) {
    if (toy && c.slug === 'games') continue;
    const score = c.words.reduce((n, w) => (text.includes(norm(w).slice(1, -1)) ? n + w.length : n), 0);
    if (score > best.score) best = { slug: c.slug, score };
  }
  return best.slug;
}

/**
 * Termos de busca prontos por categoria (fontes "APIs oficiais"). Diferente de `words`
 * (que o classificador usa): aqui vão buscas que trazem produto bom do nicho.
 */
export const SEARCH_TERMS: Record<CategorySlug, string[]> = {
  games: ['headset gamer', 'mouse gamer', 'teclado mecânico', 'controle ps5', 'controle xbox', 'cadeira gamer', 'mousepad gamer', 'ssd nvme'],
  eletronicos: ['fone bluetooth', 'smartwatch', 'carregador turbo', 'power bank', 'caixa de som bluetooth', 'câmera wifi', 'cabo usb-c'],
  casa: ['organizador', 'utensílios de cozinha', 'fita led', 'luminária', 'garrafa térmica', 'aspirador portátil'],
  moda: ['tênis masculino', 'relógio masculino', 'mochila', 'óculos de sol', 'bolsa feminina', 'jaqueta'],
  beleza: ['secador de cabelo', 'maquiagem', 'aparador de pelos', 'escova alisadora', 'skincare'],
  esportes: ['garrafa academia', 'luva academia', 'bicicleta acessórios', 'camping', 'elástico exercício'],
  ferramentas: ['kit ferramentas', 'parafusadeira', 'multímetro', 'trena digital', 'jogo de chaves'],
  automotivo: ['suporte celular carro', 'câmera veicular', 'aspirador automotivo', 'carregador veicular'],
  infantil: ['brinquedo educativo', 'pelúcia', 'blocos de montar', 'carrinho controle remoto'],
  outros: [],
};

export interface NicheRule {
  /** Categorias do canal (vazio = geral: aceita tudo). */
  categories: string[];
  /** Termos da fonte: título com um deles também conta como do nicho. */
  keywords: string[];
  excludeWords: string[];
}

/**
 * O produto é do nicho do canal? Recusa palavras excluídas; num canal de nicho exige
 * que o classificador concorde OU que o título traga um dos termos da fonte.
 * Ex.: busca "controle ps5" pode trazer "controle remoto de TV" — o classificador barra.
 */
export function matchesNiche(title: string, rule: NicheRule): boolean {
  const t = norm(title);
  if (rule.excludeWords.some((w) => w.trim() && t.includes(norm(w).slice(1, -1)))) return false;
  if (rule.categories.length === 0) return true;
  if (rule.categories.includes(classifyCategory(title))) return true;
  return rule.keywords.some((k) => keywordMatches(k, t));
}

/**
 * Sinônimos para casar o termo da fonte com títulos traduzidos à máquina (AliExpress):
 * "mouse gamer" também é "Mouse para jogos", "Gaming mouse", "Rato do jogo E-Sports".
 * Medido em 2026-09-26 com 39 produtos reais dos termos de Games: 26 → 35 aceitos, sem aceitar
 * mouse/fone comuns (sem nada de jogo no título).
 */
const SYNONYMS: Record<string, string[]> = {
  gamer: ['gamer', 'gaming', 'game', 'games', 'jogo', 'jogos', 'esports', 'e-sports'],
  headset: ['headset', 'fone', 'fones', 'headphone', 'headphones', 'auricular'],
  mouse: ['mouse', 'rato'],
  controle: ['controle', 'controlador', 'joystick', 'gamepad'],
  mousepad: ['mousepad', 'mouse pad', 'tapete de mouse'],
};
const STOPWORDS = new Set(['de', 'da', 'do', 'para', 'com', 'e', 'a', 'o']);

const wordStart = (text: string, word: string) =>
  new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);

/** Todas as palavras do termo (ou um sinônimo delas) aparecem no título, no começo de uma palavra. */
function keywordMatches(keyword: string, normalizedTitle: string): boolean {
  const words = norm(keyword).trim().split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  if (!words.length) return false;
  return words.every((w) => (SYNONYMS[w] ?? [w]).some((alt) => wordStart(normalizedTitle, norm(alt).trim())));
}
