/**
 * pm2: OOTD Agent (Next.js, basePath /ootd)
 * 启动：pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "ootd-agent",
      cwd: "/srv/ootd-agent",
      script: "/srv/ootd-agent/node_modules/next/dist/bin/next",
      args: "start -p 3002 -H 127.0.0.1",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: "3002",
        https_proxy: "",
        HTTPS_PROXY: "",
        http_proxy: "",
        HTTP_PROXY: "",
      },
      max_memory_restart: "700M",
    },
  ],
};
