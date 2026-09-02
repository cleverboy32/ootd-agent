import type { NextConfig } from "next";

const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: "https",
    hostname: "storage.googleapis.com",
    port: "",
    pathname: "/ootd-agent/**",
  },
];

const cosPublicBaseUrl = process.env.COS_PUBLIC_BASE_URL?.trim();
if (cosPublicBaseUrl) {
  const cosUrl = new URL(cosPublicBaseUrl);
  remotePatterns.push({
    protocol: "https",
    hostname: cosUrl.hostname,
    port: cosUrl.port,
    pathname: `${cosUrl.pathname.replace(/\/+$/, "")}/**`,
  });
}

const basePath = "/ootd";

const prefix = basePath.slice(1);

const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    remotePatterns,
  },
  async redirects() {
    if (process.env.NODE_ENV !== "development") return [];

    return [
      {
        source: "/",
        destination: basePath,
        basePath: false,
        permanent: false,
      },
      {
        source: `/:path((?!${prefix}(?:/|$)).*)`,
        destination: `${basePath}/:path`,
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
