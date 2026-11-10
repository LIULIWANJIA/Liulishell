# LIULI Shell

> **开源、易用、免费、跨平台** 的 SSH 终端与服务器管理工具

![LOGO](https://shell.minecft.cn/assets/icon.png)

[官网](https://shell.minecft.cn) · [GitHub 仓库](https://github.com/LIULIWANJIA/Liulishell) · [Gitee 仓库](https://gitee.com/liuliwanjiaweb/liuli-shell) · [发行版下载](#发行版下载)

当前版本：**v1.14.1** | Windows · Linux · macOS

---

LIULI Shell 是一款跨平台 SSH 终端与服务器管理工具，界面参考 FinalShell，把日常运维需要的功能收进同一个三栏窗口。技术栈为 Electron + xterm.js + ssh2，原生 SFTP 与 Shell channel，不依赖外部命令。

## 功能特性

- **多标签终端**：每个标签独立 SSH 会话，支持状态灯、右键重连、拖动排序、命令历史与补全
- **快速文件管理器**：SFTP 目录树 + 文件列表 + 内置文本编辑器，终端 `cd` 自动跟随，支持拖拽上传与整目录下载
- **实时状态监控**：CPU、内存、Swap、磁盘、网卡速率与进程预览，量程自适应
- **WebDAV 加密云同步**：配置、分组、收藏双向合并，加密上传，多设备迁移不丢改动
- **FinalShell 配置导入**：支持从 FinalShell 平滑迁移已有服务器配置
- **8 套主题**：含 2 套暗色主题，支持界面缩放与快捷命令板块

---

## 发行版下载

> 全部发行版同时发布在 **[GitHub Releases](https://github.com/LIULIWANJIA/Liulishell/releases)** 与 **[Gitee Releases](https://gitee.com/liuliwanjiaweb/liuli-shell/releases)**，按网络环境任选其一即可。

### Windows 10 / 11 x64

| 版本 | 文件 | 下载 |
|---|---|---|
| **便携版（推荐）** | `LIULI Shell 1.14.1 Portable.exe` · 约 93 MB · 免安装，双击即用 | [GitHub Releases](https://github.com/LIULIWANJIA/Liulishell/releases) · [Gitee Releases](https://gitee.com/liuliwanjiaweb/liuli-shell/releases) |
| **安装版** | `LIULI Shell 1.14.1 Setup.exe` · NSIS 安装向导 | [GitHub Releases](https://github.com/LIULIWANJIA/Liulishell/releases) · [Gitee Releases](https://gitee.com/liuliwanjiaweb/liuli-shell/releases) · [夸克网盘](https://pan.quark.cn/s/3b9930496416?pwd=YKXY)（提取码 `YKXY`） |

> 便携版配置写在 exe 同级的 `data` 目录；安装版配置在 `%APPDATA%\LIULI Shell`。升级 / 重装 / 卸载不会删除数据。

### Linux

源码构建产出 **`.deb` / AppImage / `.tar.gz`** 三种格式。如已发布预构建产物，可在 [GitHub Releases](https://github.com/LIULIWANJIA/Liulishell/releases) / [Gitee Releases](https://gitee.com/liuliwanjiaweb/liuli-shell/releases) 下载；否则按下文「Linux 快速构建」自行打包。

### macOS

源码构建产出 **`.dmg` / `.zip`**，支持 Intel（x64）与 Apple Silicon（arm64）。预构建产物同上，可在 [GitHub Releases](https://github.com/LIULIWANJIA/Liulishell/releases) / [Gitee Releases](https://gitee.com/liuliwanjiaweb/liuli-shell/releases) 查看，或按下文「macOS 快速构建」自行打包。

---

## Linux / macOS 快速构建

> **环境要求**：Node.js ≥ 18（推荐 20 LTS）、Git。Linux 与 macOS 必须在对应系统上构建，产物互不通用。

### 克隆源码（按网络环境选择 Git 源）

**从 GitHub 克隆**（海外 / 国际网络）：

```bash
rm -rf liuli-shell && git clone https://github.com/LIULIWANJIA/Liulishell.git
```

**从 Gitee 克隆**（国内网络推荐，速度更快）：

```bash
rm -rf liuli-shell && git clone https://gitee.com/liuliwanjiaweb/liuli-shell.git
```

> Gitee 克隆时可能提示输入账号与密码，完成后再执行下一步。

### Linux 快速构建（推荐）

```bash
cd liuli-shell && bash scripts/build-linux.sh
```

脚本自动完成：识别发行版与版本 → 补齐系统依赖 → 选择包类型 → 打包 → 询问是否安装并创建桌面图标。包类型向导：`1 = deb` / `2 = AppImage` / `3 = 两者都要`（直接回车默认 deb）。自动适配 Ubuntu 24.04+ 的 `*t64` 包名回退，支持 apt / dnf / yum / pacman / zypper。

**仅在依赖异常或构建报错时**，按顺序逐条尝试：

```bash
bash scripts/build-linux.sh repair
bash scripts/build-linux.sh deps
bash scripts/build-linux.sh
```

产物输出到 `dist/`。非交互场景可加参数，如 `bash scripts/build-linux.sh deb -y`。

### macOS 快速构建

**基础环境**（已装过会自动跳过）：

```bash
xcode-select --install 2>/dev/null || true
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
command -v node >/dev/null || brew install node@20
```

**进入项目并构建**（在克隆后的目录中执行）：

```bash
npm ci || npm install
npm run vendor          # 复制 xterm 资源到 src/renderer/vendor，打包前必须执行
npm run dist:mac        # x64 + arm64 一起产出 .dmg / .zip
```

只打 Apple Silicon 产物：`npx electron-builder --mac dmg zip --arm64`。产物在 `dist/`。

> 未签名的 App 若被 Gatekeeper 拦截，右键「打开」放行即可。

---

## 交流与反馈

| 渠道 | 链接 |
|---|---|
| QQ 群（国内） | `1127112572` · [点击加群](https://qm.qq.com/q/30jvArYWDm) |
| Telegram（海外） | [t.me/liulishell](https://t.me/liulishell) |

问题反馈、功能建议与版本动态均在群内同步维护。

---

## 许可证

开源、免费、跨平台。具体许可证信息请查看仓库中的 `LICENSE` 文件。

---

**LIULIWANJIA 官方正版 Liulishell** · [官网](https://shell.minecft.cn) · [GitHub](https://github.com/LIULIWANJIA/Liulishell) · [Gitee](https://gitee.com/liuliwanjiaweb/liuli-shell)
