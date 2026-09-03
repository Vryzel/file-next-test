/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't fail the build on lint warnings (we want to test the
  // library, not gate on style).
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: [
    "@vryzel/file-next-headless",
    "@vryzel/file-next-ui",
  ],
  // better-sqlite3 + pg ship native bindings. Externalize ONLY
  // those — NOT file-next itself. Adding `file-next` here would
  // bypass webpack's `server-only` alias and crash every server
  // action with "module cannot be imported from a Client Component".
  serverExternalPackages: ["better-sqlite3", "pg"],
  // Belt-and-suspenders for Next 15.5: explicitly mark native
  // modules as external in the webpack/turbopack config.
  webpack: (config) => {
    if (Array.isArray(config.externals)) {
      config.externals.push(({ request }, callback) => {
        if (request === "better-sqlite3" || request === "pg") {
          return callback(null, "commonjs " + request);
        }
        callback();
      });
    } else if (typeof config.externals === "function") {
      const originalExternals = config.externals;
      config.externals = (ctx, callback) => {
        if (ctx.request === "better-sqlite3" || ctx.request === "pg") {
          return callback(null, "commonjs " + ctx.request);
        }
        return originalExternals(ctx, callback);
      };
    } else {
      config.externals = [
        config.externals,
        ({ request }, callback) => {
          if (request === "better-sqlite3" || request === "pg") {
            return callback(null, "commonjs " + request);
          }
          callback();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;

