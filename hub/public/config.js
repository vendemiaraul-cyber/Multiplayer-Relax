// Relax Hub server settings. Values set before this file loads win.
(() => {
  // Multiplayer: "" = auto-detect on this site. On Cloudflare the game Worker
  // forwards to your multiplayer Worker through its Service Binding.
  if (window.RELAX_SERVER === undefined) window.RELAX_SERVER = "";
  // Used only when this site has no multiplayer server bound (set "" to disable).
  if (window.RELAX_SERVER_FALLBACK === undefined) window.RELAX_SERVER_FALLBACK = "https://relax-hub-multiplayer.onrender.com";
  // Live embedded Chromium (chromium/ Docker server). Set "" to use the
  // Cloudflare Browser Run Service Binding (BROWSER_SVC) instead.
  // Chromium: the local Node server (npm run local → http://127.0.0.1:7860).
  // Set to "" to use Cloudflare Browser Run (built into the game Worker) instead,
  // or open the game with ?chromium=https://your-server to point elsewhere.
  if (window.RELAX_BROWSER === undefined) window.RELAX_BROWSER = "http://127.0.0.1:7860";
  // Maps → ArcGIS SceneView works without a key (satellite + world elevation).
  // Optional: an ArcGIS Location Platform API key (restrict it to your domain)
  // for keyed services such as the geocoder.
  if (window.RELAX_ARCGIS_KEY === undefined) window.RELAX_ARCGIS_KEY = "";
})();
