// Where the multiplayer server runs.
// - Served by the Cloudflare Worker (*.workers.dev): same origin, leave empty.
// - Served by Netlify (or anywhere else): the Node server on Render.
window.RELAX_SERVER = /\.workers\.dev$/.test(location.hostname)
  ? ""
  : "https://relax-hub-multiplayer.onrender.com";
