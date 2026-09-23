export const config = {
  port: Number(process.env.API_PORT || 3001),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3001',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChannel: process.env.TELEGRAM_CHANNEL || '',
  postsPerDay: Number(process.env.POSTS_PER_DAY || 10),
  postsPerHour: Number(process.env.POSTS_PER_HOUR || 3),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
};