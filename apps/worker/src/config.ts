export const config = {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChannel: process.env.TELEGRAM_CHANNEL || '',
  postsPerDay: Number(process.env.POSTS_PER_DAY || 10),
  postsPerHour: Number(process.env.POSTS_PER_HOUR || 3),
};