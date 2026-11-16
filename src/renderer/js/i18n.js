'use strict';
/* 界面多语言：中文为源语言，运行时翻译 DOM 文本与常用提示
 * 说明：以中文原文作为字典键，既能覆盖静态 HTML，也能覆盖脚本动态生成的界面文字。
 * 新增语言时，在 i18n 目录下新增语言文件，调用 I18N.register(id, { 中文: 译文 }, 规则数组) 即可。
 */
window.I18N = (function () {
  const LANGS = [
    { id: 'zh', label: '简体中文' },
    { id: 'zh-Hant', label: '繁體中文' },
    { id: 'en', label: 'English' },
    { id: 'ru', label: 'Русский' },
    { id: 'fr', label: 'Français' },
    { id: 'de', label: 'Deutsch' },
    { id: 'ja', label: '日本語' },
    { id: 'ko', label: '한국어' }
  ];
  const HTML_LANG = {
    zh: 'zh-CN',
    'zh-Hant': 'zh-Hant',
    en: 'en',
    ru: 'ru',
    fr: 'fr',
    de: 'de',
    ja: 'ja',
    ko: 'ko'
  };

  /* ================= 英文词条 ================= */
  const DICT = { en: {} };
  const RULEMAP = {};
  const EN = DICT.en;

  /* ---- 顶栏 / 主界面 ---- */
  Object.assign(EN, {
    '文件': 'File',
    '视图': 'View',
    '帮助': 'Help',
    '服务器列表': 'Servers',
    'SSH 工作台': 'SSH Workspace',
    '登录': 'Sign in',
    '设置': 'Settings',
    '最小化': 'Minimize',
    '最大化': 'Maximize',
    '关闭': 'Close',
    '还原': 'Restore',
    '登录 / 注册 LIULI 云服务': 'LIULI Cloud account',
    '软件设置': 'Settings',
    '修改后立即生效并自动保存': 'Changes apply and save automatically',
    '未配置云同步': 'Cloud sync off',
    '上次同步': 'Last sync',
    '上次云同步成功时间': 'Last successful sync',
    '更多（导入 / 导出配置）': 'More (import / export)',
    '筛选名称 / 主机 / 用户': 'Filter name / host / user',
    '＋ 新增配置': '+ New',
    '＋ 分组': '+ Group',
    '新建分组': 'New group',
    '0 个会话': '0 sessions',
    '0 个配置': '0 hosts',
    'CPU': 'CPU',
    '内存': 'Memory',
    '磁盘': 'Disk',
    '路径': 'Path',
    '可用 / 总': 'Free / Total',
    '暂无数据': 'No data',
    '清屏': 'Clear',
    '清空当前终端': 'Clear terminal',
    '显示 / 隐藏服务器信息面板': 'Toggle server info',
    '最近连接': 'Recent',
    '清空历史': 'Clear history',
    '清空最近连接': 'Clear recent',
    '快速连接': 'Quick connect',
    '删除此行': 'Remove row',
    '取消置顶': 'Unpin',
    '置顶': 'Pin',
    '查找': 'Find',
    '输入关键字后回车…': 'Type to find, press Enter',
    '上一个匹配': 'Previous match',
    '下一个匹配': 'Next match',
    '关闭 (Esc)': 'Close (Esc)',
    '输入命令后回车发送，↑↓ 调历史': 'Enter command; ↑↓ history',
    '查看全部命令历史': 'Command history',
    '当前会话': 'Current',
    '全部会话': 'All',
    '发送': 'Send',
    '历史': 'History',
    '快捷命令': 'Snippets',
    '快捷命令发送目标': 'Snippet target',
    '命令发送目标': 'Command target',
    '＋ 板块': '+ Board',
    '＋ 快捷命令': '+ Snippet',
    '下载管理器': 'Downloads',
    '打开下载管理器': 'Open downloads',
    '★ 收藏文件夹': '★ Favorites',
    '收藏的文件夹': 'Favorite folders',
    '收起 / 展开': 'Collapse / Expand',
    '↑ 上级': '↑ Up',
    '返回上级目录': 'Go to parent folder',
    '刷新': 'Refresh',
    '上传': 'Upload',
    '下载': 'Download',
    '粘贴': 'Paste',
    '复制': 'Copy',
    '显示 / 隐藏目录树': 'Toggle folder tree',
    '名称': 'Name',
    '大小': 'Size',
    '修改时间': 'Modified',
    '权限': 'Permissions',
    '未连接服务器': 'Not connected',
    '未连接': 'Offline',
    '请在上方连接一台服务器': 'Connect a server above',
    '未连接或已断开': 'Offline',
    '服务器信息': 'Server info',
    '系统': 'OS',
    '内核': 'Kernel',
    '架构': 'Arch',
    '用户': 'User',
    '运行': 'Uptime',
    '负载': 'Load',
    '网络速率监测': 'Network rate',
    '下行': 'Down',
    '上行': 'Up',
    '进程预览': 'Processes',
    '进程名': 'Process',
    '连接状态': 'Status',
    '点击查看详细服务器信息': 'Open server details',
    '收起服务器信息': 'Collapse server info',
    '命令编辑器': 'Command editor',
    '多行脚本，按行执行…': 'Multi-line script…',
    '发送目标': 'Send to',
    '拖动调整宽度': 'Drag to resize',
    '拖动调整高度，双击复位': 'Drag to resize, double-click to reset'
  });

  /* ---- 设置中心 ---- */
  Object.assign(EN, {
    '语言 / 字体': 'Language / Font',
    '外观与主题': 'Appearance',
    '快捷键': 'Shortcuts',
    'WebDAV同步': 'WebDAV',
    '传输 / 代理': 'Transfer / Proxy',
    '启动 / 行为': 'Startup',
    '板块显隐': 'Panels',
    '速率单位': 'Units',
    '数据与重置': 'Data / Reset',
    '恢复默认设置': 'Reset defaults',
    '完成': 'Done',
    '语言': 'Language',
    '字体': 'Font',
    '界面语言': 'Interface language',
    '选择界面显示语言，修改后立即生效。': 'Select the interface language. Changes apply immediately.',
    '切换后界面文字立即更新': 'Applies immediately',
    '切换后会先预览效果，确认显示正常再保存，若界面已经大到看不清，按': 'A preview is shown first. If the UI becomes unreadable, press',
    '可随时复位。': 'to reset at any time.',
    '「菜单功能 - 复制 / 粘贴」作用于当前选中的文本或输入框；「终端 - …」始终作用于终端。': 'Menu - Copy / Paste acts on the current selection or input; Terminal - ... always acts on the terminal.',
    '复制 · 粘贴 · 查找 · 全选 · 清屏 · 重连 · 关闭会话': 'Copy · Paste · Find · Select all · Clear · Reconnect · Close session',
    'Tips：请注意，同步用户名和密码忘记后，将再也找不回原来的同步配置。': 'Tip: if you forget the sync user and password, the sync config cannot be recovered.',
    '本地Socks5': 'Local SOCKS5',
    '管理收藏文件夹…': 'Manage favorite folders…',
    '回收站…': 'Recycle bin…',
    '下载管理器…': 'Downloads…',
    '粘贴配置': 'Paste host',
    '继续': 'Continue',
    '将清空服务器配置、分组、密钥库、收藏文件夹、快捷命令、命令历史与全部设置。\n\n清空前会先停止本机 WebDAV 与官方云同步，清除 WebDAV 配置并退出官方云账号，不会影响其他设备，也不会把空服务器列表上传到云端。\n\n确定继续吗？': 'This clears servers, groups, the key store, favorite folders, snippets, command history and all settings.\n\nCloud sync stops first, WebDAV config is removed and the cloud account signs out. Other devices are not affected, and the empty server list is not uploaded.\n\nContinue?',
    '此操作不可恢复，将停止本机全部云同步、退出官方云账号并清空全部软件数据。': 'This cannot be undone. It stops all cloud sync, signs out of the cloud account and clears all app data.',
    '秒后可点击「确认清空」；期间无法关闭本窗口。': 'seconds until Confirm clear is available. This window cannot be closed meanwhile.',
    '秒后可点击；': 'seconds until available;',
    '字号': 'Size',
    '中文示例：服务器监控与文件管理': 'CJK sample: 服务器监控与文件管理',
    '同时作用于终端与界面文字': 'Applies to terminal and UI text',
    '英文字体': 'Latin font',
    '中文字体': 'CJK font',
    '主题配色': 'Themes',
    '选中后立即全局生效，并同步驱动终端 ANSI 色板。': 'Applies instantly and also updates the terminal ANSI palette.',
    '界面缩放': 'UI scale',
    '整个窗口按比例放大，适合高分屏或离屏幕较远时使用。默认 100%。': 'Scales the whole window for high-DPI screens. Default 100%.',
    '缩放比例': 'Zoom',
    '恢复 100%': 'Reset 100%',
    '（默认）': ' (default)',
    '切换后会先预览效果，确认显示正常再保存，若界面已经大到看不清，按 Ctrl + Shift + 0 可随时复位。': 'A preview is shown first. Press Ctrl + Shift + 0 at any time if the UI becomes unreadable.',
    '额外主题配色': 'More themes',
    '在上方主题之外提供的额外配色方案，选中后立即全局生效，并同步驱动终端 ANSI 色板。': 'Extra color schemes. Selecting one applies instantly and updates the terminal palette.',
    '点击右侧框后直接按下组合键即可录制；按 Esc 取消。Ctrl+C 在有选中文本时复制，无选中时发送中断信号（SIGINT）。': 'Click a field and press a key combination to record it; Esc cancels. Ctrl+C copies when text is selected, otherwise sends SIGINT.',
    '鼠标按键': 'Mouse buttons',
    '在终端区域按下对应鼠标键时执行的操作。默认：中键粘贴、右键弹出菜单。': 'Action for each mouse button in the terminal. Default: middle paste, right menu.',
    '中键': 'Middle',
    '右键': 'Right',
    '右键菜单包含': 'Context menu items',
    '菜单功能 - 复制': 'Menu - Copy',
    '菜单功能 - 粘贴': 'Menu - Paste',
    '终端 - 复制': 'Terminal - Copy',
    '终端 - 粘贴': 'Terminal - Paste',
    '终端 - 弹出菜单': 'Terminal - Menu',
    '终端 - 查找': 'Terminal - Find',
    '终端 - 重连': 'Terminal - Reconnect',
    '默认': 'Default',
    '恢复默认': 'Default',
    '下载文件夹': 'Download folder',
    '下载与目录下载默认保存到桌面「ShellFiles」文件夹；导出的配置备份也默认保存在这里。': 'Downloads and config backups are saved to ShellFiles on the desktop by default.',
    '保存位置': 'Location',
    '桌面 / ShellFiles（默认）': 'Desktop / ShellFiles (default)',
    '选择…': 'Choose…',
    '打开': 'Open',
    '代理（HTTP / SOCKS5）': 'Proxy (HTTP / SOCKS5)',
    '可配置多个代理并指定默认代理；只有一个代理时它自动成为默认。SSH 配置里可单独选择是否启用及使用哪个代理。': 'Configure multiple proxies and pick a default. A server can enable a proxy separately.',
    '＋ 添加代理': '+ Add proxy',
    '添加代理': 'Add proxy',
    '编辑代理': 'Edit proxy',
    '删除代理': 'Delete proxy',
    '还没有代理，点击下方「添加代理」': 'No proxies yet. Click Add proxy below.',
    '设为默认': 'Set default',
    '编辑': 'Edit',
    '删除': 'Delete',
    '默认代理': 'Default',
    '用户': 'User',
    '含密码': 'Has password',
    '主机': 'Host',
    '端口': 'Port',
    '类型': 'Type',
    '用户名（可选）': 'Username (optional)',
    '密码（可选）': 'Password (optional)',
    '代理认证密码': 'Proxy password',
    '请填写代理主机': 'Enter a proxy host',
    '确定删除该代理吗？引用它的连接会退回不使用代理。': 'Delete this proxy? Servers using it will fall back to a direct connection.',
    'WebDAV 云同步': 'WebDAV sync',
    'WebDAV 云同步功能已关闭，开启后才能重新配置和同步。': 'WebDAV sync is off. Enable it before configuring or syncing.',
    '同步为双向合并后本机配置进行更新，并重新上传云端备份，任何一步失败都不会清空本地数据。': 'Sync merges both sides, updates local data, then uploads a new cloud backup. Local data is kept on failure.',
    '同步开关': 'Sync switch',
    '关闭 WebDAV 云同步': 'Disable WebDAV sync',
    '启用 WebDAV 云同步': 'Enable WebDAV sync',
    '仅控制同步功能开关，不会立即执行同步。': 'Only toggles sync; does not start it.',
    '服务器地址': 'Server URL',
    '用户名': 'Username',
    '密码': 'Password',
    '同步用户名': 'Sync user',
    '配置加密密码': 'Encryption password',
    '确认加密密码': 'Confirm password',
    '已保存，留空表示不修改': 'Saved. Leave blank to keep',
    'WebDAV 认证用户名，可留空': 'WebDAV username (optional)',
    'WebDAV 密码（可留空）': 'WebDAV password (optional)',
    '至少 6 位，用于加密云端配置': 'At least 6 characters, encrypts cloud config',
    '首次设置时再输入一次': 'Enter once more on first setup',
    '保存配置': 'Save',
    '测试连接': 'Test',
    '手动同步': 'Sync now',
    '上次同步成功：': 'Last sync succeeded: ',
    '尚未同步': 'Not synced yet',
    '点击「手动同步」开始：先读取云端配置并合并，再把合并结果加密上传。': 'Click Sync now: read and merge the cloud config, then upload the encrypted result.',
    '关于 WebDAV 同步': 'About WebDAV sync',
    '由于 WebDAV 各种版本的机制各有不同，因此本程序只能基于基础 WebDAV 设计云同步功能。': 'WebDAV implementations vary, so sync uses only the basic WebDAV feature set.',
    '也就造成了无法处理自动同步导致的并发问题。': 'This means automatic sync conflicts cannot be handled.',
    '所以只能实现手动同步，且用户应避免多个客户端同时发起同步请求，避免并发问题的发生。': 'Sync is manual only. Avoid syncing from multiple clients at the same time.',
    '同步规则': 'Sync rules',
    '同步内容': 'What is synced',
    '服务器配置（地址、端口、账号、密码 / 私钥、备注、所属分组）、分组结构（最多三级）、密钥库、30 天回收站、收藏文件夹与收藏分组、快捷命令。': 'Server configs (host, port, user, password / key, note, group), group tree (up to 3 levels), key store, 30-day recycle bin, favorite folders and groups, snippets.',
    '主题、字体、布局、代理、窗口位置、命令历史与连接记录只保存在本机，不参与同步。': 'Themes, fonts, layout, proxies, window position, command history and connection logs stay local.',
    '识别与去重': 'Matching and deduplication',
    '服务器按「主机 + 端口 + 用户名」识别，分组按层级名称路径识别，密钥按名称识别，快捷命令按「板块名 + 命令」识别，收藏按「服务器 + 路径」识别，回收站按配置 ID 识别。相同标识不会重复创建，本机已有内容不会被云端覆盖。': 'Servers match by host + port + user, groups by name path, keys by name, snippets by board + command, favorites by server + path, recycle items by config ID. Duplicates are not created and local data is never overwritten by the cloud.',
    '删除同步': 'Delete sync',
    '每次同步成功都会把当次的内容清单记为基线。下次同步时，本机删除的配置会从云端剔除，云端删除的配置也会从本机移除；首次同步没有基线，只做合并、不判断删除，如需对齐删除请再同步一次。': 'A manifest is kept after each sync. Next time, local deletions are removed from the cloud and cloud deletions from local. The first sync only merges; sync again to align deletions.',
    '冲突与并发': 'Conflicts',
    '两端同时修改同一台配置时保留本机内容，不会被云端旧配置覆盖。同一同步用户名在多台设备上并发同步时，最后上传的一方会覆盖云端文件，建议依次同步、避免同时操作。': 'If both sides change the same server, local data wins. Concurrent syncs from multiple devices are last-writer-wins; sync one device at a time.',
    '失败处理': 'Failures',
    '读取云端、解密、合并、上传任一步失败都会中止，本地配置保持不变；失败后状态显示「云同步失败」，修正网络或密码后可重新同步。': 'Any failed step aborts the sync and keeps local data. Fix the network or password, then sync again.',
    '目录联动': 'Directory sync',
    '终端与文件管理器': 'Terminal and file manager',
    '启用目录联动': 'Enable directory sync',
    '开启后连接时会向 shell 注入轻量钩子，终端里执行 cd 后文件管理器自动跟随；注入命令不会写入 shell 历史。关闭后不注入任何命令，文件管理器仍可手动「CD 目录」。': 'Injects a small shell hook so the file manager follows cd in the terminal. The hook is not written to shell history. When off, no commands are injected and you can still use CD manually.',
    '单击运行': 'Click to run',
    '允许单击命令直接运行': 'Allow running a snippet with one click',
    '开启后，标记为「点击直接执行」的命令单击即运行（默认）。关闭后，单击任何命令都只填入命令编辑器，需手动确认再发送，避免误触。': 'When on, snippets marked run-on-click execute immediately. When off, clicking only fills the command editor.',
    '窗口与布局': 'Window and layout',
    '恢复初始状态': 'Restore initial state',
    '重置窗口位置': 'Reset window position',
    '将窗口恢复到初次启动时的默认大小与位置（贴靠屏幕右侧），并恢复默认面板布局与 100% 界面缩放。': 'Restores the initial window size and position, the default panel layout and 100% zoom.',
    '全局速率单位': 'Global rate unit',
    '修改后影响整个软件的速率显示；下面的具体项可单独覆盖。默认 Mbps。': 'Affects all rate displays. Individual items below can override it. Default Mbps.',
    '全局单位': 'Global unit',
    'Mbps（兆比特 / 秒）': 'Mbps (megabits / s)',
    'MB/s（兆字节 / 秒）': 'MB/s (megabytes / s)',
    '具体项': 'Per item',
    '未单独设置时跟随全局单位。': 'Unset items follow the global unit.',
    '服务器监控图表': 'Server chart',
    '网络连接详情': 'Network details',
    '跟随全局': 'Follow global',
    '板块显示 / 隐藏': 'Panel visibility',
    '取消勾选即隐藏对应板块。隐藏右侧服务器信息时，终端向右扩展，右下角命令编辑器保持独立显示。': 'Uncheck to hide a panel. Hiding server info lets the terminal expand; the command editor stays independent.',
    '左侧 · 服务器列表': 'Left · Servers',
    '左侧 · CPU / 内存 / 磁盘': 'Left · CPU / Memory / Disk',
    '左侧 · 底部状态栏': 'Left · Status bar',
    '中间 · 终端标签栏': 'Center · Tabs',
    '中间 · 命令输入栏': 'Center · Command bar',
    '下方面板 · 文件管理': 'Bottom · Files',
    '下方面板 · 快捷命令': 'Bottom · Snippets',
    '右侧 · 服务器信息': 'Right · Server info',
    '右下 · 命令编辑器': 'Bottom right · Command editor',
    '清空软件数据': 'Clear app data',
    '清空服务器配置、分组、密钥库、收藏文件夹、快捷命令、命令历史与全部设置，恢复为首次启动状态。': 'Clears servers, groups, key store, favorites, snippets, command history and all settings, restoring first-run state.',
    '此操作不可恢复。': 'This cannot be undone.',
    '清空前会先停止本机的全部云同步服务，再清除 WebDAV 配置和官方云服务登录信息，最后清空本机数据。': 'Cloud sync stops first, then WebDAV config and cloud login are cleared, then local data is wiped.',
    '不会关闭账号在其他设备上的云同步；本机空服务器列表也不会被上传到云端。': 'Cloud sync on other devices is not affected, and the empty list is not uploaded.',
    '清空软件数据…': 'Clear app data…',
    '设置存储': 'Storage',
    '配置文件：': 'Config file: ',
    '作者：': 'Author: ',
    '（未知路径）': '(unknown path)',
    '（便携版）': ' (portable)',
    '保存新的缩放比例？': 'Save the new zoom level?',
    '界面已切换到': 'UI zoom is now',
    '原比例': 'was',
    '请确认显示是否正常。': 'Check that everything looks right.',
    '秒后可点击；': 'seconds until available;',
    '点「恢复」或关闭窗口会自动回到': 'Restore or closing the dialog returns to',
    '确认清空': 'Confirm clear',
    '再次确认清空': 'Confirm clear again',
    '正在停止本机云同步并清空…': 'Stopping cloud sync and clearing…',
    '软件数据已清空，本机云同步已停止，官方云账号信息已清除': 'App data cleared, cloud sync stopped, account information removed',
    '将重置主题、字体、鼠标、快捷键、板块与目录联动设置（不影响已保存的服务器配置）。': 'Resets theme, fonts, mouse, shortcuts, panels and directory sync. Saved servers are not affected.',
    '已恢复默认设置': 'Default settings restored',
    '界面缩放已复位为 100%': 'UI zoom reset to 100%',
    '已保存界面缩放：': 'Zoom saved: ',
    '已恢复界面缩放：': 'Zoom restored: ',
    '正在测试连接…': 'Testing connection…',
    '正在请求 WebDAV 服务器，请稍候。': 'Contacting the WebDAV server…',
    '连接成功，已找到云端配置': 'Connected, cloud config found',
    '连接成功': 'Connected',
    '连接测试失败': 'Connection test failed',
    '点击「手动同步」即可双向合并并汇总云端。': 'Click Sync now to merge both sides.',
    '云端还没有配置，首次同步会把本机配置完整上传。': 'The cloud is empty. The first sync uploads the full local config.',
    '正在同步…': 'Syncing…',
    '1/3 读取并解密云端配置': '1/3 Read and decrypt cloud config',
    '2/3 按「上次同步基线」双向合并新增与删除': '2/3 Merge additions and deletions using the last baseline',
    '3/3 重新加密并上传合并结果': '3/3 Re-encrypt and upload the merged result',
    '同步成功': 'Sync complete',
    '同步失败（本地数据未改动）': 'Sync failed (local data unchanged)',
    '常见原因：WebDAV 地址或密码错误、配置加密密码不正确、云端文件损坏、网络不可达。': 'Common causes: wrong WebDAV URL or password, wrong encryption password, corrupted cloud file, network unreachable.',
    '修正后可重新点击「手动同步」。': 'Fix the issue, then click Sync now again.',
    'WebDAV 配置已保存': 'WebDAV config saved',
    'WebDAV 云同步已启用': 'WebDAV sync enabled',
    'WebDAV 云同步已关闭': 'WebDAV sync disabled',
    '配置已保存': 'Saved',
    '保存失败': 'Save failed',
    '请填写同步用户名，用于确定云端文件名': 'Enter the sync user used to name the cloud file',
    '请填写配置加密密码后再同步': 'Enter the encryption password before syncing',
    '缺少同步用户名': 'Sync user is missing',
    '缺少配置加密密码': 'Encryption password is missing',
    '配置加密密码至少 6 位': 'Encryption password must be at least 6 characters',
    '两次输入的配置加密密码不一致': 'Encryption passwords do not match',
    '已保存在本机': 'Saved locally',
    '已写入本机的 WebDAV 地址、认证信息与同步用户名。': 'WebDAV URL, credentials and sync user saved locally.',
    '下一步可点击「测试连接」检查是否可访问，或直接「手动同步」。': 'Use Test to check access, or Sync now directly.',
    '跳过重复项：': 'Skipped duplicates: ',
    '项（主机 + 端口 + 用户名相同）': ' items (same host + port + user)',
    '本次为首次同步（还没有历史基线），只做了合并；如需把本机删除同步到云端，请再点一次「手动同步」。': 'First sync has no baseline and only merged. Click Sync now again to push local deletions.',
    '完成时间：': 'Finished: ',
    '本机 → 云端：已上传': 'Local → cloud: uploaded',
    '云端 → 本机：合并新增': 'Cloud → local: added',
    '云端 → 本机：新增': 'Cloud → local: added',
    '云端已删除 → 本机同步删除：': 'Deleted in cloud → removed locally: ',
    '本机已删除 → 云端同步删除：': 'Deleted locally → removed in cloud: ',
    '台服务器': ' servers',
    '个分组': ' groups',
    '个收藏文件夹': ' favorite folders',
    '个收藏': ' favorites',
    '个回收站配置': ' recycle items',
    '条快捷命令': ' snippets',
    '个密钥': ' keys',
    '含密钥与快捷命令': ' with keys and snippets',
    '同步完成 · 新增': 'Sync done · added'
  });

  /* ---- 云账号 ---- */
  Object.assign(EN, {
    '登录云服务': 'Sign in to LIULI Cloud',
    '登录 / 注册': 'Sign in / Register',
    '注册': 'Register',
    '邮箱': 'Email',
    '邮箱前缀': 'Email prefix',
    '邮箱验证码': 'Email code',
    '6 位数字': '6-digit code',
    '获取验证码': 'Send code',
    '至少 6 位': 'At least 6 characters',
    '重复密码': 'Confirm password',
    '再次输入密码': 'Re-enter password',
    '邀请码（选填）': 'Invite code (optional)',
    '填写好友邀请码': 'Enter a friend invite code',
    'LIULI Shell 云服务': 'LIULI Shell Cloud',
    '账号状态': 'Status',
    '云服务到期': 'Cloud expires',
    '点击购买 / 续费': 'Buy / renew',
    '我的邀请码': 'My invite code',
    '点击复制': 'Click to copy',
    '云端用量': 'Cloud usage',
    '云同步服务 - 关闭': 'Cloud sync - Off',
    '开启 / 关闭云同步': 'Toggle cloud sync',
    '未开启云同步服务': 'Cloud sync is off',
    '立即同步': 'Sync now',
    '退出登录': 'Sign out',
    '最新版本': 'Latest version',
    '打开官网 shell.minecft.cn': 'Open shell.minecft.cn',
    '读取本地配置失败': 'Failed to read local config',
    '读取失败': 'Read failed',
    '配置不存在': 'Config not found',
    '两次输入的密码不一致': 'Passwords do not match',
    '请输入配置文件密码': 'Enter the config password',
    '请输入内容': 'Enter a value',
    '取消': 'Cancel',
    '保存': 'Save',
    '确定': 'OK',
    '标题': 'Title',
    '操作失败': 'Operation failed',
    '未知错误': 'Unknown error',
    '请先连接服务器': 'Connect to a server first',
    '没有匹配的连接': 'No matching hosts',
    '还没有保存的连接<br>点击「＋ 新增配置」添加': 'No saved hosts yet.<br>Click + New to add one.',
    '暂无配置': 'No hosts',
    '暂无收藏': 'No favorites',
    '还没有收藏文件夹<br/><span>在目录树或文件列表右键「收藏此目录」，也可以点上方「＋ 收藏当前」</span>': 'No favorite folders yet.<br><span>Right-click a folder and choose Add to favorites.</span>',
    '还没有代理，点击下方「添加代理」': 'No proxies yet. Click Add proxy below.',
    '该分组下没有服务器配置': 'No hosts in this group',
    '重命名分组': 'Rename group',
    '重命名分组…': 'Rename group…',
    '删除分组': 'Delete group',
    '新建子分组': 'New subgroup',
    '新建子分组…': 'New subgroup…',
    '在此分组新建子分组…': 'New subgroup here…',
    '在此分组新增 SSH 配置': 'Add an SSH host here',
    '在此分组新增配置': 'Add a host here',
    '分组名称': 'Group name',
    '分组名称已存在': 'Group name already exists',
    '请输入分组名称': 'Enter a group name',
    '分组已创建': 'Group created',
    '子分组已创建': 'Subgroup created',
    '分组已删除，配置已移入回收站': 'Group deleted. Hosts moved to the recycle bin.',
    '默认分组': 'Default',
    '展开分组': 'Expand group',
    '折叠分组': 'Collapse group',
    '上移分组': 'Move group up',
    '下移分组': 'Move group down',
    '分组操作（排序 / 重命名 / 删除）': 'Group actions (order / rename / delete)',
    '已移动': 'Moved',
    '移动分组失败': 'Failed to move group',
    '排序失败': 'Sort failed',
    '创建分组失败': 'Failed to create group',
    '缺少名称': 'Missing name',
    '名称不能包含路径分隔符': 'Name cannot contain path separators',
    '文件名': 'File name',
    '文件夹名称': 'Folder name',
    '新名称': 'New name'
  });

  /* ---- 导入 / 导出 / FinalShell ---- */
  Object.assign(EN, {
    '导出配置（加密）': 'Export config (encrypted)',
    '导出配置（加密）…': 'Export config (encrypted)…',
    '导入配置': 'Import config',
    '导入配置…': 'Import config…',
    '导入 FinalShell 配置': 'Import FinalShell config',
    '导入 FinalShell 配置…': 'Import FinalShell config…',
    '导入 FinalShell 配置 - LIULI Shell': 'Import FinalShell config - LIULI Shell',
    '选择保存位置': 'Choose a save location',
    '选择文件并导入': 'Choose a file to import',
    '导出密码至少 6 位': 'Export password must be at least 6 characters',
    '已导出': 'Exported',
    '已取消导出': 'Export cancelled',
    '已取消导入': 'Import cancelled',
    '导入完成：新增': 'Import done: added',
    '个，跳过': ', skipped',
    '开始导入': 'Start import',
    '导入计划': 'Import plan',
    '目标分组': 'Target group',
    '选择 JSON 文件': 'Choose JSON file',
    '选择文件夹': 'Choose folder',
    '拖入 JSON 文件或文件夹': 'Drop JSON files or folders',
    '也可以点击下面按钮选择': 'Or choose with the buttons below',
    '尚未选择文件': 'No files selected',
    '仅用于直接选择的 JSON 文件': 'Only applies to directly selected JSON files',
    '识别字段：name / host / port / user_name / password': 'Fields: name / host / port / user_name / password',
    '文件夹按层级自动创建分组（最多三级），三级以下文件夹内的 JSON 会归入对应的一级分组，不受目标分组影响。': 'Folders create groups by level (max 3). JSON deeper than 3 levels goes to the matching top-level group.',
    '支持多个 JSON 文件或文件夹；文件夹会按层级自动创建分组（最多三级），三级以下文件夹内的配置归入对应的一级分组。能解密的密码会导入并加密保存，无法解密的密码保持为空。': 'Supports multiple JSON files or folders. Folder levels create groups (max 3). Decryptable passwords are imported and re-encrypted; others stay empty.',
    '文件编辑器 - LIULI Shell': 'File editor - LIULI Shell',
    '下载管理器 - LIULI Shell': 'Downloads - LIULI Shell',
    '文件编辑器': 'File editor',
    '编辑': 'Edit',
    '查找': 'Find',
    '替换': 'Replace',
    '要查找的内容': 'Find text',
    '替换为（可留空）': 'Replace with (optional)',
    '区分大小写': 'Match case',
    '全部替换': 'Replace all',
    '上一个 (Shift+Enter)': 'Previous (Shift+Enter)',
    '下一个 (Enter)': 'Next (Enter)',
    '关闭当前标签': 'Close tab',
    '保存 (Ctrl+S)': 'Save (Ctrl+S)',
    '等待打开文件…': 'Waiting for a file…',
    '正在加载…': 'Loading…',
    '定位行': 'Go to line',
    '· 未保存': ' · Unsaved',
    '双击主窗口中的文件即可编辑（仅支持 < 10MB 的 UTF-8 文本）': 'Double-click a file in the main window to edit (UTF-8 text under 10 MB)'
  });

  /* ---- 下载管理器 ---- */
  Object.assign(EN, {
    '清理已完成': 'Clear finished',
    '清除已完成': 'Clear finished',
    '全部暂停': 'Pause all',
    '全部取消': 'Cancel all',
    '打开下载文件夹': 'Open folder',
    '0 个任务': '0 tasks',
    '右键任务可暂停 / 取消、打开所在文件夹、复制路径或移除记录；「全部取消」会删除未完成文件': 'Right-click a task to pause, cancel, open its folder, copy the path or remove it. Cancel all deletes unfinished files.',
    '作者 LIULIWANJIA': 'By LIULIWANJIA'
  });

  /* ---- SSH 配置 / 密钥库 ---- */
  Object.assign(EN, {
    '新增 SSH 配置': 'New SSH host',
    '新增 SSH 配置…': 'New SSH host…',
    '编辑 SSH 配置': 'Edit SSH host',
    '新增一级分组': 'New group',
    '编辑配置': 'Edit',
    '分组': 'Group',
    '主机': 'Host',
    '端口': 'Port',
    '认证方式': 'Authentication',
    '密码': 'Password',
    '密钥': 'Key',
    '密钥来源': 'Key source',
    '＋ 导入密钥': '+ Import key',
    '私钥': 'Private key',
    '选择文件…': 'Choose file…',
    '私钥口令（可选）': 'Key passphrase (optional)',
    '备注': 'Note',
    '无': 'None',
    '代理': 'Proxy',
    '启用代理': 'Use proxy',
    '不启用代理': 'No proxy',
    '直连': 'Direct',
    '默认代理': 'Default proxy',
    '保存到密钥库': 'Save to key store',
    '密钥名称': 'Key name',
    '私钥内容': 'Private key',
    '导入 SSH 私钥': 'Import SSH key',
    '＋ 导入新密钥': '+ Import key',
    '密钥库': 'Key store',
    '密钥库…': 'Key store…',
    '密钥库（导入 / 管理私钥）': 'Key store (import / manage keys)',
    '密钥库还是空的，点击右上角「导入新密钥」添加': 'The key store is empty. Click Import key above.',
    '私钥使用系统安全存储加密，仅在连接时解密使用': 'Keys are encrypted with the system secure store and decrypted only when connecting.',
    '建议先「＋ 导入密钥」命名保存，之后所有服务器都能直接选用，无需重复粘贴。': 'Import and name the key once, then select it for any server without pasting again.',
    '请粘贴私钥内容或选择文件': 'Paste the private key or choose a file',
    '请填写密钥名称': 'Enter a key name',
    '密钥已保存到密钥库': 'Key saved to the key store',
    '含口令': 'Passphrase',
    '无指纹': 'No fingerprint',
    '删除密钥': 'Delete key',
    '保存到密钥库后，可直接按名称选择': 'Save to the key store to select it by name',
    '手动粘贴': 'Paste manually',
    '手动粘贴 / 选择私钥文件': 'Paste or choose a key file',
    '＋ 导入新密钥…': '+ Import key…',
    '请填写名称': 'Enter a name',
    '请填写主机地址': 'Enter a host',
    '请填写用户名': 'Enter a username',
    '例如：生产 Web-01': 'e.g. Web-01',
    '例如：生产环境': 'e.g. Production',
    '例如：华东节点': 'e.g. East node',
    '例如：办公代理': 'e.g. Office proxy',
    '例如：生产环境-运维密钥': 'e.g. prod-ops-key',
    '私钥未加密则留空': 'Leave blank if the key is not encrypted',
    '可留空，连接时再输入': 'Optional. Enter when connecting.',
    '允许留空保存：连接时会弹出凭据浮窗，输入后可直接选择是否写回配置。': 'You can save without a password. A credentials dialog appears when connecting and can optionally write it back.',
    '保存后立即连接': 'Connect right after saving',
    '清除 MOTD 信息（连接后清屏）': 'Clear MOTD after connecting',
    '把私钥命名后保存到密钥库': 'Save the key to the key store with a name',
    '未选择文件': 'No file selected',
    '已保存私钥，留空表示不修改': 'Key saved. Leave blank to keep.',
    '粘贴私钥内容（OpenSSH / PEM）': 'Paste a private key (OpenSSH / PEM)',
    'IP 或域名': 'IP or domain',
    '未分组': 'Ungrouped',
    '配置已创建': 'Host created',
    '配置信息已复制': 'Host info copied',
    '已复制': 'Copied',
    '复制失败': 'Copy failed',
    '已复制配置': 'Host copied',
    '请先复制一个服务器配置': 'Copy a host first',
    '源配置已删除，请重新复制': 'The source host was deleted. Copy it again.',
    '暂不支持跨服务器粘贴': 'Pasting across servers is not supported',
    '粘贴失败': 'Paste failed',
    '配置已粘贴': 'Host pasted',
    '移动服务器': 'Move host',
    '已复制配置信息': 'Host info copied',
    '检查IP信息': 'Check IP info',
    'IP 信息': 'IP info',
    '查询失败': 'Lookup failed',
    '无法解析域名：请确认域名拼写或网络 DNS 正常': 'Cannot resolve the domain. Check its spelling or your DNS.',
    '未找到该地址的归属信息：请确认域名已解析，或填写有效的公网 IP': 'No location data was found. Make sure the domain resolves, or enter a public IP.',
    'IP 地址': 'IP address',
    '类型': 'Type',
    '本机 / 内网地址': 'Local / private address',
    '内网地址不进行公网归属查询。': 'Private addresses are not looked up.',
    '正在查询…': 'Looking up…',
    '国家 / 地区': 'Country / region',
    '省 / 州': 'Province / state',
    '城市': 'City',
    '时区': 'Time zone',
    '经纬度': 'Coordinates',
    '组织': 'Organization',
    '中国': 'China',
    '连接': 'Connect',
    '仅连接此台': 'Connect this one',
    '通过默认代理连接': 'Connect via default proxy',
    '直接连接': 'Connect directly',
    '仅连接此台（经代理）': 'Connect this one (proxy)',
    '连接所选服务器': 'Connect selected',
    '连接全部': 'Connect all',
    '通过默认代理连接所选': 'Connect selected via proxy',
    '直接连接所选': 'Connect selected directly',
    '取消多选': 'Clear selection',
    '删除配置': 'Delete',
    '再次确认删除': 'Confirm delete',
    '移入回收站': 'Move to recycle bin',
    '仅连接此台': 'Connect this one',
    '该分组下没有服务器配置': 'No hosts in this group',
    '连接全部（重连': 'Reconnect all (',
    '个断开项）': ' offline)',
    '正在连接': 'Connecting',
    '已移入回收站': ' moved to recycle bin',
    '删除失败': 'Delete failed',
    '移动失败': 'Move failed',
    '配置不存在': 'Config not found'
  });

  /* ---- 文件管理 ---- */
  Object.assign(EN, {
    '目录为空': 'Empty folder',
    '加载中…': 'Loading…',
    '其他': 'Other',
    '所有者': 'Owner',
    '群组': 'Group',
    '写入': 'Write',
    '读取': 'Read',
    '执行': 'Execute',
    '根目录': 'Root',
    '不能删除根目录': 'Cannot delete the root directory',
    '文件名不能包含路径分隔符': 'File names cannot contain path separators',
    '请输入文件夹路径': 'Enter a folder path',
    '请输入分组名称': 'Enter a group name',
    '新建文件': 'New file',
    '新建文件…': 'New file…',
    '新建文件夹': 'New folder',
    '新建文件夹…': 'New folder…',
    '重命名': 'Rename',
    '修改名称 / 路径…': 'Edit name / path…',
    '删除确认': 'Delete',
    '确认': 'Confirm',
    '确认删除': 'Confirm delete',
    '覆盖文件': 'Overwrite',
    '重命名后粘贴': 'Paste with a new name',
    '目标已存在同名项目': 'An item with the same name already exists',
    '目标目录已存在同名文件或文件夹': 'The target already has an item with the same name',
    '权限管理': 'Permissions',
    '权限设置失败': 'Failed to set permissions',
    '打包传输': 'Pack and download',
    '打包失败': 'Pack failed',
    '已打包下载：': 'Packed for download: ',
    '上传文件…': 'Upload files…',
    '上传文件夹…': 'Upload folder…',
    '下载所选': 'Download selected',
    '复制路径': 'Copy path',
    '复制位置路径': 'Copy location',
    '已复制路径': 'Path copied',
    '已复制到剪贴板': 'Copied to clipboard',
    '剪贴板为空，请先复制': 'Clipboard is empty. Copy something first.',
    '进入目录': 'Open folder',
    '进入此文件夹': 'Open this folder',
    'CD 目录': 'CD into folder',
    '收藏此目录': 'Add to favorites',
    '收藏当前文件夹到此分组': 'Add current folder to this group',
    '取消收藏': 'Remove favorite',
    '收藏失败': 'Failed to add favorite',
    '此目录已在收藏中': 'Already in favorites',
    '该目录已在收藏中': 'Already in favorites',
    '分组名称已存在': 'That group name already exists',
    '收藏文件夹': 'Favorite folders',
    '新建收藏分组（仅一级，会随云同步）': 'New favorite group (top level, synced)',
    '搜索名称或路径…': 'Search name or path…',
    '显示名称': 'Display name',
    '/绝对路径': '/absolute/path',
    '已创建': 'Created',
    '已删除': 'Deleted',
    '已重命名': 'Renamed',
    '已写入': 'Saved',
    '操作失败': 'Operation failed',
    '读取失败': 'Read failed',
    '保存失败': 'Save failed',
    '创建失败': 'Create failed',
    '粘贴失败': 'Paste failed',
    '重命名失败': 'Rename failed',
    '移动失败': 'Move failed',
    '上传失败': 'Upload failed',
    '下载失败': 'Download failed',
    '删除失败': 'Delete failed',
    '读取目录失败': 'Failed to read folder',
    '无法读取目录': 'Cannot read folder',
    '读取目标目录失败': 'Failed to read target folder',
    '已选择': 'Selected',
    '未选择': 'Not selected',
    '目录树': 'Folder tree',
    '连接已断开': 'Disconnected'
  });

  /* ---- 快捷命令 / 历史 / 回收站 / 最近连接 ---- */
  Object.assign(EN, {
    '板块名称': 'Board name',
    '新增板块': 'New board',
    '新增快捷命令': 'New snippet',
    '编辑快捷命令': 'Edit snippet',
    '重命名板块': 'Rename board',
    '删除板块': 'Delete board',
    '新增命令到该板块': 'New snippet in this board',
    '立即执行': 'Run now',
    '填入命令编辑器': 'Load into editor',
    '复制命令': 'Copy command',
    '所属板块': 'Board',
    '命令': 'Command',
    '例如：数据库': 'e.g. Database',
    '例如：查看磁盘': 'e.g. Check disk',
    '例如：查看磁盘': 'e.g. Check disk',
    '该板块还没有命令，点击「＋ 快捷命令」添加': 'No snippets in this board. Click + Snippet.',
    '还没有板块，点击「＋ 板块」创建': 'No boards yet. Click + Board.',
    '请先创建板块': 'Create a board first',
    '请先输入命令': 'Enter a command first',
    '请填写名称': 'Enter a name',
    '请填写命令': 'Enter a command',
    '命令已复制': 'Command copied',
    '命令已更新': 'Command updated',
    '命令已添加': 'Command added',
    '已填入命令编辑器': 'Loaded into the command editor',
    '找不到命令编辑器，请先在设置里显示它': 'Command editor is hidden. Enable it in Settings.',
    '命令历史': 'Command history',
    '清空命令历史': 'Clear command history',
    '清空全部': 'Clear all',
    '筛选命令…': 'Filter commands…',
    '暂无历史命令，发送一条命令后会自动记录': 'No history yet. Sent commands are recorded automatically.',
    '没有匹配的命令': 'No matching commands',
    '回收站为空': 'Recycle bin is empty',
    '还原配置': 'Restore',
    '永久删除': 'Delete permanently',
    '已永久删除': 'Deleted permanently',
    '已还原到「回收站还原」分组': 'Restored to the Recycle bin restore group',
    '即将删除': 'About to delete',
    '删除失败': 'Delete failed',
    '还原失败': 'Restore failed',
    '暂无最近连接': 'No recent connections',
    '清空最近连接': 'Clear recent',
    '确定清空全部历史记录吗？': 'Clear all recent connections?',
    '该连接配置已被删除，请从最近连接中移除': 'This host was deleted. Remove it from Recent.',
    '快速连接': 'Quick connect'
  });

  /* ---- 终端 / 状态 / 侧栏 ---- */
  Object.assign(EN, {
    '新建空白标签页': 'New tab',
    '关闭当前': 'Close current',
    '关闭其他': 'Close others',
    '关闭全部': 'Close all',
    '关闭当前标签': 'Close tab',
    '连接全部（重连': 'Reconnect all (',
    '会话已结束': 'Session ended',
    '连接已断开': 'Disconnected',
    '已连接': 'Connected',
    '已断开': 'Disconnected',
    '连接中': 'Connecting',
    '连接中…': 'Connecting…',
    '连接不稳定': 'Unstable',
    '未启用': 'Disabled',
    '正在建立 SSH 会话…': 'Opening SSH session…',
    '正在通过代理建立 SSH 会话…': 'Opening SSH session via proxy…',
    '正在用本地网络建立 SSH 会话…': 'Opening SSH session directly…',
    '正在连接…': 'Connecting…',
    '该服务器还没有保存登录密码': 'No saved password for this host',
    '该服务器还没有可用密钥': 'No usable key for this host',
    '连接已断开，无法输入。右键标签选择「连接」重新连接': 'Disconnected. Right-click the tab and choose Connect.',
    '关闭当前终端': 'Close terminal',
    '关闭当前标签': 'Close tab',
    '双击复制地址：': 'Double-click to copy: ',
    '请先连接服务器': 'Connect to a server first',
    '未配置 WebDAV 云同步': 'WebDAV sync not configured',
    '待同步': 'Pending',
    '云同步成功': 'Cloud sync complete',
    '云同步刚刚完成': 'Cloud sync just finished',
    '云同步失败': 'Cloud sync failed',
    '云同步已关闭': 'Cloud sync is off',
    '云同步已就绪': 'Cloud sync ready',
    '云同步已开启，等待首次同步': 'Cloud sync on, waiting for first sync',
    '已开启云同步，等待首次同步': 'Cloud sync on, waiting for first sync',
    '已配置 WebDAV，等待同步': 'WebDAV configured, waiting to sync',
    '已配置 WebDAV，尚未同步': 'WebDAV configured, not synced yet',
    'WebDAV 云同步已关闭，可在设置中启用': 'WebDAV sync is off. Enable it in Settings.',
    '正在与 WebDAV 同步配置': 'Syncing with WebDAV',
    '正在与云端双向合并配置': 'Merging with the cloud',
    '正在云同步…': 'Cloud syncing…',
    '本机配置已修改，点击同步到云端（上次成功：': 'Local changes pending. Click to sync (last success: ',
    '本机配置已修改，稍后自动同步（上次成功：': 'Local changes will sync automatically (last success: ',
    '上次同步成功：': 'Last sync: ',
    '上次同步未完成': 'Last sync incomplete',
    '尚未成功同步过': 'Never synced',
    '点击打开当前同步设置': 'Open sync settings',
    '当前同步设置…': 'Current sync settings…',
    '软件设置…': 'Settings…',
    '欢迎使用 LIULI Shell\n点击左侧「＋ 新增配置」添加第一台服务器': 'Welcome to LIULI Shell\nClick + New on the left to add your first server',
    '布局、窗口位置与缩放已重置': 'Layout, window position and zoom reset',
    '已显示服务器列表': 'Servers shown',
    '已隐藏服务器列表': 'Servers hidden',
    '显示服务器列表': 'Show servers',
    '隐藏服务器列表': 'Hide servers',
    '显示服务器信息': 'Show server info',
    '隐藏服务器信息': 'Hide server info',
    '显示服务器信息面板': 'Show server info',
    '隐藏服务器信息面板': 'Hide server info',
    '展开下方面板': 'Expand bottom panel',
    '收起下方面板': 'Collapse bottom panel',
    '重新加载': 'Reload',
    '重置布局': 'Reset layout',
    '退出': 'Quit',
    '官方网站': 'Website',
    '作者：LIULIWANJIA': 'Author: LIULIWANJIA',
    '无法打开官网': 'Cannot open the website'
  });

  /* ---- 服务器信息 / 进程 / 网络详情 ---- */
  Object.assign(EN, {
    '空闲': 'Idle',
    '读取失败：': 'Read failed: ',
    '正在读取服务器信息…': 'Reading server info…',
    '暂无网络接口数据': 'No interface data',
    '暂无文件系统数据': 'No filesystem data',
    '服务器详情': 'Server details',
    '进程列表': 'Processes',
    '网络连接': 'Network',
    '监听IP': 'Listen IP',
    '连接数': 'Conns',
    '位置': 'Location',
    '名称 / 命令行': 'Name / command line',
    '读取进程失败：': 'Failed to read processes: ',
    '读取网络失败：': 'Failed to read network: ',
    '结束进程': 'Kill process',
    '结束进程 (SIGTERM)': 'Kill process (SIGTERM)',
    '强制结束 (SIGKILL)': 'Force kill (SIGKILL)',
    '结束进程失败：': 'Failed to kill process: ',
    '复制 PID': 'Copy PID',
    '复制地址': 'Copy address',
    '复制端口': 'Copy port',
    '复制对端 IP': 'Copy peer IP',
    '复制监听端口': 'Copy listen port',
    '复制监听IP': 'Copy listen IP',
    '复制名称': 'Copy name',
    '复制名称 / 命令行': 'Copy name / command',
    '复制命令行': 'Copy command line',
    '复制用户': 'Copy user',
    '复制整行': 'Copy row',
    '过滤关键字': 'Filter',
    '进程预览': 'Processes',
    '该进程没有 PID（可能权限不足）': 'No PID for this process (permission denied?)'
  });

  /* ---- 认证提示 / 导入导出 / 下载 / 编辑器 ---- */
  Object.assign(EN, {
    '需要口令': 'Passphrase required',
    '重新连接': 'Reconnect',
    '请输入登录用户名': 'Enter the login username',
    '请输入登录密码': 'Enter the login password',
    '登录用户名': 'Login username',
    '私钥口令（可选）': 'Key passphrase (optional)',
    '请选择 / 粘贴私钥，或填写私钥口令': 'Choose or paste a key, or enter its passphrase',
    '将直接使用密钥库中的私钥（含已保存口令）连接，无需再输入口令。': 'Uses the stored key and passphrase; no prompt needed.',
    '将直接使用密钥库中的私钥连接；若连接提示需要口令，会自动显示口令输入框。': 'Uses the stored key. A passphrase prompt appears only if required.',
    '密钥库不可用': 'Key store unavailable',
    '连接成功，配置已保存': 'Connected and saved',
    '连接成功，但保存配置失败：': 'Connected, but saving failed: ',
    '正在连接…': 'Connecting…',
    '密码将使用 AES / 系统安全存储加密保存在本机，不会明文落盘。': 'Passwords are encrypted with AES / the system secure store and never saved in plain text.',
    '请输入内容': 'Enter a value',
    '已取消导出': 'Export cancelled',
    '已取消导入': 'Import cancelled',
    '导出配置（加密）': 'Export config (encrypted)',
    '导入配置': 'Import config',
    '导出密码至少 6 位': 'Export password must be at least 6 characters',
    '至少 6 位，导入到其他机器时需要': 'At least 6 characters, needed on other machines',
    '再次输入': 'Enter again',
    '导出时设置的密码': 'Password set during export',
    '导入时会自动创建缺失的分组；已存在（主机 + 端口 + 用户名相同）的连接会被跳过。': 'Missing groups are created automatically. Existing hosts (same host + port + user) are skipped.',
    '选择保存位置': 'Choose a save location',
    '选择文件并导入': 'Choose a file to import',
    '导入计划': 'Import plan',
    '开始导入': 'Start import',
    '目标分组': 'Target group',
    '选择 JSON 文件': 'Choose JSON file',
    '选择文件夹': 'Choose folder',
    '拖入 JSON 文件或文件夹': 'Drop JSON files or folders',
    '也可以点击下面按钮选择': 'Or choose with the buttons below',
    '尚未选择文件': 'No files selected',
    '仅用于直接选择的 JSON 文件': 'Only for directly selected JSON files',
    '识别字段：name / host / port / user_name / password': 'Fields: name / host / port / user_name / password',
    '下载管理器': 'Downloads',
    '下载管理器 - LIULI Shell': 'Downloads - LIULI Shell',
    '打开下载文件夹': 'Open folder',
    '全部暂停': 'Pause all',
    '全部取消': 'Cancel all',
    '清除已完成': 'Clear finished',
    '右键任务可暂停 / 取消、打开所在文件夹、复制路径或移除记录；「全部取消」会删除未完成文件': 'Right-click a task to pause, cancel, open its folder, copy the path or remove it. Cancel all deletes unfinished files.',
    '暂无下载 / 上传任务': 'No transfers',
    '进行中': 'In progress',
    '已暂停': 'Paused',
    '已完成': 'Done',
    '已取消': 'Cancelled',
    '失败': 'Failed',
    '上传': 'Upload',
    '下载': 'Download',
    '暂停上传': 'Pause upload',
    '暂停下载': 'Pause download',
    '取消上传': 'Cancel upload',
    '取消下载': 'Cancel download',
    '删除未完成文件': 'Delete unfinished file',
    '打开文件所在文件夹': 'Open containing folder',
    '复制本地路径': 'Copy local path',
    '复制远端路径': 'Copy remote path',
    '移除此记录': 'Remove record',
    '清空全部': 'Clear all',
    '已暂停，已下载分片已保留': 'Paused. Downloaded chunks are kept.',
    '已取消，未完成文件已删除': 'Cancelled. Unfinished files were deleted.',
    '已删除未完成文件': 'Unfinished file deleted',
    '已复制路径': 'Path copied',
    '没有可清除的记录': 'Nothing to clear',
    '没有进行中的任务': 'No active tasks',
    '列表已是空的': 'The list is already empty',
    '清空全部任务？进行中的任务会被取消，未完成的文件会被删除。': 'Clear all tasks? Active tasks are cancelled and unfinished files are deleted.',
    '文件编辑器': 'File editor',
    '文件编辑器 - LIULI Shell': 'File editor - LIULI Shell',
    '保存': 'Save',
    '全部保存': 'Save all',
    '关闭当前标签': 'Close tab',
    '关闭全部标签': 'Close all tabs',
    '查找 / 替换…': 'Find / Replace…',
    '定位行…': 'Go to line…',
    '自动换行': 'Word wrap',
    '· 未保存': ' · Unsaved',
    '双击主窗口中的文件即可编辑（仅支持 < 10MB 的 UTF-8 文本）': 'Double-click a file in the main window to edit (UTF-8 text under 10 MB)',
    '双击主窗口文件管理器中的文件即可在此编辑': 'Double-click a file in the main window to edit it here',
    '清空': 'Clear',
    '回收站': 'Recycle bin',
    '删除的配置保留 30 天 · 右键可还原 / 连接 / 永久删除': 'Deleted configs are kept for 30 days · right-click to restore / connect / delete permanently',
    '单击一行或点「⧉」→ 复制并填入命令输入框；双击 → 复制并关闭；点「✕」删除该条。历史保存在本地配置中，重启后仍在。': 'Click a row or ⧉ to copy and fill the command bar; double-click to copy and close; click ✕ to delete. History is stored locally and survives restarts.',
    '自动：FinalShell 导入（直接 JSON）': 'Auto: FinalShell import (direct JSON)',
    '正在加载…': 'Loading…',
    '正在加载': 'Loading',
    '等待打开文件…': 'Waiting for a file…',
    '要查找的内容': 'Find text',
    '替换为（可留空）': 'Replace with (optional)',
    '区分大小写': 'Match case',
    '替换': 'Replace',
    '全部替换': 'Replace all',
    '上一个 (Shift+Enter)': 'Previous (Shift+Enter)',
    '下一个 (Enter)': 'Next (Enter)',
    '定位行': 'Go to line',
    '没有需要保存的修改': 'No changes to save',
    '所有文件都已保存': 'All files saved',
    '打开失败：': 'Open failed: ',
    '保存失败：': 'Save failed: ',
    '已保存': 'Saved',
    '行': 'Ln',
    '列': 'Col',
    '有未保存的修改，确定关闭吗？': 'has unsaved changes. Close anyway?',
    '个文件未保存，确定全部关闭吗？': 'files have unsaved changes. Close all?'
  });

  /* ---- 主进程返回的提示 / 错误 ---- */
  Object.assign(EN, {
    '连接失败': 'Connection failed',
    '连接被服务器重置，请稍后重试': 'The connection was reset. Try again later.',
    '网络不可达，请检查网络或代理设置': 'Network unreachable. Check the network or proxy settings.',
    '代理连接失败，请检查系统代理设置': 'Proxy connection failed. Check the system proxy settings.',
    '认证失败，请检查用户名 / 密码': 'Authentication failed. Check the username and password.',
    'HTTPS 证书校验失败，请检查服务器证书是否有效': 'HTTPS certificate validation failed. Check the server certificate.',
    'TLS 握手失败，请确认端口与协议是否匹配': 'TLS handshake failed. Check the port and protocol.',
    'PuTTY (不支持，请转换)': 'PuTTY (unsupported, please convert)',
    '会话不存在': 'Session not found',
    '文件不存在': 'File not found',
    '无法读取目录': 'Cannot read folder',
    '读取目录失败': 'Failed to read folder',
    '参数错误': 'Invalid parameters',
    '未知': 'Unknown',
    '同步失败': 'Sync failed',
    '打包失败': 'Pack failed',
    '没有选择要打包的内容': 'Nothing selected to pack',
    '目录层级过深，已跳过': 'Folder nesting is too deep; skipped',
    '文件': 'File',
    '服务器': 'Server',
    '常用': 'Common',
    'FinalShell 导入': 'FinalShell import',
    'FinalShell 配置': 'FinalShell config',
    '云端导入': 'Cloud import',
    '云端新增': 'Cloud additions',
    '未命名分组': 'Unnamed group',
    '分组不存在': 'Group not found',
    '分组名不能为空': 'Group name cannot be empty',
    '最多支持三级分组': 'Only three group levels are supported',
    '至少保留一个分组': 'At least one group must remain',
    '上级分组不存在': 'Parent group not found',
    '目标分组不存在': 'Target group not found',
    '未识别到连接配置': 'No connection config found',
    '连接配置不存在': 'Connection config not found',
    '源配置不存在或已删除': 'The source config does not exist or was deleted',
    '回收站中没有该配置': 'That config is not in the recycle bin',
    '回收站还原': 'Recycle bin restore',
    '当前没有可导出的连接配置': 'No connection configs to export',
    '配置文件格式不正确': 'Invalid config file format',
    '不是有效的 LIULI Shell 配置文件': 'Not a valid LIULI Shell config file',
    '不是 JSON 文件': 'Not a JSON file',
    'JSON 解析失败': 'Failed to parse JSON',
    '导出密码至少 6 位': 'Export password must be at least 6 characters',
    '解密失败：导出密码不正确或文件已损坏': 'Decryption failed: wrong export password or corrupted file',
    '请先填写 WebDAV 地址': 'Enter the WebDAV URL first',
    '请先登录云服务账号': 'Sign in to a cloud account first',
    '请填写同步用户名（用于确定云端文件名）': 'Enter the sync user (used for the cloud file name)',
    '请先在设置中填写配置加密密码（至少 6 位）': 'Set the config encryption password in Settings first (at least 6 characters)',
    '请填写密钥名称': 'Enter a key name',
    '请粘贴或选择私钥内容': 'Paste or choose a private key',
    '请输入配置文件密码': 'Enter the config file password',
    'WebDAV 地址必须以 http:// 或 https:// 开头': 'WebDAV URL must start with http:// or https://',
    'WebDAV 地址无效，请检查填写内容': 'Invalid WebDAV URL. Check the value.',
    'WebDAV 服务器拒绝连接，请确认地址、端口与服务状态': 'WebDAV server refused the connection. Check the URL, port and service.',
    'WebDAV 端口被系统安全策略拒绝，请更换端口': 'The WebDAV port is blocked by system policy. Use another port.',
    'WebDAV 认证失败，请检查用户名 / 密码': 'WebDAV authentication failed. Check the username and password.',
    '无法连接 WebDAV 服务器': 'Cannot connect to the WebDAV server',
    '服务器返回了异常响应，请检查 WebDAV 服务': 'The server returned an unexpected response. Check the WebDAV service.',
    '重定向次数过多，请检查 WebDAV 地址': 'Too many redirects. Check the WebDAV URL.',
    '连接 WebDAV 超时，请检查网络或服务器': 'WebDAV connection timed out. Check the network or server.',
    '无法解析 WebDAV 域名，请检查地址或 DNS 网络': 'Cannot resolve the WebDAV domain. Check the address or DNS.',
    '链接格式不正确': 'Invalid link format',
    '返回内容不是有效 JSON': 'The response is not valid JSON',
    '返回内容过大': 'The response is too large',
    '连接成功，已找到云端配置': 'Connected, cloud config found',
    '连接成功，云端文件尚未创建': 'Connected, the cloud file does not exist yet',
    'WebDAV 云同步已关闭，请先在设置中启用': 'WebDAV sync is off. Enable it in Settings first.',
    'WebDAV 云同步正在进行，请等待同步结束后再清空': 'WebDAV sync is running. Wait for it to finish before clearing.',
    '官方云同步正在进行，请等待同步结束后再清空': 'Cloud sync is running. Wait for it to finish before clearing.',
    '关闭官方云同步失败，已取消启用 WebDAV：': 'Failed to disable cloud sync. Enabling WebDAV was cancelled: ',
    '云端配置解密失败：配置加密密码不正确或文件已损坏（本地数据未改动）': 'Cloud config decryption failed: wrong encryption password or corrupted file (local data unchanged)',
    '云同步未开启，请先在账号面板中打开': 'Cloud sync is off. Enable it in the account panel.',
    '云服务已到期，请先续费后再同步': 'The cloud service has expired. Renew it before syncing.',
    '云服务已到期，请先续费后再开启云同步': 'The cloud service has expired. Renew it before enabling sync.',
    '云服务请求失败': 'Cloud request failed',
    '无法连接云服务，请检查网络或稍候片刻': 'Cannot reach the cloud service. Check the network or try again.',
    '账号尚未在服务端开通云同步，请联系管理员': 'Cloud sync is not enabled for this account. Contact the administrator.',
    '多设备同步冲突次数过多，请稍后重试': 'Too many sync conflicts across devices. Try again later.',
    '正在云同步，请稍后再试': 'Cloud sync is running. Try again later.',
    '正在同步，请稍后再试': 'Sync is running. Try again later.',
    '正在清空数据，请稍后再试': 'Data is being cleared. Try again later.',
    '查询失败': 'Lookup failed',
    '查询超时': 'Lookup timed out',
    '本机或内网地址，不进行公网归属查询。': 'Local or private address. Public lookup skipped.',
    'KDF 参数过大': 'KDF parameters too large',
    'LIULI 加密配置': 'LIULI encrypted config',
    'LIULI Shell 运行异常': 'LIULI Shell error',
    '选择下载文件夹': 'Choose download folder',
    '选择私钥文件': 'Choose private key file',
    '导出配置': 'Export config',
    '导入配置': 'Import config',
    '选择 FinalShell JSON 配置': 'Choose FinalShell JSON config',
    '选择包含 FinalShell 配置的文件夹': 'Choose the folder containing FinalShell configs',
    '选择要上传的文件': 'Choose files to upload',
    '选择要上传的文件夹': 'Choose a folder to upload'
  });

  /* ---- 主进程错误提示（续） ---- */
  Object.assign(EN, {
    '无法继续输入': 'Cannot continue typing',
    '下载管理器 - LIULI Shell': 'Downloads - LIULI Shell',
    '文件编辑器 - LIULI Shell': 'File editor - LIULI Shell',
    '导入 FinalShell 配置 - LIULI Shell': 'Import FinalShell config - LIULI Shell',
    '不支持的文件类型': 'Unsupported file type',
    '主机地址为空': 'Host is empty',
    '命令': 'Command',
    '服务器': 'Server'
  });

  /* ---- 右键菜单补充 ---- */
  Object.assign(EN, {
    '复制配置': 'Copy host',
    '复制主机地址': 'Copy host address',
    '复制配置信息': 'Copy host info',
    '折叠文件夹': 'Collapse folder',
    '展开文件夹': 'Expand folder',
    '文件操作': 'File actions',
    '粘贴到当前目录': 'Paste here',
    '粘贴到该目录': 'Paste into folder',
    '删除所选（普通）': 'Delete selected',
    '删除所选（rm -f）': 'Delete selected (rm -f)',
    '删除（普通）': 'Delete',
    '删除（rm -f）': 'Delete (rm -f)',
    '查找…': 'Find…',
    '全选': 'Select all',
    '重连': 'Reconnect',
    '关闭会话': 'Close session',
    '终端': 'Terminal',
    '待回收': 'Recycle pending',
    '删除命令': 'Delete snippet',
    '删除收藏分组': 'Delete favorite group',
    '向左显示': 'Scroll tabs left',
    '向右显示': 'Scroll tabs right'
  });

  Object.assign(EN, {
    '暖白 · 墨绿': 'Warm White · Ink Green',
    '雾蓝 · 靛青': 'Mist Blue · Indigo',
    '米杏 · 陶土': 'Apricot · Terracotta',
    '石墨 · 冷灰': 'Graphite · Cool Gray',
    '夜间 · 深墨': 'Night · Deep Ink',
    '藕粉 · 莓紫': 'Lotus Pink · Berry',
    '青瓷 · 松绿': 'Celadon · Pine',
    '深海 · 靛蓝': 'Deep Sea · Indigo',
    '朱砂 · 宣纸': 'Cinnabar · Rice Paper',
    '月白 · 靛蓝': 'Moon White · Indigo',
    '薰衣草 · 紫罗兰': 'Lavender · Violet',
    '晴空 · 湖蓝': 'Clear Sky · Lake Blue',
    '柠檬 · 奶油': 'Lemon · Cream',
    '珊瑚 · 暖橘': 'Coral · Warm Orange',
    '可可 · 咖啡': 'Cocoa · Coffee',
    '板岩 · 青灰': 'Slate · Blue Gray',
    '银霜 · 冰蓝': 'Silver Frost · Ice Blue',
    '素白 · 玄黑': 'Pure White · Black',
    '午夜 · 星空': 'Midnight · Starry',
    '星云 · 极光': 'Nebula · Aurora',
    '余烬 · 暗红': 'Ember · Dark Red',
    '曜石 · 银灰': 'Obsidian · Silver',
    '酒红 · 天鹅绒': 'Wine · Velvet',
    '青铜 · 金棕': 'Bronze · Gold Brown',
    '米黄 · 日光': 'Beige · Daylight',
    '燕麦 · 拿铁': 'Oat · Latte',
    '晨露 · 玫瑰': 'Dew · Rose',
    '青花 · 瓷白': 'Blue Porcelain · White',
    '秋分 · 枫糖': 'Autumn · Maple',
    '紫藤 · 烟紫': 'Wisteria · Smoke Purple',
    '海盐 · 苏打': 'Sea Salt · Soda',
    '碧波 · 松石': 'Green Wave · Turquoise',
    '夜蓝 · 静谧': 'Night Blue · Calm',
    '幽紫 · 夜曲': 'Deep Violet · Nocturne',
    '东京 · 夜色': 'Tokyo · Night',
    '北境 · 极夜': 'Nordic · Polar Night',
    '暖灰 · 琥珀': 'Warm Gray · Amber',
    '赛博 · 霓虹': 'Cyber · Neon',
    '石墨 · 冷光': 'Graphite · Cool Light',
    '紫灰 · 暮色': 'Violet Gray · Dusk',
    '默认 · 低对比护眼': 'Default · Low contrast',
    '清爽冷色': 'Fresh cool',
    '温暖纸感': 'Warm paper',
    '中性高对比': 'Neutral contrast',
    '暗色界面': 'Dark UI',
    '柔和暖紫': 'Soft warm violet',
    '淡雅青绿': 'Soft teal',
    '暗色蓝调': 'Dark blue',
    '暖红纸感': 'Warm red paper',
    '沉静靛蓝': 'Calm indigo',
    '优雅浅紫': 'Elegant light violet',
    '明快湖蓝': 'Bright lake blue',
    '温暖奶油': 'Warm cream',
    '温暖橘调': 'Warm orange',
    '沉稳咖调': 'Muted coffee',
    '理性青灰': 'Cool blue gray',
    '清冷冰蓝': 'Cold ice blue',
    '极简黑白': 'Minimal mono',
    '暗色蓝紫': 'Dark blue violet',
    '暗色青紫': 'Dark cyan violet',
    '暗色暖红': 'Dark warm red',
    '暗色中性': 'Dark neutral',
    '暗色酒红': 'Dark wine',
    '暗色金棕': 'Dark gold brown',
    '暖米纸感': 'Warm beige paper',
    '冷调奶白': 'Cool off-white',
    '奶油玫瑰': 'Cream rose',
    '青花瓷感': 'Porcelain',
    '枫糖暖棕': 'Maple brown',
    '淡雅烟紫': 'Soft smoky violet',
    '清凉水色': 'Cool aqua',
    '松石青绿': 'Turquoise green',
    '暗色夜蓝': 'Dark night blue',
    '暗色紫调': 'Dark violet',
    '暗色夜蓝紫': 'Dark blue violet',
    '暗色极地灰': 'Dark polar gray',
    '暗色暖灰': 'Dark warm gray',
    '暗色霓虹': 'Dark neon',
    '暗色冷灰': 'Dark cool gray',
    '暗色灰紫': 'Dark gray violet',
    '暖灰 · 琥珀': 'Warm Gray · Amber'
  });

  /* ---- 省级行政区（连接编辑器） ---- */
  Object.assign(EN, {
    '北京市': 'Beijing',
    '天津市': 'Tianjin',
    '上海市': 'Shanghai',
    '重庆市': 'Chongqing',
    '河北省': 'Hebei',
    '山西省': 'Shanxi',
    '辽宁省': 'Liaoning',
    '吉林省': 'Jilin',
    '黑龙江省': 'Heilongjiang',
    '江苏省': 'Jiangsu',
    '浙江省': 'Zhejiang',
    '安徽省': 'Anhui',
    '福建省': 'Fujian',
    '江西省': 'Jiangxi',
    '山东省': 'Shandong',
    '河南省': 'Henan',
    '湖北省': 'Hubei',
    '湖南省': 'Hunan',
    '广东省': 'Guangdong',
    '海南省': 'Hainan',
    '四川省': 'Sichuan',
    '贵州省': 'Guizhou',
    '云南省': 'Yunnan',
    '陕西省': 'Shaanxi',
    '甘肃省': 'Gansu',
    '青海省': 'Qinghai',
    '台湾省': 'Taiwan',
    '内蒙古自治区': 'Inner Mongolia',
    '广西壮族自治区': 'Guangxi',
    '西藏自治区': 'Tibet',
    '宁夏回族自治区': 'Ningxia',
    '新疆维吾尔自治区': 'Xinjiang',
    '香港特别行政区': 'Hong Kong',
    '澳门特别行政区': 'Macau'
  });

  /* ================= 动态句式 ================= */
  const RULES_EN = [
    [/^(\d+) 个会话$/, '$1 sessions'],
    [/^(\d+) 个配置$/, '$1 hosts'],
    [/^(\d+) 个配置 · (\d+) 个分组$/, '$1 hosts · $2 groups'],
    [/^(\d+) 个任务$/, '$1 tasks'],
    [/^(\d+) 项$/, '$1 items'],
    [/^共 (\d+) 项$/, '$1 items'],
    [/^已选 (\d+) 项$/, '$1 selected'],
    [/^共 (\d+) 个收藏$/, '$1 favorites'],
    [/^共 (\d+) 条$/, '$1 items'],
    [/^匹配 (\d+) \/ (\d+)$/, '$1 of $2'],
    [/^剩余 (\d+) 天$/, '$1 days left'],
    [/^(\d+) 台服务器$/, '$1 servers'],
    [/^(\d+) 个分组$/, '$1 groups'],
    [/^(\d+) 个收藏$/, '$1 favorites'],
    [/^(\d+) 个密钥$/, '$1 keys'],
    [/^(\d+) 条快捷命令$/, '$1 snippets'],
    [/^(\d+) 个回收站配置$/, '$1 recycle items'],
    [/^(\d+) 个分区$/, '$1 partitions'],
    [/^(\d+) 核$/, '$1 cores'],
    [/^(\d+) 项（已过滤）$/, '$1 items (filtered)'],
    [/^(\d+) 秒$/, '$1s'],
    [/^(\d+) 小时前$/, '$1 hours ago'],
    [/^(\d+) 分钟前$/, '$1 minutes ago'],
    [/^上次同步成功：(.*)$/, 'Last sync: $1'],
    [/^上次同步未完成$/, 'Last sync incomplete'],
    [/^上次同步未完成，请重新同步$/, 'Last sync incomplete. Sync again.'],
    [/^(.+) 出错：(.*)$/, 'Error on $1: $2'],
    [/^(.+) 已断开$/, '$1 disconnected'],
    [/^(.+) 连接已断开$/, '$1 disconnected'],
    [/^已删除 (.+)$/, 'Deleted $1'],
    [/^已收藏 (.+)$/, 'Added to favorites: $1'],
    [/^已填入命令编辑器$/, 'Loaded into the command editor'],
    [/^已发送到 (\d+) 个会话$/, 'Sent to $1 sessions'],
    [/^已复制 (.+) 项，请到目标目录粘贴$/, 'Copied $1 items. Paste them in the target folder.'],
    [/^已上传 (\d+) 个文件，(\d+) 个失败(.*)$/, 'Uploaded $1 files, $2 failed$3'],
    [/^已上传 (\d+) 个文件(.*)$/, 'Uploaded $1 files$2'],
    [/^已粘贴 (\d+) 项$/, 'Pasted $1 items'],
    [/^已移动 (\d+) 台服务器$/, 'Moved $1 servers'],
    [/^已移入回收站 (\d+) 台$/, '$1 hosts moved to recycle bin'],
    [/^正在连接 (.+)…$/, 'Connecting to $1…'],
    [/^正在连接 (\d+) 台服务器…$/, 'Connecting to $1 servers…'],
    [/^正在打包 (\d+) 项…$/, 'Packing $1 items…'],
    [/^下载完成，共 (\d+) 项 → (.*)$/, 'Downloaded $1 items to $2'],
    [/^权限已更新（(\d+) 项）$/, 'Permissions updated ($1 items)'],
    [/^权限设置完成 (\d+) 项，失败 (.*)$/, 'Permissions set for $1 items, failed: $2'],
    [/^队列中还有 (\d+) 个配置等待输入凭据$/, '$1 hosts waiting for credentials'],
    [/^云同步成功 · (\d+) 小时前$/, 'Cloud sync OK · $1 hours ago'],
    [/^云同步成功 · (\d+) 分钟前$/, 'Cloud sync OK · $1 minutes ago'],
    [/^云同步成功 · (.*)$/, 'Cloud sync OK · $1'],
    [/^云端用量 (.+)$/, 'Cloud usage $1'],
    [/^已上传 (\d+)$/, 'Uploaded $1'],
    [/^(\d+) 个配置等待输入凭据$/, '$1 hosts awaiting credentials'],
    [/^… 其余 (\d+) 项$/, '… $1 more'],
    [/^例如：(.*)$/, 'e.g. $1'],
    [/^本地Socks5(.*)$/, 'Local SOCKS5$1'],
    [/^作者：(.*)$/, 'Author: $1'],
    [/^更多（导入 \/ 导出配置） · (.+)$/, (m, p1) => 'More (import / export) · ' + translateCore(p1)],
    [/^台服务器(.*)$/, 'servers$1'],
    [/^个分组（含密钥与快捷命令）$/, 'groups (with keys and snippets)'],
    [/^个分组(.*)$/, 'groups$1'],
    [/^个收藏文件夹(.*)$/, 'favorite folders$1'],
    [/^个收藏(.*)$/, 'favorites$1'],
    [/^个回收站配置(.*)$/, 'recycle items$1'],
    [/^条快捷命令(.*)$/, 'snippets$1'],
    [/^个密钥(.*)$/, 'keys$1'],
    [/^项（主机 \+ 端口 \+ 用户名相同）$/, ' items (same host + port + user)'],
    [/^项（已过滤）$/, ' items (filtered)'],
    [/^(\d+) 核 · 负载 (.+)$/, '$1 cores · Load $2'],
    [/^(\d+) 核$/, '$1 cores'],
    [/^· 负载 (.+)$/, '· Load $1'],
    [/^(.+) · (\d+) 项( · .+)?$/, '$1 · $2 items$3'],
    [/^共 (\d+) 条 · 匹配 (\d+) 条$/, '$1 items · $2 matched'],
    [/^行 (\d+)，列 (\d+)$/, 'Ln $1, Col $2'],
    [/^已替换 (\d+) 处$/, 'Replaced $1'],
    [/^已清除 (\d+) 个已完成记录$/, 'Cleared $1 finished records'],
    [/^已清空 (\d+) 个任务$/, 'Cleared $1 tasks'],
    [/^已暂停 (\d+) 个任务，分片已保留$/, 'Paused $1 tasks, chunks kept'],
    [/^已取消 (\d+) 个任务$/, 'Cancelled $1 tasks'],
    [/^已向 PID (\d+) 发送 SIG(\w+)$/, 'Sent SIG$2 to PID $1'],
    [/^已保存 (\d+) 个文件$/, 'Saved $1 files'],
    [/^全部保存完成 (\d+) 个，失败：(.*)$/, 'Saved $1 files, failed: $2'],
    [/^保存完成 (\d+) 个，失败：(.*)$/, 'Saved $1 files, failed: $2'],
    [/^已暂停 (\d+) 个任务$/, 'Paused $1 tasks'],
    [/^确定删除「(.+)」吗？$/, 'Delete "$1"?'],
    [/^确定删除「(.+)」及其中的 (\d+) 条命令吗？$/, 'Delete board "$1" and its $2 snippets?'],
    [/^确定取消收藏「(.+)」吗？$/, 'Remove "$1" from favorites?'],
    [/^确定删除分组「(.+)」吗？\n组内收藏会变为未分组。$/, 'Delete group "$1"? Its favorites become ungrouped.'],
    [/^确定删除分组「(.+)」及其所有子分组吗？\n组内服务器配置会移动到「(.+)」分组，不会丢失。$/, 'Delete group "$1" and all subgroups? Hosts move to "$2" and are kept.'],
    [/^确定删除「(.+)」分组吗？\n组内服务器配置会移入回收站，可在「文件 → 回收站」中还原。$/, 'Delete group "$1"? Its hosts move to the recycle bin.'],
    [/^即将删除「(.+)」。\n此操作不可撤销，确定继续吗？$/, 'Delete "$1"? This cannot be undone.'],
    [/^确定从密钥库删除「(.*)」吗？\n引用该密钥的配置将需要重新选择密钥。$/, 'Delete key "$1" from the key store? Hosts using it must select another key.'],
    [/^确定永久删除配置「(.*)」吗？\n此操作不可恢复。$/, 'Permanently delete host "$1"? This cannot be undone.'],
    [/^确定向 (.+)（PID (\d+)）发送 SIG(\w+) 吗？\n该操作会直接终止目标进程。$/, 'Send SIG$3 to $1 (PID $2)? The process will be terminated.'],
    [/^确定将(.+)移入回收站吗？(.*)\n回收站中的配置保留 30 天，可在「文件 → 回收站」中还原。$/, 'Move $1 to the recycle bin?$2 Items are kept for 30 days and can be restored from File → Recycle bin.'],
    [/^在「(.+)」下新建子分组$/, 'New subgroup under "$1"'],
    [/^已选用密钥库：(.*)$/, 'Using stored key: $1'],
    [/^已启用代理(.*)$/, 'Proxy enabled$1'],
    [/^已复制配置「(.*)」，可到目标分组右键粘贴$/, 'Host "$1" copied. Right-click a group to paste.'],
    [/^本机已删除 → 云端同步删除：(.*)$/, 'Deleted locally → removed in cloud: $1'],
    [/^云端已删除 → 本机同步删除：(.*)$/, 'Deleted in cloud → removed locally: $1'],
    [/^连接全部（重连 (\d+) 个断开项）$/, 'Reconnect all ($1 offline)'],
    [/^连接本组服务器（(\d+)）$/, 'Connect group ($1)'],
    [/^通过代理连接本组服务器（(\d+)）$/, 'Connect group via proxy ($1)'],
    [/^直接连接本组服务器（(\d+)）$/, 'Connect group directly ($1)'],
    [/^连接所选服务器（(\d+) 台）$/, 'Connect selected ($1)'],
    [/^删除所选（(\d+)）$/, 'Delete selected ($1)'],
    [/^移动 (\d+) 台服务器$/, 'Move $1 servers'],
    [/^下载所选（(\d+)）$/, 'Download selected ($1)'],
    [/^已选 (\d+) 项$/, '$1 selected'],
    [/^确定删除全部 (\d+) 条命令历史吗？$/, 'Clear all $1 history entries?'],
    [/^确定清空全部历史记录吗？$/, 'Clear all recent connections?'],
    [/^（(\d+) 个未保存）$/, ' ($1 unsaved)']
  ];
  RULEMAP.en = RULES_EN;

  /* ================= 运行时翻译 ================= */
  let lang = 'zh';
  let observer = null;
  let queue = null;
  let timer = 0;

  const SKIP_TEXT = [
    '.xterm',
    '#file-body tr[data-i]',
    '#proc-body tr[data-i]',
    '#disk-body tr[data-i]',
    '.detail-table tbody tr[data-i]',
    '#file-tree .tnode',
    '#conn-list .ci-name',
    '.recent-row',
    '.his-cmd',
    '.snip-item',
    '.sp-row',
    '.rr-name',
    '.rr-meta',
    '.key-name',
    '.fav-row',
    '.kv b',
    'textarea',
    'script',
    'style'
  ].join(',');

  const SKIP_ATTR = [
    '.recent-row',
    '.his-row',
    '.snip-item',
    '.sp-row',
    '.rr-row',
    '.key-row',
    '.fav-row',
    '.tnode',
    '#file-body tr[data-i]'
  ].join(',');

  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const textSrc = new WeakMap();
  const attrSrc = new WeakMap();

  function translateCore(core) {
    if (lang === 'zh') return core;
    const dict = DICT[lang];
    if (dict) {
      const hit = dict[core];
      if (hit != null) return hit;
      const rules = RULEMAP[lang] || [];
      for (let i = 0; i < rules.length; i++) {
        const re = rules[i][0];
        if (re.test(core)) return core.replace(re, rules[i][1]);
      }
    }
    // 未翻译到的词条回退英文，避免非中文界面里夹杂中文
    if (lang !== 'en') {
      const hit = EN[core];
      if (hit != null) return hit;
      for (let i = 0; i < RULES_EN.length; i++) {
        const re = RULES_EN[i][0];
        if (re.test(core)) return core.replace(re, RULES_EN[i][1]);
      }
    }
    return core;
  }

  function tr(str) {
    const s = String(str == null ? '' : str);
    if (!/[\u4e00-\u9fa5]/.test(s)) return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m) return s;
    const out = translateCore(m[2]);
    return out === m[2] ? s : m[1] + out + m[3];
  }

  function translateTextNode(node) {
    const cur = node.nodeValue;
    let rec = textSrc.get(node);
    if (!rec) {
      rec = { src: cur, out: null };
      textSrc.set(node, rec);
    } else if (cur !== rec.src && cur !== rec.out) {
      // 应用主动更新了文字（既不等于原文，也不等于上次译文）
      rec.src = cur;
    }
    const out = tr(rec.src);
    if (out !== cur) node.nodeValue = out;
    rec.out = out;
  }

  function translateAttrs(el) {
    let rec = attrSrc.get(el);
    if (!rec) {
      rec = {};
      attrSrc.set(el, rec);
    }
    for (let i = 0; i < ATTRS.length; i++) {
      const name = ATTRS[i];
      if (!el.hasAttribute || !el.hasAttribute(name)) continue;
      const cur = el.getAttribute(name);
      let r = rec[name];
      if (!r) {
        r = rec[name] = { src: cur, out: null };
      } else if (cur !== r.out) {
        r.src = cur;
      }
      const out = tr(r.src);
      if (out !== cur) {
        el.setAttribute(name, out);
        r.out = out;
      } else {
        r.out = cur;
      }
    }
  }

  function walk(node) {
    if (!node) return;
    const type = node.nodeType;
    if (type === 3) {
      const p = node.parentElement;
      if (p && p.closest(SKIP_TEXT)) return;
      translateTextNode(node);
      return;
    }
    if (type !== 1 && type !== 9 && type !== 11) return;
    if (type === 1) {
      if (!node.matches(SKIP_ATTR)) translateAttrs(node);
      if (node.matches(SKIP_TEXT)) return;
    }
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
  }

  function flush() {
    timer = 0;
    if (!queue) return;
    const nodes = queue;
    queue = null;
    nodes.forEach((n) => walk(n));
  }

  function enqueue(node) {
    if (!queue) queue = new Set();
    queue.add(node);
    if (!timer) timer = setTimeout(flush, 0);
  }

  function avoidTerminal(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && el.closest && el.closest('.xterm'));
  }

  function observe() {
    if (observer || !document.body) return;
    observer = new MutationObserver((list) => {
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (m.type === 'childList') {
          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (avoidTerminal(n)) continue;
            enqueue(n);
          }
        } else if (m.type === 'characterData') {
          if (avoidTerminal(m.target)) continue;
          enqueue(m.target);
        } else if (m.type === 'attributes') {
          enqueue(m.target);
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  function apply() {
    if (!document.body) return;
    walk(document.body);
  }

  let titleSrc = null;
  function applyTitle() {
    if (titleSrc === null) titleSrc = document.title;
    const out = tr(titleSrc);
    if (document.title !== out) document.title = out;
  }

  function normalizeLang(id) {
    return LANGS.some((l) => l.id === id) ? id : 'zh';
  }

  function setLang(id) {
    lang = normalizeLang(id);
    document.documentElement.lang = HTML_LANG[lang] || lang;
    apply();
    applyTitle();
    // 画布上的文字不会随 DOM 翻译自动刷新，切换语言后重绘网络图表
    try {
      if (window.Sidebar && Sidebar.drawChart) Sidebar.drawChart(window.App && App.active);
    } catch (_) {}
  }

  /** 语言文件通过此方法注册：{ 中文: 译文 } + 与英文同序的规则数组 */
  function register(id, dict, rules) {
    const key = normalizeLang(id);
    if (key === 'zh') return;
    DICT[key] = Object.assign({}, DICT[key] || {}, dict || {});
    if (Array.isArray(rules) && rules.length) {
      RULEMAP[key] = (RULEMAP[key] || []).concat(rules);
    }
    if (lang === key && document.body) {
      apply();
      applyTitle();
    }
  }

  async function boot() {
    observe();
    // 先用 preload 同步下发的语言立即翻译，避免独立窗口出现中文闪烁
    try {
      const pre = window.api && window.api.appInfo && window.api.appInfo.language;
      if (pre) setLang(pre);
    } catch (_) {}
    // 画布文字（网络图表等）无法通过 DOM 翻译，这里统一拦截 fillText
    try {
      const proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
      const orig = proto && proto.fillText;
      if (orig && !proto.__liuliI18n) {
        proto.fillText = function (text) {
          const args = Array.prototype.slice.call(arguments);
          args[0] = tr(text);
          return orig.apply(this, args);
        };
        proto.__liuliI18n = true;
      }
    } catch (_) {}
    let saved = '';
    try {
      const st = await window.api.getState();
      saved = ((st && st.settings) || {}).language || '';
    } catch (_) {}
    if (saved) setLang(saved);
    else applyTitle();
    if (window.api && window.api.on) {
      window.api.on('settings:changed', (s) => {
        const next = s && s.language;
        if (next && next !== lang) setLang(next);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return {
    LANGS,
    setLang,
    register,
    apply,
    t: tr,
    dict: (id) => DICT[normalizeLang(id)] || {},
    rules: (id) => RULEMAP[normalizeLang(id)] || [],
    get lang() {
      return lang;
    }
  };
})();
