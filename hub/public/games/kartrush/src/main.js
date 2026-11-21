import { GAME_TITLE } from './core/constants.js';
import { Game } from './game/Game.js';
import { el } from './ui/dom.js';
import { showToast } from './ui/toast.js';
function hasWebGL2() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', {
            failIfMajorPerformanceCaveat: false
        });
        return gl instanceof WebGL2RenderingContext;
    } catch  {
        return false;
    }
}
function showFatal(root, title, body) {
    root.replaceChildren();
    const wrap = el('div', 'fatal', undefined, root);
    const panel = el('div', 'glass panel fatal-panel', undefined, wrap);
    el('div', 'panel-kicker', GAME_TITLE, panel);
    el('h2', 'panel-title', title, panel);
    el('p', 'fatal-body', body, panel);
    const retry = el('button', 'btn primary', 'RELOAD', panel);
    retry.type = 'button';
    retry.addEventListener('click', ()=>window.location.reload());
}
function boot() {
    const app = document.getElementById('app') ?? el('div', '', undefined, document.body);
    app.id = 'app';
    if (!hasWebGL2()) {
        showFatal(app, 'WEBGL2 REQUIRED', 'Turbo Kart Rush needs a browser with WebGL 2 and hardware acceleration enabled. ' + 'Try the latest Chrome, Edge, Firefox or Safari, and make sure GPU acceleration is switched on.');
        return;
    }
    let errorToasts = 0;
    const report = (message, err)=>{
        console.error(message, err);
        if (errorToasts < 3) {
            errorToasts++;
            showToast(message, 'error');
        }
    };
    window.addEventListener('error', (ev)=>{
        report(`Runtime error: ${ev.message || 'unknown'}`, ev.error);
    });
    window.addEventListener('unhandledrejection', (ev)=>{
        const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
        report(`Unhandled promise rejection: ${reason}`, ev.reason);
    });
    try {
        const game = new Game(app);
        game.start();
        window.__turboKartRush = game;
    } catch (err) {
        console.error('[main] failed to start game', err);
        showFatal(app, 'FAILED TO START', 'Something went wrong while starting the game. Open the developer console for details, then reload.');
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, {
        once: true
    });
} else {
    boot();
}
