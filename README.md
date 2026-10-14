# Zotero Obsidian Link

一个轻量级 Zotero 插件：在 Zotero 里右键任意条目或 PDF 附件，复制一个 Markdown 链接，粘贴到 Obsidian（或任意 Markdown 编辑器）后点击即可直接打开 Zotero 中对应的 PDF。

## 功能

- 选中带 PDF 附件的条目 → 生成 `zotero://open-pdf/library/items/<key>` 链接
- 选中 PDF 附件本身 → 直接指向该附件
- 选中无 PDF 的条目 → 回退为 `zotero://select/...` 链接
- 群组库自动使用 `groups/<id>/items/<key>` 形式
- 若 PDF 已在阅读器中打开，自动附加 `?page=N`
- 菜单提供 `Copy Obsidian Link`（Markdown 格式）和 `Copy Obsidian Link (URL only)`（纯 URL）

## 兼容性

- Zotero 7 / 8 / 9 / 10 兼容（`strict_min_version = "8.0.0"`，`strict_max_version = "10.*"`）
- 升级到未来版本时，改 `manifest.json` 的 `strict_max_version` 重新打包即可，无需改代码

## 生成的链接示例

```
[论文标题](zotero://open-pdf/library/items/ABCD1234)
```

Obsidian 桌面端渲染后点击，系统会唤起 Zotero 并打开对应 PDF（安装 Zotero 时已注册 `zotero://` 协议）。

## 文件结构

```
zotero-obsidian-link/
├── manifest.json              # 插件清单（必须含 applications.zotero）
├── bootstrap.js               # 生命周期入口（install/startup/shutdown）
├── content/
│   └── obsidian-link.js       # 核心：菜单注册 / 链接生成 / 剪贴板
├── icon48.png                 # 插件图标 48x48
├── icon64.png                 # 插件图标 64x64
├── build.ps1                  # 打包脚本（生成 .xpi）
├── .gitignore                 # Git 忽略规则
└── README.md
```

## manifest.json 关键字段

```json
{
  "manifest_version": 2,
  "name": "Zotero Obsidian Link",
  "version": "1.0.1",
  "applications": {
    "zotero": {
      "id": "obsidian-link@example.com",
      "update_url": "https://raw.githubusercontent.com/<你的用户名>/<仓库名>/main/updates.json",
      "strict_min_version": "8.0.0",
      "strict_max_version": "10.*"
    }
  }
}
```

> **注意**：Zotero 10 强制要求 `applications.zotero.update_url` 字段存在，否则安装时会报 `update_url not provided` + `Invalid XPI`。即使该地址暂时返回 404，也不影响安装和日常使用（只有手动"检查更新"时才会访问）。

## 打包与安装

### 1. 打包成 .xpi

在 PowerShell 中切到本目录运行：

```powershell
.\build.ps1
```

会在**上级目录**生成 `zotero-obsidian-link.xpi`。

### 2. 安装到 Zotero

1. Zotero → `Tools` → `Add-ons`（Ctrl+Shift+A）
2. 右上角齿轮 → `Install Add-on From File...`
3. 选择 `zotero-obsidian-link.xpi`
4. 确认安装，重启 Zotero

## 使用

1. 选中一个条目或 PDF 附件
2. 右键 → 菜单底部 `Copy Obsidian Link`
3. 去 Obsidian 粘贴即可

## 偏好设置

在 Zotero Config Editor（`about:config`）中可调整：

| 键 | 默认值 | 含义 |
|----|--------|------|
| `extensions.zotero.obsidian-link.format` | `[{{title}}]({{url}})` | Markdown 模板 |
| `extensions.zotero.obsidian-link.useMarkdown` | `true` | `false` 时只输出 URL |
| `extensions.zotero.obsidian-link.openPdfInsteadOfSelect` | `true` | 是否优先生成 open-pdf 链接 |
| `extensions.zotero.obsidian-link.includePage` | `true` | 是否附加 `?page=N` |

## 技术说明

- 菜单注册：监听 `#zotero-itemmenu` 的 `popupshowing` 事件动态注入，不依赖 Zotero 10 的 `MenuManager` 新 API。
- 不依赖 bootstrap 的 `onMainWindowLoad` hook（Zotero 10 不触发），改为在 `startup` 里主动监听 `domwindowopened` + 扫描现有窗口。
- 链接格式遵循 Zotero 官方 handler：`zotero://open-pdf/library/items/<key>` 与 `zotero://select/library/items/<key>`。
- 不修改任何 Zotero 数据，只读条目信息 + 写剪贴板。
