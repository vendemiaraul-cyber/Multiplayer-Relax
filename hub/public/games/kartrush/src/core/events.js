class EventBus {
    handlers = new Map();
    on(name, handler) {
        let set = this.handlers.get(name);
        if (!set) {
            set = new Set();
            this.handlers.set(name, set);
        }
        set.add(handler);
        return ()=>this.off(name, handler);
    }
    once(name, handler) {
        const off = this.on(name, (payload)=>{
            off();
            handler(payload);
        });
        return off;
    }
    off(name, handler) {
        this.handlers.get(name)?.delete(handler);
    }
    emit(name, payload) {
        const set = this.handlers.get(name);
        if (!set) return;
        for (const h of Array.from(set)){
            try {
                h(payload);
            } catch (err) {
                console.error(`[events] handler for ${name} threw`, err);
            }
        }
    }
    clear() {
        this.handlers.clear();
    }
}
export const events = new EventBus();
