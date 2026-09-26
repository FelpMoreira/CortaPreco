export type { Store, Product, Post, Click, MessageInput } from './types.js';
export { STORES, PRODUCT_STATUSES, POST_STATUSES, CHANNEL_PLATFORMS } from './types.js';
export { renderMessage, renderMessageHtml, formatBRL, escapeHtml, LINK_PLACEHOLDER, STORE_LABELS } from './template.js';
export { telegramHtmlToWhatsApp } from './whatsapp.js';
export {
  CATEGORIES,
  CATEGORY_LABEL,
  SEARCH_TERMS,
  classifyCategory,
  isCategory,
  matchesNiche,
  type CategorySlug,
  type NicheRule,
} from './categories.js';
export {
  MIRROR_LINK_TYPES,
  MIRROR_LINK_TYPE_KEYS,
  MIRROR_DEFAULT_MAX_DELAY_SEC,
  MIRROR_MAX_DELAY_LIMIT_SEC,
  MIRROR_QUEUE,
  MIRROR_STATUS_KEYS,
  mirrorLinkType,
  type MirrorLinkType,
  type MirrorJob,
} from './mirror.js';
