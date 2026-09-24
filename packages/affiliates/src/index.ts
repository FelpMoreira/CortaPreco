import type { Store } from '@cupons/shared';
import type { AffiliateProvider, AffiliateError, ProductData, AffiliateLinkResult } from './types.js';
import { ShopeeProvider } from './shopee.js';
import { AliExpressProvider } from './aliexpress.js';
import { AmazonProvider } from './amazon.js';

export * from './types.js';
export { ShopeeProvider } from './shopee.js';
export { AliExpressProvider } from './aliexpress.js';
export { AmazonProvider } from './amazon.js';

export interface ProviderConfig {
  shopee?: { appId: string; appSecret: string; subId?: string };
  aliexpress?: { appKey: string; appSecret: string; trackingId: string; subId?: string };
  amazon?: { partnerTag: string; marketplace?: string };
}

/** Registro com um provider por loja ativada. */
export class ProviderRegistry {
  private providers: Map<Store, AffiliateProvider> = new Map();

  constructor(private readonly providers_: (AffiliateProvider | null)[]) {
    for (const p of this.providers_) {
      if (p) this.providers.set(p.store, p);
    }
  }

  static fromEnv(env: Record<string, string | undefined>): ProviderRegistry {
    const providers: (AffiliateProvider | null)[] = [];

    if (env.SHOPEE_APP_ID && env.SHOPEE_APP_SECRET) {
      providers.push(
        new ShopeeProvider({
          appId: env.SHOPEE_APP_ID,
          appSecret: env.SHOPEE_APP_SECRET,
          subId: env.SHOPEE_SUB_ID || 'cupons',
        }),
      );
    }

    if (env.ALIEXPRESS_APP_KEY && env.ALIEXPRESS_APP_SECRET && env.ALIEXPRESS_TRACKING_ID) {
      providers.push(
        new AliExpressProvider({
          appKey: env.ALIEXPRESS_APP_KEY,
          appSecret: env.ALIEXPRESS_APP_SECRET,
          trackingId: env.ALIEXPRESS_TRACKING_ID,
        }),
      );
    }

    if (env.AMAZON_PARTNER_TAG) {
      providers.push(
        new AmazonProvider({
          partnerTag: env.AMAZON_PARTNER_TAG,
          marketplace: env.AMAZON_MARKETPLACE || 'www.amazon.com.br',
        }),
      );
    }

    return new ProviderRegistry(providers);
  }

  /** Descobre o provider pela URL e enriquece o produto. */
  providerFor(url: string): AffiliateProvider {
    for (const p of this.providers.values()) {
      if (p.identify(url)) return p;
    }
    throw new AffiliateErrorLib(url);
  }

  list(): AffiliateProvider[] {
    return [...this.providers.values()];
  }
}

export type { AffiliateProvider, ProductData, AffiliateLinkResult, Store };
export type { DiscoverOptions, DiscoveredProduct } from './types.js';

class AffiliateErrorLib extends globalThis.Error {
  constructor(url: string) {
    super(`Nenhum provider configurado para a URL ${url}`);
    this.name = 'UnknownStoreError';
  }
}