/**
 * content/obsidian-link.js — 核心逻辑
 *
 * 在 Zotero 命名空间下挂载 ObsidianLink 模块：
 *   - 注册右键菜单（监听 zotero-itemmenu 的 popupshowing）
 *   - 根据选中条目生成 zotero:// 链接
 *   - 复制 Markdown 链接到剪贴板
 *
 * 由 bootstrap.js 通过 Services.scriptloader.loadSubScript 加载，
 * 运行在与 bootstrap 相同的作用域（Zotero / Services / Components 均可用）。
 *
 * Zotero 10 兼容性关键点：
 *   - **不依赖 bootstrap 的 onMainWindowLoad hook**（实测 Zotero 10 不调用它）
 *     init() 里直接启动 domwindowopened 观察者 + 扫描现有主窗口，主动注册菜单
 *   - 所有诊断用 Cu.reportError（必显示为 [JavaScript Error]，不依赖 debug logging）
 *   - 菜单 id #zotero-itemmenu 在 Zotero 10 仍存在（windingwind 文档确认）
 *   - getSelectedItems() 在 Zotero.getActiveZoteroPane() 上仍可用
 */
(function () {
    if (Zotero.ObsidianLink) {
        return;
    }

    const { utils: Cu, interfaces: Ci } = Components;

    // ===== 偏好读取封装 =====
    const PREFS = {
        get(key, defaultValue) {
            try {
                const v = Zotero.Prefs.get(key, true);
                return v === undefined || v === null ? defaultValue : v;
            } catch (e) {
                return defaultValue;
            }
        },
        get format() {
            return this.get('extensions.zotero.obsidian-link.format', '[{{title}}]({{url}})');
        },
        get useMarkdown() {
            return this.get('extensions.zotero.obsidian-link.useMarkdown', true);
        },
        get openPdfInsteadOfSelect() {
            return this.get('extensions.zotero.obsidian-link.openPdfInsteadOfSelect', true);
        },
        get includePage() {
            return this.get('extensions.zotero.obsidian-link.includePage', true);
        }
    };

    // ===== 主模块 =====
    Zotero.ObsidianLink = {
        rootURI: '',
        _menuHandlers: new Map(),   // window -> { itemMenu, handler }
        _windowObserver: null,
        _observerRegistered: false,

        // ---------- 生命周期 ----------
        init({ rootURI }) {
            this.rootURI = rootURI || '';
            Cu.reportError('[ObsidianLink] init rootURI=' + this.rootURI);

            // 主动启动窗口监听 — 不依赖 bootstrap 的 onMainWindowLoad hook
            this._startWindowObserver();
            this._tryRegisterExistingWindows();
        },

        /**
         * 兜底：若 Zotero 调用了 bootstrap 的 onMainWindowLoad hook 也再触发一次注册
         * （_registerContextMenu 内部有重复注册保护，不会重复 append）
         */
        onMainWindowLoad(win) {
            Cu.reportError('[ObsidianLink] bootstrap onMainWindowLoad hook fired');
            if (win) {
                if (win.document && win.document.readyState === 'complete') {
                    this._registerContextMenu(win);
                } else {
                    win.addEventListener('load', () => this._registerContextMenu(win), { once: true });
                }
            }
        },

        onMainWindowUnload(win) {
            this._unregisterContextMenu(win);
        },

        uninit() {
            Cu.reportError('[ObsidianLink] uninit');
            for (const win of Array.from(this._menuHandlers.keys())) {
                this._unregisterContextMenu(win);
            }
            this._menuHandlers.clear();
            this._stopWindowObserver();
            delete Zotero.ObsidianLink;
        },

        // ---------- 窗口监听 ----------
        _startWindowObserver() {
            if (this._observerRegistered) return;
            this._observerRegistered = true;

            try {
                this._windowObserver = (aSubject, aTopic) => {
                    if (aTopic !== 'domwindowopened') return;
                    let win = aSubject;
                    try {
                        win = aSubject.QueryInterface(Ci.nsIDOMWindow);
                    } catch (e) {
                        win = aSubject;
                    }
                    // 用 #zotero-itemmenu 的存在过滤 Zotero 主窗口（对话框/Preferences 窗口都没有）
                    const tryRegister = () => {
                        try {
                            if (win.document && win.document.getElementById('zotero-itemmenu')) {
                                this._registerContextMenu(win);
                            }
                        } catch (e) {
                            Cu.reportError('[ObsidianLink] domwindowopened register FAILED: ' + e);
                        }
                    };
                    if (win.document && win.document.readyState === 'complete') {
                        tryRegister();
                    } else {
                        win.addEventListener('load', tryRegister, { once: true });
                    }
                };
                Services.ww.registerNotification(this._windowObserver);
                Cu.reportError('[ObsidianLink] window observer registered');
            } catch (e) {
                Cu.reportError('[ObsidianLink] window observer FAILED: ' + e);
            }
        },

        _stopWindowObserver() {
            if (this._windowObserver) {
                try {
                    Services.ww.unregisterNotification(this._windowObserver);
                } catch (e) {}
                this._windowObserver = null;
            }
            this._observerRegistered = false;
        },

        _tryRegisterExistingWindows() {
            let count = 0;
            let zoteroCount = 0;
            try {
                // 主窗口类型用 navigator:browser（Zotero 继承自 Firefox）
                let enumWin;
                try {
                    enumWin = Services.wm.getEnumerator('navigator:browser');
                } catch (e) {
                    enumWin = null;
                }

                if (enumWin) {
                    while (enumWin.hasMoreElements()) {
                        const win = enumWin.getNext();
                        count++;
                        if (win.document && win.document.getElementById('zotero-itemmenu')) {
                            zoteroCount++;
                            this._registerContextMenu(win);
                        } else if (win.document) {
                            win.addEventListener('load', () => {
                                if (win.document.getElementById('zotero-itemmenu')) {
                                    this._registerContextMenu(win);
                                }
                            }, { once: true });
                        }
                    }
                }

                // 兜底：直接拿 Zotero.getMainWindow（如果枚举没找到）
                try {
                    const mw = Zotero.getMainWindow && Zotero.getMainWindow();
                    if (mw && mw.document) {
                        if (mw.document.getElementById('zotero-itemmenu')) {
                            zoteroCount++;
                            this._registerContextMenu(mw);
                        } else if (mw.document.readyState !== 'complete') {
                            mw.addEventListener('load', () => this._registerContextMenu(mw), { once: true });
                        }
                    }
                } catch (e) {
                    Cu.reportError('[ObsidianLink] getMainWindow FAILED: ' + e);
                }

                Cu.reportError('[ObsidianLink] existing windows scanned enumCount=' + count + ' zoteroCount=' + zoteroCount);
            } catch (e) {
                Cu.reportError('[ObsidianLink] existing windows scan FAILED: ' + e);
            }
        },

        // ---------- 右键菜单 ----------
        _registerContextMenu(win) {
            const doc = win.document;
            const itemMenu = doc.getElementById('zotero-itemmenu');
            if (!itemMenu) {
                Cu.reportError('[ObsidianLink] zotero-itemmenu not found in ' + (win.location && win.location.href));
                return;
            }

            // 防重复注册
            if (this._menuHandlers.has(win)) {
                return;
            }

            const separator = doc.createXULElement('menuseparator');
            separator.id = 'zotero-obsidian-link-separator';
            itemMenu.appendChild(separator);

            const menuItem = doc.createXULElement('menuitem');
            menuItem.id = 'zotero-obsidian-link-menuitem';
            menuItem.setAttribute('label', 'Copy Obsidian Link');
            menuItem.addEventListener('command', () => this._onCopyClick(win, { urlOnly: false }));
            itemMenu.appendChild(menuItem);

            const urlItem = doc.createXULElement('menuitem');
            urlItem.id = 'zotero-obsidian-link-url-menuitem';
            urlItem.setAttribute('label', 'Copy Obsidian Link (URL only)');
            urlItem.addEventListener('command', () => this._onCopyClick(win, { urlOnly: true }));
            itemMenu.appendChild(urlItem);

            const handler = () => this._refreshMenuItemVisibility(win);
            itemMenu.addEventListener('popupshowing', handler);
            this._menuHandlers.set(win, { itemMenu, handler });

            Cu.reportError('[ObsidianLink] menu registered children=' + itemMenu.children.length + ' in ' + (win.location && win.location.href));
        },

        _unregisterContextMenu(win) {
            const rec = this._menuHandlers.get(win);
            if (!rec) return;
            try {
                rec.itemMenu.removeEventListener('popupshowing', rec.handler);
                for (const id of [
                    'zotero-obsidian-link-separator',
                    'zotero-obsidian-link-menuitem',
                    'zotero-obsidian-link-url-menuitem'
                ]) {
                    const el = win.document.getElementById(id);
                    if (el) el.remove();
                }
            } catch (e) {
                Cu.reportError('[ObsidianLink] cleanup error: ' + e);
            }
            this._menuHandlers.delete(win);
        },

        _refreshMenuItemVisibility(win) {
            const items = this._getSelectedItemsSafe(win);
            const hasItems = items && items.length > 0;
            for (const id of [
                'zotero-obsidian-link-menuitem',
                'zotero-obsidian-link-url-menuitem',
                'zotero-obsidian-link-separator'
            ]) {
                const el = win.document.getElementById(id);
                if (el) el.hidden = !hasItems;
            }
        },

        /**
         * 安全获取选中条目（Zotero 10 中某些场景下 pane/itemsView 可能不可用）
         */
        _getSelectedItemsSafe(win) {
            try {
                const pane = Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane();
                if (!pane) return [];
                const items = pane.getSelectedItems ? pane.getSelectedItems() : null;
                if (items && items.length) return items;
                if (pane.itemsView && pane.itemsView.getSelectedItems) {
                    return pane.itemsView.getSelectedItems();
                }
                return [];
            } catch (e) {
                Cu.reportError('[ObsidianLink] getSelectedItems error: ' + e);
                return [];
            }
        },

        // ---------- 复制动作 ----------
        async _onCopyClick(win, opts) {
            const urlOnly = opts && opts.urlOnly;
            try {
                const items = this._getSelectedItemsSafe(win);
                if (!items || items.length === 0) {
                    this._notify(win, 'No item selected', '', 'warning');
                    return;
                }

                const item = items[0];
                const link = await this._buildLinkForItem(item);

                if (!link) {
                    this._notify(win, 'Cannot build link', 'No usable item or PDF attachment found.', 'warning');
                    return;
                }

                let text;
                if (urlOnly || !PREFS.useMarkdown) {
                    text = link.url;
                } else {
                    text = this._format(link.title, link.url);
                }

                this._copyToClipboard(win, text);
                this._notify(win, 'Link copied', text.length > 80 ? text.slice(0, 80) + '...' : text, 'success');
            } catch (e) {
                Cu.reportError('[ObsidianLink] copy error: ' + e);
                if (e && e.stack) Cu.reportError(e.stack);
                this._notify(win, 'Error', String(e), 'error');
            }
        },

        // ---------- 链接生成 ----------
        async _buildLinkForItem(item) {
            const openPdf = PREFS.openPdfInsteadOfSelect;
            const includePage = PREFS.includePage;

            // 1. 选中本身就是 PDF 附件
            if (item.isAttachment && item.isAttachment() && item.attachmentContentType === 'application/pdf') {
                return {
                    title: this._getAttachmentTitle(item),
                    url: this._buildOpenPdfUrl(item, includePage ? await this._getCurrentPage(item) : null)
                };
            }

            // 2. 普通条目（论文、书籍等）
            if (item.isRegularItem && item.isRegularItem()) {
                if (openPdf) {
                    const pdf = this._getFirstPdfAttachment(item);
                    if (pdf) {
                        return {
                            title: this._getItemTitle(item),
                            url: this._buildOpenPdfUrl(pdf, includePage ? await this._getCurrentPage(pdf) : null)
                        };
                    }
                }
                return {
                    title: this._getItemTitle(item),
                    url: this._buildSelectUrl(item)
                };
            }

            // 3. 其他附件 -> 跳父条目
            const parentID = item.parentItemID;
            const parent = parentID ? Zotero.Items.get(parentID) : null;
            if (parent) {
                if (openPdf) {
                    const pdf = this._getFirstPdfAttachment(parent);
                    if (pdf) {
                        return {
                            title: this._getItemTitle(parent),
                            url: this._buildOpenPdfUrl(pdf, includePage ? await this._getCurrentPage(pdf) : null)
                        };
                    }
                }
                return {
                    title: this._getItemTitle(parent),
                    url: this._buildSelectUrl(parent)
                };
            }

            // 兜底
            return {
                title: this._getItemTitle(item),
                url: this._buildSelectUrl(item)
            };
        },

        _getFirstPdfAttachment(item) {
            if (!item.isRegularItem || !item.isRegularItem()) return null;
            let ids = [];
            try {
                ids = item.getAttachments() || [];
            } catch (e) {
                return null;
            }
            for (const id of ids) {
                const att = Zotero.Items.get(id);
                if (att && att.attachmentContentType === 'application/pdf') {
                    return att;
                }
            }
            return null;
        },

        _buildOpenPdfUrl(attachment, page) {
            const library = Zotero.Libraries.get(attachment.libraryID);
            let base;
            if (library && library.libraryType === 'user') {
                base = 'zotero://open-pdf/library/items/' + attachment.key;
            } else {
                base = 'zotero://open-pdf/groups/' + (library ? library.libraryID : attachment.libraryID) + '/items/' + attachment.key;
            }
            if (page && page > 0) {
                base += '?page=' + page;
            }
            return base;
        },

        _buildSelectUrl(item) {
            const library = Zotero.Libraries.get(item.libraryID);
            if (library && library.libraryType === 'user') {
                return 'zotero://select/library/items/' + item.key;
            }
            return 'zotero://select/groups/' + (library ? library.libraryID : item.libraryID) + '/items/' + item.key;
        },

        async _getCurrentPage(attachment) {
            try {
                const reader = Zotero.Reader && Zotero.Reader.getReader && Zotero.Reader.getReader();
                if (reader && reader.itemID === attachment.id) {
                    const page = await reader.getCurrentPage();
                    if (page && page > 0) return page;
                }
            } catch (e) {
                Cu.reportError('[ObsidianLink] getCurrentPage failed: ' + e);
            }
            return null;
        },

        // ---------- 标题取值 ----------
        _getItemTitle(item) {
            try {
                return item.getDisplayTitle() || item.getField('title') || 'Untitled';
            } catch (e) {
                return 'Untitled';
            }
        },

        _getAttachmentTitle(attachment) {
            try {
                const parentID = attachment.parentItemID;
                const parent = parentID ? Zotero.Items.get(parentID) : null;
                if (parent) return this._getItemTitle(parent);
                return attachment.getDisplayTitle() || 'Untitled';
            } catch (e) {
                return 'Untitled';
            }
        },

        // ---------- 格式化 & 剪贴板 ----------
        _format(title, url) {
            const fmt = PREFS.format || '[{{title}}]({{url}})';
            return fmt
                .replace(/\{\{title\}\}/g, title)
                .replace(/\{\{url\}\}/g, url);
        },

        _copyToClipboard(win, text) {
            try {
                Zotero.Utilities.Internal.copyTextToClipboard(text);
                return;
            } catch (e) { /* fallthrough */ }

            try {
                const helper = Components.classes['@mozilla.org/widget/clipboardhelper;1']
                    .getService(Components.interfaces.nsIClipboardHelper);
                helper.copyString(text);
                return;
            } catch (e) { /* fallthrough */ }

            try {
                const doc = win.document;
                const ta = doc.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                doc.documentElement.appendChild(ta);
                ta.focus();
                ta.select();
                if (!win.getSelection().isCollapsed) {
                    win.getSelection().removeAllRanges();
                }
                const range = doc.createRange();
                range.selectNode(ta);
                win.getSelection().addRange(range);
                doc.execCommand('copy');
                ta.remove();
            } catch (e) {
                Cu.reportError('[ObsidianLink] clipboard copy failed: ' + e);
            }
        },

        // ---------- 通知 ----------
        _notify(win, headline, body, type) {
            try {
                const ProgressWindow = win.Zotero.ProgressWindow || (win.Zotero && win.Zotero.ProgressWindow);
                if (ProgressWindow) {
                    const pw = new ProgressWindow({ closeOnClick: true });
                    pw.changeHeadline(headline);
                    pw.addDescription(body || '');
                    pw.show();
                    pw.startCloseTimer(3500);
                    return;
                }
            } catch (e) {
                Cu.reportError('[ObsidianLink] ProgressWindow notify failed: ' + e);
            }
            try {
                win.alert(headline + (body ? '\n' + body : ''));
            } catch (e) { /* ignore */ }
        }
    };
})();
