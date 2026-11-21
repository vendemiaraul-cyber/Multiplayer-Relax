export function el(tag, className = '', text, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
}
export function cssHex(color) {
    return '#' + (color >>> 0 & 0xffffff).toString(16).padStart(6, '0');
}
export function cssRgba(color, alpha) {
    const r = color >> 16 & 255;
    const g = color >> 8 & 255;
    const b = color & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}
export function restartAnimation(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
}
export class TextField {
    node;
    value = '';
    constructor(node){
        this.node = node;
    }
    set(text) {
        if (text === this.value) return false;
        this.value = text;
        this.node.textContent = text;
        return true;
    }
    get() {
        return this.value;
    }
}
export function button(label, className, onClick) {
    const b = el('button', `btn ${className}`.trim(), label);
    b.type = 'button';
    b.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        onClick();
    });
    return b;
}
export class FocusRing {
    onActivate;
    index = 0;
    items = [];
    constructor(onActivate){
        this.onActivate = onActivate;
    }
    add(node) {
        const i = this.items.length;
        this.items.push(node);
        node.addEventListener('pointerenter', ()=>this.set(i));
        if (i === 0) node.classList.add('focused');
    }
    clear() {
        this.items.length = 0;
        this.index = 0;
    }
    get current() {
        return this.index;
    }
    set(i) {
        const n = this.items.length;
        if (n === 0) return false;
        const next = (i % n + n) % n;
        if (next === this.index && this.items[next].classList.contains('focused')) return false;
        for(let k = 0; k < n; k++)this.items[k].classList.toggle('focused', k === next);
        this.index = next;
        return true;
    }
    move(delta) {
        return this.set(this.index + delta);
    }
    activate() {
        if (this.items.length === 0) return;
        this.onActivate(this.index);
    }
}
