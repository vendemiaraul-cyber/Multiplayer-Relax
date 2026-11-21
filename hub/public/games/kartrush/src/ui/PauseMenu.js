import { events } from '../core/events.js';
import { button, el, FocusRing } from './dom.js';
export class PauseMenu {
    onResume = null;
    onRestart = null;
    onQuit = null;
    rootNode;
    focus;
    visible = false;
    constructor(root){
        this.rootNode = el('div', 'screen pause hidden', undefined, root);
        const panel = el('div', 'glass panel pause-panel', undefined, this.rootNode);
        el('div', 'panel-kicker', 'RACE PAUSED', panel);
        el('h2', 'panel-title', 'PAUSED', panel);
        const actions = el('div', 'actions column', undefined, panel);
        this.focus = new FocusRing((i)=>this.activate(i));
        const resume = button('RESUME', 'primary', ()=>this.activate(0));
        const restart = button('RESTART RACE', '', ()=>this.activate(1));
        const quit = button('QUIT TO MENU', 'danger', ()=>this.activate(2));
        actions.append(resume, restart, quit);
        this.focus.add(resume);
        this.focus.add(restart);
        this.focus.add(quit);
        el('div', 'panel-hint', 'ESC / P  resume   ·   ↑↓  navigate   ·   ENTER  select', panel);
    }
    show() {
        this.focus.set(0);
        this.rootNode.classList.remove('hidden');
        this.visible = true;
    }
    hide() {
        this.rootNode.classList.add('hidden');
        this.visible = false;
    }
    get isVisible() {
        return this.visible;
    }
    handleInput(input) {
        if (!this.visible) return;
        if (input.menuUp || input.menuLeft) {
            if (this.focus.move(-1)) events.emit('ui:move', {});
        } else if (input.menuDown || input.menuRight) {
            if (this.focus.move(1)) events.emit('ui:move', {});
        }
        if (input.confirm) {
            this.focus.activate();
        } else if (input.back) {
            events.emit('ui:back', {});
            this.onResume?.();
        }
    }
    activate(i) {
        events.emit('ui:select', {});
        if (i === 0) this.onResume?.();
        else if (i === 1) this.onRestart?.();
        else this.onQuit?.();
    }
    dispose() {
        this.rootNode.remove();
    }
}
