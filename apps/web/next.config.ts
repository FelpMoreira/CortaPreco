/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@cupons/shared', '@cupons/affiliates', '@cupons/db'],
};

export default nextConfig;