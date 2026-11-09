// Dynamic Workspaces for Cinnamon
// - Keeps exactly one empty workspace after the last occupied one.
// - Removes empty workspaces in the middle once you switch away from them.

const Meta = imports.gi.Meta;
const Mainloop = imports.mainloop;

const MIN_WORKSPACES = 2; // change this to set the minimum

let ext = null;

class DynamicWorkspaces {
    constructor() {
        this.wm = global.workspace_manager || global.screen;
        this.handlers = [];      // [object, id]
        this.wsHandlers = [];    // [workspace, id]
        this.timeoutId = 0;
        this.busy = false;
    }

    enable() {
        this._connect(global.window_manager, 'switch-workspace', () => this._schedule());
        this._connect(this.wm, 'workspace-added', () => { this._reconnect(); this._schedule(); });
        this._connect(this.wm, 'workspace-removed', () => { this._reconnect(); this._schedule(); });
        this._reconnect();
        this._schedule();
    }

    disable() {
        if (this.timeoutId) {
            Mainloop.source_remove(this.timeoutId);
            this.timeoutId = 0;
        }
        this.handlers.forEach(([obj, id]) => { try { obj.disconnect(id); } catch (e) {} });
        this.handlers = [];
        this._disconnectWorkspaces();
    }

    _connect(obj, signal, cb) {
        this.handlers.push([obj, obj.connect(signal, cb)]);
    }

    _disconnectWorkspaces() {
        this.wsHandlers.forEach(([ws, id]) => { try { ws.disconnect(id); } catch (e) {} });
        this.wsHandlers = [];
    }

    _reconnect() {
        this._disconnectWorkspaces();
        for (let i = 0; i < this.wm.get_n_workspaces(); i++) {
            let ws = this.wm.get_workspace_by_index(i);
            this.wsHandlers.push([ws, ws.connect('window-added', () => this._schedule())]);
            this.wsHandlers.push([ws, ws.connect('window-removed', () => this._schedule())]);
        }
    }

    _schedule() {
        if (this.timeoutId) return;
        this.timeoutId = Mainloop.timeout_add(200, () => {
            this.timeoutId = 0;
            this._update();
            return false;
        });
    }

    // Returns an array of booleans: occupied[i] is true if workspace i has a real window.
    _occupied() {
        let n = this.wm.get_n_workspaces();
        let occ = new Array(n).fill(false);
        global.get_window_actors().forEach(actor => {
            let win = actor.meta_window;
            if (!win || win.is_on_all_workspaces() || win.is_skip_taskbar())
                return;
            let type = win.get_window_type();
            if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK)
                return;
            let ws = win.get_workspace();
            if (!ws) return;
            let idx = ws.index();
            if (idx >= 0 && idx < n) occ[idx] = true;
        });
        return occ;
    }

    _update() {
        if (this.busy) return;
        this.busy = true;
        try {
            let active = this.wm.get_active_workspace_index();

            // 1. Remove empty workspaces in the middle (not the active one).
            //    Go from the highest index down so lower indices stay valid.
            let occ = this._occupied();
            let last = occ.lastIndexOf(true);
            for (let i = last - 1; i >= 0; i--) {
                if (!occ[i] && i !== active) {
                    let ws = this.wm.get_workspace_by_index(i);
                    this.wm.remove_workspace(ws, global.get_current_time());
                }
            }

            // 2. Make sure there is exactly one empty workspace at the end.
            active = this.wm.get_active_workspace_index();
            last = this._occupied().lastIndexOf(true);
            let target = Math.max(last + 2, active + 1, MIN_WORKSPACES);
            let n = this.wm.get_n_workspaces();

            while (n < target) {
                this.wm.append_new_workspace(false, global.get_current_time());
                n++;
            }
            while (n > target) {
                let ws = this.wm.get_workspace_by_index(n - 1);
                this.wm.remove_workspace(ws, global.get_current_time());
                n--;
            }
        } catch (e) {
            global.logError('dynamic-workspaces: ' + e);
        }
        this.busy = false;
    }
}

function init(meta) {}

function enable() {
    ext = new DynamicWorkspaces();
    ext.enable();
}

function disable() {
    if (ext) {
        ext.disable();
        ext = null;
    }
}
