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

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
  },
};

export default nextConfig;
