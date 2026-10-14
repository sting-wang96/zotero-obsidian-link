/**
 * bootstrap.js — Zotero 7+（含 10）插件入口
 *
 * 对齐 Zutilo（Zotero 10 能跑）的写法：
 *   - 生命周期函数不解构参数，用 data.rootURI / data.window（避免参数格式不匹配时解构抛 TypeError）
 *   - 用 Cu.reportError 输出诊断（不依赖 Zotero 对象，必显示为 [JavaScript Error]）
 *   - 顶层声明 Cc/Cu 以备需要
 */

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

function install(data, reason) {
    Cu.reportError('[ObsidianLink] install reason=' + reason);
}

function startup(data, reason) {
    Cu.reportError('[ObsidianLink] startup reason=' + reason + ' rootURI=' + (data && data.rootURI));

    let rootURI = (data && data.rootURI) || '';

    // 加载核心逻辑
    try {
        Services.scriptloader.loadSubScript(rootURI + "content/obsidian-link.js");
        Cu.reportError('[ObsidianLink] content loaded, module type=' + (typeof Zotero.ObsidianLink));
    } catch (e) {
        Cu.reportError('[ObsidianLink] loadSubScript FAILED: ' + e);
        Cu.reportError(e && e.stack ? e.stack : '');
        return;
    }

    try {
        if (typeof Zotero !== 'undefined' && Zotero.ObsidianLink && Zotero.ObsidianLink.init) {
            Zotero.ObsidianLink.init({ rootURI });
        } else {
            Cu.reportError('[ObsidianLink] module missing after load — typeof Zotero=' + (typeof Zotero));
        }
    } catch (e) {
        Cu.reportError('[ObsidianLink] init FAILED: ' + e);
    }
}

function onMainWindowLoad(data) {
    let win = data && data.window;
    Cu.reportError('[ObsidianLink] bootstrap onMainWindowLoad win=' + (win ? 'yes' : 'no'));
    try {
        if (typeof Zotero !== 'undefined' && Zotero.ObsidianLink && Zotero.ObsidianLink.onMainWindowLoad) {
            Zotero.ObsidianLink.onMainWindowLoad(win);
        } else {
            Cu.reportError('[ObsidianLink] module not ready in onMainWindowLoad');
        }
    } catch (e) {
        Cu.reportError('[ObsidianLink] onMainWindowLoad FAILED: ' + e);
    }
}

function onMainWindowUnload(data) {
    let win = data && data.window;
    try {
        if (typeof Zotero !== 'undefined' && Zotero.ObsidianLink && Zotero.ObsidianLink.onMainWindowUnload) {
            Zotero.ObsidianLink.onMainWindowUnload(win);
        }
    } catch (e) {}
}

function shutdown(data, reason) {
    Cu.reportError('[ObsidianLink] shutdown reason=' + reason);
    try {
        if (typeof Zotero !== 'undefined' && Zotero.ObsidianLink && Zotero.ObsidianLink.uninit) {
            Zotero.ObsidianLink.uninit();
        }
    } catch (e) {}
}
