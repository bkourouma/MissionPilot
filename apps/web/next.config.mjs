import process from "node:process";

/**
 * Les appels du navigateur passent par `/api/*` sur l'origine du web : Next les relaie vers
 * l'API. Le cookie de session (httpOnly, posé par l'API) reste ainsi en même origine et aucun
 * jeton n'est lisible par JavaScript.
 *
 * `API_URL` est lu au build (les réécritures sont figées dans le manifeste de routes) :
 * reconstruire après l'avoir changé.
 */
const API_URL = (process.env.API_URL ?? "http://localhost:4100").replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@missionpilot/shared"],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
