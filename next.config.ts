import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/ootd-agent/**', // 将 'ootd-agent' 替换成您的存储桶名称
      },
    ],
  },
};

export default nextConfig;
