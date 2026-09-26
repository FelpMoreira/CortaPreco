export const STORES = ['SHOPEE', 'ALIEXPRESS', 'AMAZON', 'MERCADOLIVRE'] as const;
export type Store = (typeof STORES)[number];

export const PRODUCT_STATUSES = ['NEW', 'READY', 'FILTERED', 'EXPIRED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const POST_STATUSES = ['SCHEDULED', 'POSTING', 'POSTED', 'FAILED', 'CANCELED'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const CHANNEL_PLATFORMS = ['TELEGRAM', 'WHATSAPP'] as const;
export type ChannelPlatform = (typeof CHANNEL_PLATFORMS)[number];

export interface Product {
  id: string;
  store: Store;
  storeProductId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountPct: number | null;
  coupon: string | null;
  imageUrl: string | null;
  category: string | null;
  rating: number | null;
  sales: number | null;
  url: string;
  status: ProductStatus;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Post {
  id: string;
  productId: string;
  channelId: string | null;
  platform: ChannelPlatform;
  message: string;
  affiliateUrl: string;
  subId: string | null;
  status: PostStatus;
  telegramMessageId: number | null;
  lastError: string | null;
  postedAt: Date | null;
  updatedAt: Date;
}

export interface Click {
  id: string;
  postId: string;
  referrer: string | null;
  createdAt: Date;
}

/** Dados mínimos pra renderizar a mensagem de um post. */
export interface MessageInput {
  store: Store;
  title: string;
  price: number;
  oldPrice: number | null;
  coupon: string | null;
  affiliateUrl: string;
  discountPct?: number | null;
  /** Frase de chamada (escrita pela curadoria). Nunca contém números: preço vem do banco. */
  hook?: string | null;
}