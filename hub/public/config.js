// Relax Hub server settings. Values set before this file loads win.
(() => {
  // Multiplayer: "" = auto-detect on this site. On Cloudflare the game Worker
  // forwards to your multiplayer Worker through its Service Binding.
  if (window.RELAX_SERVER === undefined) window.RELAX_SERVER = "";
  // Used only when this site has no multiplayer server bound (set "" to disable).
  if (window.RELAX_SERVER_FALLBACK === undefined) window.RELAX_SERVER_FALLBACK = "https://relax-hub-multiplayer.onrender.com";
  // Live embedded Chromium (chromium/ Docker server). Set "" to use the
  // Cloudflare Browser Run Service Binding (BROWSER_SVC) instead.
  if (window.RELAX_BROWSER === undefined) window.RELAX_BROWSER = "https://relax-chromium.onrender.com";
  // Maps → ArcGIS SceneView works without a key (satellite + world elevation).
  // Optional: an ArcGIS Location Platform API key (restrict it to your domain)
  // for keyed services such as the geocoder.
  if (window.RELAX_ARCGIS_KEY === undefined) window.RELAX_ARCGIS_KEY = "";
})();
