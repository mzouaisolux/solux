/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // Force polling-based file watching for iCloud Drive compatibility.
  // Native fsevents/inotify hangs indefinitely on iCloud-synced directories.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};
export default nextConfig;
