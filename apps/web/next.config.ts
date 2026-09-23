import { config as loadEnv } from 'dotenv';
loadEnv({ path: new URL('../../.env', import.meta.url) });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@cupons/shared', '@cupons/affiliates', '@cupons/db'],
};

export default nextConfig;