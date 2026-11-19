// Where Relax Hub's servers run. Values set before this file loads win.
// - Served by the Cloudflare Worker (*.workers.dev): chat is same-origin and the
//   browser uses Cloudflare Browser Run through the Service Binding.
// - Served by Netlify (or anywhere else): chat on Render, embedded Chromium on Render.
(() => {
  const onWorkers = /\.workers\.dev$/.test(location.hostname);
  if (window.RELAX_SERVER === undefined) {
    window.RELAX_SERVER = onWorkers ? "" : "https://relax-hub-multiplayer.onrender.com";
  }
  if (window.RELAX_BROWSER === undefined) {
    window.RELAX_BROWSER = onWorkers ? "" : "https://relax-chromium.onrender.com";
  }
})();
