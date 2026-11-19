const map = {
  "cloudflare:workers": new URL("./cloudflare-workers.mjs", import.meta.url).href,
  "@cloudflare/puppeteer": new URL("./puppeteer.mjs", import.meta.url).href,
};
export async function resolve(specifier, context, next) {
  if (map[specifier]) return { url: map[specifier], shortCircuit: true };
  return next(specifier, context);
}
