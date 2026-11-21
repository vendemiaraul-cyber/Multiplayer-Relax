import { el } from './dom.js';
let host = null;
function getHost() {
    if (host && host.isConnected) return host;
    host = el('div', 'toast-host');
    document.body.appendChild(host);
    return host;
}
export function showToast(message, kind = 'info', durationMs = 4500) {
    const h = getHost();
    while(h.childElementCount >= 4 && h.firstElementChild)h.removeChild(h.firstElementChild);
    const t = el('div', `toast toast-${kind}`, message, h);
    requestAnimationFrame(()=>t.classList.add('toast-in'));
    window.setTimeout(()=>{
        t.classList.remove('toast-in');
        t.classList.add('toast-out');
        window.setTimeout(()=>t.remove(), 400);
    }, durationMs);
}
