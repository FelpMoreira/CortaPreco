const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChannel: process.env.TELEGRAM_CHANNEL || '',
  postsPerDay: num(process.env.POSTS_PER_DAY, 10),
  postsPerHour: num(process.env.POSTS_PER_HOUR, 3),
  /** Janela sem posts automáticos, no horário de Brasília. Ex.: "23-7". Vazio = sem janela. */
  quietHours: process.env.QUIET_HOURS || '',
  evolution: {
    url: process.env.EVOLUTION_API_URL || '',
    apiKey: process.env.EVOLUTION_API_KEY || '',
    instance: process.env.EVOLUTION_INSTANCE || '',
  },
  curation: {
    /** Quantas sugestões cada rodada de curadoria gera no máximo. */
    maxPicks: num(process.env.CURATION_MAX_PICKS, 5),
    /** Não sugere produto postado nos últimos N dias. */
    cooldownDays: num(process.env.CURATION_COOLDOWN_DAYS, 7),
    /** Descoberta automática pelas APIs oficiais (Shopee/AliExpress). */
    discoveryEnabled: process.env.DISCOVERY_ENABLED === 'true',
    discoveryIntervalMin: num(process.env.DISCOVERY_INTERVAL_MIN, 120),
    discoveryMinDiscount: num(process.env.DISCOVERY_MIN_DISCOUNT, 15),
    discoveryLimit: num(process.env.DISCOVERY_LIMIT, 30),
  },
};
