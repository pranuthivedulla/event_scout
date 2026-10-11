/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Monday run is chained short steps; nothing here should need a long request.
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
};
export default nextConfig;
