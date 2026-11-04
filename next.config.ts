import type { NextConfig } from "next";

import { validateDeploymentEnvironment } from "./lib/deployment";

validateDeploymentEnvironment(process.env);

const nextConfig: NextConfig = {
  async headers(){return [
    {source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"Referrer-Policy",value:"no-referrer"},{key:"X-Frame-Options",value:"DENY"},{key:"Permissions-Policy",value:"camera=(), microphone=(self), geolocation=()"}]},
    {source:"/sw.js",headers:[{key:"Cache-Control",value:"no-cache, no-store, must-revalidate"},{key:"Service-Worker-Allowed",value:"/"},{key:"Content-Type",value:"application/javascript; charset=utf-8"}]},
    {source:"/offline.html",headers:[{key:"Cache-Control",value:"public, max-age=0, must-revalidate"},{key:"Content-Security-Policy",value:"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}]},
    {source:"/icons/:file*",headers:[{key:"Cache-Control",value:"public, max-age=0, must-revalidate"}]},
  ];},
  /* config options here */
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
