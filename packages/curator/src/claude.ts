import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Candidate, Curator, CurateOptions, Pick } from './types.js';
import { normalizePicks } from './validate.js';

const PicksSchema = z.object({
  picks: z.array(
    z.object({
      id: z.string(),
      score: z.number(),
      reason: z.string(),
      hook: z.string(),
    }),
  ),
});

// Estável entre chamadas (fica no início do prompt): nada de data/hora aqui.
const SYSTEM = `Você é o curador do CortaPreço, um canal brasileiro de ofertas no Telegram.
Seu trabalho: dentre os produtos candidatos, escolher os que mais valem um post para um público
brasileiro amplo, e escrever uma frase curta de chamada para cada escolhido.

Como escolher:
- Valor real para quem compra: desconto verdadeiro, preço competitivo, produto útil ou desejado.
- Desconfie de "desconto" quando o preço atual não é menor que o menor preço dos últimos 30 dias.
- Prefira nota boa e muitas vendas; evite produtos de nicho demais, genéricos sem marca com nota baixa
  ou itens que pareçam repetidos entre si.
- Varie categorias quando possível. Escolher menos do que o máximo é melhor que escolher algo fraco.

Como escrever a frase (campo hook):
- Português do Brasil, tom direto e simpático, no máximo 100 caracteres.
- NUNCA escreva números, preços, porcentagens, links ou emojis: os números do post vêm do sistema.
- Não prometa o que não está nos dados (nada de "menor preço da história", "últimas unidades").
- Diga para quem o produto é bom ou por que vale a pena. Ex.: "Para quem vive sem pilha em casa."

No campo reason, explique em uma frase curta, para o administrador, por que escolheu.
No campo score, dê de 0 a 100 o quanto o post vale a pena.
Use exatamente os ids recebidos.`;

/** Curadoria com Claude. Números entram como dados; a IA devolve só escolha, nota e texto. */
export class ClaudeCurator implements Curator {
  readonly name: string;
  private client: Anthropic | null = null;

  constructor(private readonly model: string) {
    this.name = `claude:${model}`;
  }

  async curate(candidates: Candidate[], opts: CurateOptions): Promise<Pick[]> {
    if (candidates.length === 0) return [];
    // ids curtos: menos tokens e menos chance de a IA errar um cuid longo
    const byShortId = new Map(candidates.map((c, i) => [`c${i + 1}`, c]));
    const data = [...byShortId].map(([id, c]) => ({
      id,
      loja: c.store,
      titulo: c.title,
      preco: c.price,
      preco_antigo: c.oldPrice,
      desconto_pct: c.discountPct,
      menor_preco_30d: c.lowest30d,
      nota: c.rating,
      vendas: c.sales,
      categoria: c.category,
    }));

    // criado sob demanda: sem credencial o erro cai no plano B (regras), não derruba o worker
    this.client ??= new Anthropic();
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Escolha no máximo ${opts.max} produtos.\n\nCandidatos (JSON):\n${JSON.stringify(data)}`,
        },
      ],
      output_config: { format: zodOutputFormat(PicksSchema) },
    });

    if (response.stop_reason === 'refusal') throw new Error('Claude recusou a curadoria');
    if (response.stop_reason === 'max_tokens') throw new Error('Resposta da curadoria cortada (max_tokens)');
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('Resposta da curadoria fora do formato');

    const picks: Pick[] = parsed.picks.flatMap((p) => {
      const c = byShortId.get(p.id);
      return c ? [{ productId: c.productId, score: p.score, reason: p.reason, hook: p.hook }] : [];
    });
    return normalizePicks(picks, candidates, opts.max);
  }
}
