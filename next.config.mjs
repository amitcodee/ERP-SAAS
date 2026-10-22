// The baseline policy for every response. Pages also get a stricter one per request from proxy.ts (scripts only with
// that request's nonce); a browser enforces both, so on pages an inline script without the nonce is refused. This one
// stays for what proxy.ts does not see. Dev mode (React refresh) additionally needs 'unsafe-eval' and a websocket.
// 'wasm-unsafe-eval' lets the photo check on the registration page run its face detector (WebAssembly, this origin).
const dev = process.env.NODE_ENV !== 'production'
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors now fail the build (they used to be ignored). NEXT_DIST_DIR lets a build run beside a live dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
  // `next dev` refuses its scripts to any host but localhost, so a phone or tablet opening http://192.168.x.x:3000
  // got the page with no JavaScript (menu, pop-ups and buttons dead). Allow the private LAN ranges; dev only.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`), '*.local'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: CSP },
        ],
      },
      {
        // The admission form inside an institute's own website (/apply/embed): any site may frame this page alone. A
        // later rule wins, so this replaces the policy above; frame-ancestors also overrides X-Frame-Options in browsers.
        source: '/apply/embed',
        headers: [{ key: 'Content-Security-Policy', value: CSP.replace("frame-ancestors 'none'", 'frame-ancestors *') }],
      },
      {
        // Uploaded files: later rules win, so this replaces the page CSP. Sandboxed, nothing else may load.
        source: '/documents/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }],
      },
    ]
  },
}

export default nextConfig
