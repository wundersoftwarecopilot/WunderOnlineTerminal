import { defineConfig, type Plugin } from 'vite';

/**
 * Content Security Policy injected into the production build only
 * (the dev server needs a WebSocket for hot reload).
 *
 * `connect-src 'none'` is the key privacy guarantee: the page is not
 * allowed to open ANY network connection (fetch, XHR, WebSocket,
 * EventSource, sendBeacon). Data received from BLE / serial devices
 * physically cannot leave the browser.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "manifest-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'online-terminal-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative base: the build works from any sub-path, e.g.
  // https://<user>.github.io/<repository>/ or a custom domain.
  base: './',
  plugins: [contentSecurityPolicy()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    // The module-preload polyfill uses fetch(); it is not needed and
    // would be blocked by the CSP anyway.
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
