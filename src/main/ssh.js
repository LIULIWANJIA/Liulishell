'use strict';
/**
 * SSH 会话管理：连接、交互式 shell、系统监控采集、SFTP 文件操作。
 * 每个终端标签页对应一个独立会话（便于「全部终端」广播与独立关闭）。
 */
const { Client } = require('ssh2');
const fs = require('fs');
const nodePath = require('path');
const { StringDecoder } = require('string_decoder');
const http = require('http');
const https = require('https');
const { SocksClient } = require('socks');

const sessions = new Map();
let seq = 0;

const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'udev', 'none', 'shm', 'efivarfs', 'squashfs', 'overlay']);

function shq(p) {
  return "'" + String(p).replace(/'/g, "'\\''") + "'";
}

function fmtPerms(mode) {
  const type = (mode & 0o170000) === 0o040000 ? 'd' : (mode & 0o170000) === 0o120000 ? 'l' : '-';
  const bits = ['r', 'w', 'x'];
  let out = type;
  for (let i = 6; i >= 0; i--) out += mode & (1 << i) ? bits[2 - (i % 3)] : '-';
  return out;
}

function parsePercentToBytes(text) {
  const m = /^([\d.]+)\s*([KMGTP]?)i?B?$/i.exec(String(text).trim());
  if (!m) return 0;
  const unit = (m[2] || '').toUpperCase();
  const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 }[unit] || 1;
  return parseFloat(m[1]) * mult;
}

/* ---------------- 进程 / 网络解析 ---------------- */

function splitAddr(s) {
  const t = String(s || '');
  const idx = t.lastIndexOf(':');
  if (idx < 0) return [t, ''];
  let ip = t.slice(0, idx).replace(/^\[|\]$/g, '');
  const port = t.slice(idx + 1);
  if (!ip || ip === '*') ip = '0.0.0.0';
  return [ip, port];
}

function parseNetwork(raw) {
  const socks = [];
  let cur = null;
  const lines = String(raw || '').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const t = line.trim();
    const parts = t.split(/\s+/);
    const p0 = (parts[0] || '').toLowerCase();
    if (/^(tcp|udp|tcp6|udp6|raw|raw6)$/.test(p0)) {
      const ssStyle = parts.length >= 6 && !/^\d+$/.test(parts[1] || '');
      if (ssStyle) {
        const users = /users:\(\("([^"]+)",pid=(\d+)/.exec(t) || /\(\("([^"]+)",pid=(\d+)/.exec(t);
        cur = {
          proto: p0,
          state: parts[1] || '',
          local: parts[4] || '',
          peer: parts[5] || '',
          name: users ? users[1] : '',
          pid: users ? Number(users[2]) : 0,
          up: 0,
          down: 0
        };
        socks.push(cur);
      } else if (parts.length >= 6) {
        const prog = (parts[6] || '').split('/');
        cur = {
          proto: p0,
          state: parts[5] || '',
          local: parts[3] || '',
          peer: parts[4] || '',
          name: prog[1] || '',
          pid: Number(prog[0]) || 0,
          up: 0,
          down: 0
        };
        socks.push(cur);
      }
      continue;
    }
    if (cur && /^\s/.test(line)) {
      const up = /bytes_sent:(\d+)/.exec(line);
      const down = /bytes_received:(\d+)/.exec(line);
      if (up) cur.up += Number(up[1]);
      if (down) cur.down += Number(down[1]);
    }
  }

  const map = new Map();
  for (const s of socks) {
    const [lip, lport] = splitAddr(s.local);
    const [pip] = splitAddr(s.peer);
    const key = s.pid ? 'p' + s.pid : 'n' + (s.name || lip + lport);
    let row = map.get(key);
    if (!row) {
      row = { pid: s.pid || 0, name: s.name || '-', localIps: new Set(), ports: new Set(), peers: new Set(), conns: 0, up: 0, down: 0 };
      map.set(key, row);
    }
    row.conns++;
    row.up += s.up;
    row.down += s.down;
    if (lport && lport !== '*') row.ports.add(lport);
    row.localIps.add(lip);
    if (pip && pip !== '0.0.0.0' && pip !== '::') row.peers.add(pip);
  }

  const rows = Array.from(map.values()).map((r) => ({
    pid: r.pid,
    name: r.name,
    localIp: Array.from(r.localIps).slice(0, 4).join('\n'),
    port: Array.from(r.ports)
      .sort((a, b) => a - b)
      .slice(0, 8)
      .join('\n'),
    peerIp: Array.from(r.peers).slice(0, 6).join('\n'),
    peers: r.peers.size,
    conns: r.conns,
    up: r.up,
    down: r.down
  }));
  rows.sort((a, b) => b.conns - a.conns || b.up - a.up);
  return rows;
}

/* ---------------- 代理隧道 ---------------- */

/** HTTP CONNECT 代理 */
function httpConnect(proxy, host, port) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (proxy.user) {
      const token = Buffer.from(`${proxy.user}:${proxy.password || ''}`).toString('base64');
      headers['Proxy-Authorization'] = 'Basic ' + token;
    }
    const req = http.request({
      host: proxy.host,
      port: Number(proxy.port) || 8080,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      timeout: 15000
    });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`代理返回 ${res.statusCode} ${res.statusMessage || ''}`));
      }
      resolve(socket);
    });
    req.once('error', (err) => reject(new Error('HTTP 代理连接失败: ' + err.message)));
    req.once('timeout', () => {
      req.destroy(new Error('HTTP 代理连接超时'));
    });
    req.end();
  });
}

/** SOCKS5 代理 */
async function socksConnect(proxy, host, port) {
  const options = {
    command: 'connect',
    destination: { host, port: Number(port) || 22 },
    proxy: {
      host: proxy.host,
      port: Number(proxy.port) || 1080,
      type: 5
    },
    timeout: 15000
  };
  if (proxy.user) {
    options.proxy.userId = proxy.user;
    options.proxy.password = proxy.password || '';
  }
  const info = await SocksClient.createConnection(options);
  return info.socket;
}

async function makeProxySocket(proxy, host, port) {
  if (!proxy) return null;
  try {
    if (proxy.type === 'socks5') return await socksConnect(proxy, host, port);
    return await httpConnect(proxy, host, port);
  } catch (err) {
    throw new Error(`代理「${proxy.name || proxy.host}」${err.message}`);
  }
}

/* ---------------- DoH 域名解析 ---------------- */

/** 判断是否已是 IP / 本机名，无需再解析 */
function isIp(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (/^[0-9a-fA-F:]+$/.test(h) && h.includes(':')) return true;
  return h === 'localhost';
}

function dohGet(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, Object.assign({ timeout: timeoutMs || 3000 }, headers), (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error('DoH 超时')));
    req.on('error', reject);
  });
}

const dohCache = new Map();
const DOH_CACHE_TTL = 10 * 60 * 1000;
const DOH_TIMEOUT = 3000;

/**
 * 通过 DoH 解析域名，返回最新的第一个 A 记录 IP，避免本地 DNS 缓存污染。
 * 阿里 DNS 与 Cloudflare 并行请求，谁先返回用谁；结果缓存 10 分钟，重连不再等待解析。
 */
async function resolveDoh(host) {
  const name = String(host || '').replace(/^\[|\]$/g, '').trim();
  if (!name || isIp(name)) return null;
  const key = name.toLowerCase();
  const hit = dohCache.get(key);
  if (hit && Date.now() - hit.ts < DOH_CACHE_TTL) return hit.ip;
  const endpoints = [
    { url: `https://dns.alidns.com/resolve?name=${encodeURIComponent(name)}&type=A`, opts: {} },
    { url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`, opts: { headers: { accept: 'application/dns-json' } } }
  ];
  try {
    const ip = await Promise.any(
      endpoints.map(async (ep) => {
        const text = await dohGet(ep.url, ep.opts, DOH_TIMEOUT);
        const obj = JSON.parse(text);
        const answers = Array.isArray(obj.Answer) ? obj.Answer : [];
        const a = answers.find((r) => r && (r.type === 1 || r.type === 28));
        if (a && a.data) return a.data;
        throw new Error('DoH 无 A 记录');
      })
    );
    if (ip) {
      dohCache.set(key, { ip, ts: Date.now() });
      return ip;
    }
  } catch (_) {
    /* 全部失败时回退用域名直连 */
  }
  return null;
}

class SshSession {
  constructor(id, cfg, secrets, send) {
    this.id = id;
    this.cfg = cfg;
    this.secrets = secrets;
    this.send = send;
    this.client = null;
    this.stream = null;
    this.decoder = new StringDecoder('utf8');
    this.sftpConn = null;
    this.activeTransfers = new Map();
    this.alive = false;
    this.monitorTimer = null;
    this.procTimer = null;
    this.busy = false;
    this.procSort = 'cpu';
    this.prev = { cpu: null, net: null, netTs: 0 };
    this.interval = 1500;
    this.sysinfo = null;
    this.proxy = cfg.proxy || null;
    this.monitorFails = 0;
    this.unstable = false;
  }

  /* ---------------- 连接 ---------------- */

  async connect() {
    const c = this.cfg;
    const opts = {
      host: c.host,
      port: c.port || 22,
      username: c.user,
      readyTimeout: 20000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      tryKeyboard: true
    };

    const pass = typeof this.secrets.password === 'string' ? this.secrets.password : '';

    if (c.authType === 'key') {
      let key = typeof this.secrets.privateKey === 'string' ? this.secrets.privateKey : '';
      if (!key && c.keyPath) {
        if (!fs.existsSync(c.keyPath)) throw new Error('私钥文件不存在: ' + c.keyPath);
        key = fs.readFileSync(c.keyPath, 'utf8');
      }
      if (!key) throw new Error('未提供私钥：请选择密钥库中的密钥，或重新粘贴私钥内容');
      opts.privateKey = key;
      const pp = typeof this.secrets.passphrase === 'string' ? this.secrets.passphrase : '';
      if (pp) opts.passphrase = pp;
    } else {
      opts.password = pass;
      if (!opts.password) {
        throw new Error('未读取到登录密码：请打开该配置重新填写密码后再连接');
      }
    }

    if (c.proxy) {
      opts.sock = await makeProxySocket(c.proxy, c.host, c.port || 22);
      opts.host = c.host;
      opts.port = c.port || 22;
    } else if (!isIp(c.host)) {
      // 直连且主机为域名时，用 DoH 取最新 IP，绕过本地 DNS 缓存
      const ip = await resolveDoh(c.host);
      if (ip) {
        this.resolvedIp = ip;
        opts.host = ip;
      }
    }

    this.client = new Client();
    // Ubuntu 24.04+ / 部分发行版把密码认证走 keyboard-interactive(PAM)，必须应答才能登录
    this.client.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish((prompts || []).map(() => pass));
    });
    this.client.on('error', (err) => {
      this.send('session:error', { sessionId: this.id, message: err && err.message ? err.message : String(err) });
    });
    this.client.on('close', () => {
      this.alive = false;
      this.stopMonitor();
      this.send('session:closed', { sessionId: this.id });
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          this.client.end();
        } catch (_) {}
        reject(new Error('连接超时（20 秒）'));
      }, 21000);
      this.client.once('ready', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      this.client.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(this.describeError(err));
      });
      try {
        this.client.connect(opts);
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(this.describeError(err));
        }
      }
    });

    this.alive = true;
    // 认证成功后立即返回并开始监控；系统信息在后台采集，避免阻塞终端打开
    this.sysinfo = { hostname: c.host };
    this.startMonitor();
    this.fetchSysinfo()
      .then((info) => {
        this.sysinfo = info;
        this.send('session:sysinfo', { sessionId: this.id, sysinfo: info });
      })
      .catch(() => {});
    return this.sysinfo;
  }

  describeError(err) {
    const msg = (err && err.message) || String(err);
    if (/authentication methods failed|All configured authentication methods failed/i.test(msg)) {
      return new Error(
        '认证被拒绝：密码或用户名不正确（服务器拒绝）。Ubuntu 24.04+ 常见原因：① sshd_config 未开启 PasswordAuthentication；② PermitRootLogin 设为 prohibit-password，root 无法用密码登录，请改用普通用户 + sudo，或改用密钥登录'
      );
    }
    if (/Too many authentication failures/i.test(msg)) {
      return new Error('认证失败次数过多：客户端尝试了过多密钥，请改用密钥库中的指定密钥登录，或减少本地 ssh-agent 中的密钥数量');
    }
    if (/Cannot parse privateKey|Failed to parse private key/i.test(msg)) {
      return new Error('私钥格式无法解析：请确认粘贴的是完整私钥（含 BEGIN/END 行），PuTTY 的 .ppk 需先转换为 OpenSSH 格式');
    }
    if (/no matching (key exchange|host key|cipher|mac) algorithm/i.test(msg)) {
      return new Error('算法协商失败：服务器支持的加密/密钥交换算法过旧或过于特殊，请联系管理员或升级服务器 OpenSSH（详情：' + msg + '）');
    }
    if (/ECONNREFUSED/i.test(msg)) return new Error('连接被拒绝：目标端口未开放');
    if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return new Error('域名解析失败，请检查主机地址');
    if (/EHOSTUNREACH|ENETUNREACH/i.test(msg)) return new Error('网络不可达，请检查本机网络或目标防火墙');
    if (/ETIMEDOUT|Timed out while waiting/i.test(msg)) return new Error('连接超时，请检查网络或防火墙');
    if (/Encrypted private OpenSSH key detected, but no passphrase given/i.test(msg)) {
      return new Error('私钥已加密，请填写私钥口令');
    }
    if (/Host key verification/i.test(msg)) return new Error('主机密钥校验失败（' + msg + '）');
    return new Error(msg);
  }

  async fetchSysinfo() {
    const cmd = [
      "echo '@@os'; (cat /etc/os-release 2>/dev/null | head -n 6) || true",
      "echo '@@kernel'; uname -r 2>/dev/null",
      "echo '@@arch'; uname -m 2>/dev/null",
      "echo '@@host'; hostname 2>/dev/null",
      "echo '@@user'; whoami 2>/dev/null",
      "echo '@@cores'; (nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)",
      "echo '@@up'; (uptime -p 2>/dev/null || uptime)",
      "echo '@@end'"
    ].join('; ');
    const out = await this.exec(cmd, 8000);
    const sec = (name) => {
      const re = new RegExp('@@' + name + '\\n([\\s\\S]*?)(?=\\n@@|$)');
      const m = re.exec(out);
      return m ? m[1].trim() : '';
    };
    let osName = '';
    const osRaw = sec('os');
    const pretty = /PRETTY_NAME="?([^"\n]+)"?/.exec(osRaw);
    if (pretty) osName = pretty[1];
    else if (osRaw) osName = osRaw.split('\n')[0];
    return {
      os: osName || 'Linux',
      kernel: sec('kernel'),
      arch: sec('arch'),
      hostname: sec('host') || this.cfg.host,
      loginUser: sec('user') || this.cfg.user,
      cores: parseInt(sec('cores'), 10) || 1,
      uptime: sec('up')
    };
  }

  /** 服务器详情：一次性读取系统、CPU、内存、Swap、网卡与磁盘信息 */
  async fetchSysinfoDetail() {
    const cmd = [
      "echo '@@sidetail'",
      "echo '@@os'; (cat /etc/os-release 2>/dev/null | head -n 8) || true",
      "echo '@@kernel'; uname -s 2>/dev/null; uname -r 2>/dev/null",
      "echo '@@arch'; uname -m 2>/dev/null",
      "echo '@@host'; hostname 2>/dev/null",
      "echo '@@user'; whoami 2>/dev/null",
      "echo '@@up'; (uptime -p 2>/dev/null || uptime 2>/dev/null)",
      "echo '@@load'; cat /proc/loadavg 2>/dev/null",
      "echo '@@cpuinfo'; (grep -m1 -E 'model name|^Hardware|^Processor' /proc/cpuinfo 2>/dev/null); (grep -m1 'cpu MHz' /proc/cpuinfo 2>/dev/null); (grep -m1 'cache size' /proc/cpuinfo 2>/dev/null); (nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)",
      "echo '@@stat1'; head -n 1 /proc/stat 2>/dev/null",
      "echo '@@mem'; cat /proc/meminfo 2>/dev/null",
      "echo '@@net1'; cat /proc/net/dev 2>/dev/null",
      "echo '@@disk'; LC_ALL=C df -Pk 2>/dev/null",
      "sleep 0.5",
      "echo '@@stat2'; head -n 1 /proc/stat 2>/dev/null",
      "echo '@@net2'; cat /proc/net/dev 2>/dev/null",
      "echo '@@end'"
    ].join('\n');
    const raw = await this.exec(cmd, 15000);
    const grab = (name) => {
      const re = new RegExp('@@' + name + '\\n([\\s\\S]*?)(?=\\n@@|$)');
      const m = re.exec(raw);
      return m ? m[1].trim() : '';
    };

    const osRaw = grab('os');
    const pretty = /PRETTY_NAME="?([^"\n]+)"?/.exec(osRaw);
    const os = pretty ? pretty[1] : (osRaw.split('\n')[0] || 'Linux');
    const kernelLines = grab('kernel').split('\n').map((s) => s.trim()).filter(Boolean);

    const cpuLines = grab('cpuinfo').split('\n').map((s) => s.trim()).filter(Boolean);
    let cpuModel = '';
    let cpuMhz = '';
    let cpuCache = '';
    let cores = 0;
    for (const line of cpuLines) {
      const m = /^([^:]+):\s*(.+)$/.exec(line);
      if (m) {
        const key = m[1].toLowerCase();
        if (/model name|hardware|processor/.test(key)) cpuModel = m[2].trim();
        else if (/cpu mhz/.test(key)) cpuMhz = m[2].trim();
        else if (/cache size/.test(key)) cpuCache = m[2].trim();
      } else if (/^\d+$/.test(line)) {
        cores = Number(line) || cores;
      }
    }

    const mem = {};
    grab('mem').split('\n').forEach((line) => {
      const m = /^(\w+):\s+(\d+)/.exec(line);
      if (m) mem[m[1]] = Number(m[2]) * 1024;
    });
    const memTotal = mem.MemTotal || 0;
    const memFree = mem.MemFree || 0;
    const memAvail = mem.MemAvailable !== undefined
      ? mem.MemAvailable
      : memFree + (mem.Buffers || 0) + (mem.Cached || 0);
    const memUsed = Math.max(0, memTotal - memAvail);
    const swapTotal = mem.SwapTotal || 0;
    const swapFree = mem.SwapFree || 0;

    const parseCpu = (text) => {
      const line = String(text || '').split('\n').find((l) => /^cpu\s/.test(l));
      if (!line) return null;
      const p = line.trim().split(/\s+/).slice(1).map(Number);
      const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = p;
      return {
        user, nice, system, idle, iowait, irq, softirq, steal,
        total: user + nice + system + idle + iowait + irq + softirq + steal
      };
    };
    const c1 = parseCpu(grab('stat1'));
    const c2 = parseCpu(grab('stat2'));
    let cpuUsage = null;
    if (c1 && c2 && c2.total > c1.total) {
      const dt = c2.total - c1.total;
      const pct = (v) => Math.max(0, Math.min(100, (v / dt) * 100));
      cpuUsage = {
        user: pct(c2.user + c2.nice - c1.user - c1.nice),
        system: pct(c2.system + c2.irq + c2.softirq - c1.system - c1.irq - c1.softirq),
        idle: pct(c2.idle - c1.idle),
        io: pct(c2.iowait - c1.iowait),
        steal: pct(c2.steal - c1.steal)
      };
    }

    const parseNet = (text) => {
      const map = new Map();
      String(text || '').split('\n').forEach((line) => {
        const i = line.indexOf(':');
        if (i < 0) return;
        const name = line.slice(0, i).trim();
        const c = line.slice(i + 1).trim().split(/\s+/).map(Number);
        if (!name || c.length < 9) return;
        map.set(name, { rxBytes: c[0], rxPackets: c[1], txBytes: c[8], txPackets: c[9] });
      });
      return map;
    };
    const n1 = parseNet(grab('net1'));
    const n2 = parseNet(grab('net2'));
    const ifaces = [];
    n2.forEach((v, name) => {
      const prev = n1.get(name) || v;
      ifaces.push({
        name,
        rxBytes: v.rxBytes,
        txBytes: v.txBytes,
        rxRate: Math.max(0, v.rxBytes - prev.rxBytes),
        txRate: Math.max(0, v.txBytes - prev.txBytes)
      });
    });
    ifaces.sort((a, b) => (a.name === 'lo' ? 1 : b.name === 'lo' ? -1 : a.name.localeCompare(b.name)));

    const disks = [];
    grab('disk').split('\n').forEach((line) => {
      if (!line.trim()) return;
      const p = line.trim().split(/\s+/);
      if (p.length < 6) return;
      if (!/^\d+(\.\d+)?%?$/.test(p[4])) return;
      const fsName = p[0];
      const mount = p.slice(5).join(' ');
      if (PSEUDO_FS.has(fsName)) return;
      if (!mount.startsWith('/')) return;
      if (mount.startsWith('/sys') || mount.startsWith('/proc') || mount.startsWith('/dev')) return;
      const total = Number(p[1]);
      const used = Number(p[2]);
      const free = Number(p[3]);
      if (!Number.isFinite(total) || !Number.isFinite(used) || !Number.isFinite(free)) return;
      disks.push({
        fs: fsName,
        mount,
        total: total * 1024,
        used: used * 1024,
        free: free * 1024,
        usedPct: parseInt(p[4], 10) || 0
      });
    });

    const load = grab('load').split(/\s+/).slice(0, 3).filter(Boolean);
    return {
      os,
      kernelName: kernelLines[0] || '',
      kernel: kernelLines[1] || kernelLines[0] || '',
      arch: grab('arch'),
      hostname: grab('host') || this.cfg.host,
      user: grab('user') || this.cfg.user,
      uptime: grab('up'),
      load,
      cpu: {
        model: cpuModel || grab('arch') || '未知',
        mhz: cpuMhz,
        cache: cpuCache,
        cores,
        usage: cpuUsage
      },
      memory: { total: memTotal, used: memUsed, free: memFree, available: memAvail },
      swap: { total: swapTotal, used: Math.max(0, swapTotal - swapFree), free: swapFree },
      net: ifaces,
      disks
    };
  }

  /* ---------------- 执行 ---------------- */

  exec(cmd, timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.alive) return reject(new Error('会话未连接'));
      this.client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = '';
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          try {
            stream.close();
          } catch (_) {}
          resolve(out);
        }, timeout);
        stream.on('data', (d) => {
          out += d.toString('utf8');
        });
        stream.stderr.on('data', (d) => {
          out += d.toString('utf8');
        });
        stream.on('close', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(out);
        });
      });
    });
  }

  /* ---------------- 终端 shell ---------------- */

  openShell(cols = 100, rows = 30) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.alive) return reject(new Error('会话未连接'));
      this.client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return reject(err);
        this.stream = stream;
        this.decoder = new StringDecoder('utf8');
        stream.on('data', (chunk) => {
          this.send('term:data', { sessionId: this.id, data: this.decoder.write(chunk) });
        });
        stream.stderr.on('data', (chunk) => {
          this.send('term:data', { sessionId: this.id, data: this.decoder.write(chunk) });
        });
        stream.on('close', () => {
          this.send('session:closed', { sessionId: this.id, reason: 'shell-closed' });
        });
        resolve();
      });
    });
  }

  write(data) {
    if (this.stream && this.alive) {
      this.stream.write(data);
      return true;
    }
    return false;
  }

  resize(cols, rows) {
    if (this.stream && cols > 0 && rows > 0) {
      try {
        this.stream.setWindow(rows, cols, 0, 0);
      } catch (_) {}
    }
  }

  /* ---------------- 监控采集 ---------------- */

  startMonitor() {
    this.stopMonitor();
    const tick = async () => {
      if (!this.alive || this.busy) return;
      this.busy = true;
      try {
        const stats = await this.pollStats();
        this.monitorFails = 0;
        if (this.unstable) {
          this.unstable = false;
          this.send('session:stable', { sessionId: this.id });
        }
        if (stats) this.send('monitor:stats', stats);
      } catch (_) {
        // 连续两次采集失败视为连接不稳定（橙灯），恢复后回到绿灯
        this.monitorFails++;
        if (this.monitorFails >= 2 && !this.unstable) {
          this.unstable = true;
          this.send('session:unstable', { sessionId: this.id });
        }
      } finally {
        this.busy = false;
      }
    };
    // 首次连续采样两次，让 CPU / 网速立刻有值
    tick();
    setTimeout(tick, 400);
    this.monitorTimer = setInterval(tick, this.interval);
    this.procTimer = setInterval(() => this.pollProcs(), Math.max(2000, this.interval * 2));
    setTimeout(() => this.pollProcs(), 800);
  }

  stopMonitor() {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.procTimer) clearInterval(this.procTimer);
    this.monitorTimer = null;
    this.procTimer = null;
  }

  setMonitorInterval(ms) {
    this.interval = Math.max(800, Math.min(10000, ms || 1500));
    if (this.alive) this.startMonitor();
  }

  async pollStats() {
    const cmd = [
      "echo '@@cpu'; head -n 1 /proc/stat 2>/dev/null",
      "echo '@@mem'; grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null",
      "echo '@@net'; cat /proc/net/dev 2>/dev/null",
      "echo '@@ifstats'; for i in /sys/class/net/*; do n=$(basename $i); echo \"$n $(cat $i/statistics/rx_bytes 2>/dev/null) $(cat $i/statistics/tx_bytes 2>/dev/null)\"; done",
      "echo '@@ifaces'; ls /sys/class/net 2>/dev/null",
      "echo '@@disk'; LC_ALL=C df -hP 2>/dev/null | head -n 60",
      "echo '@@load'; cat /proc/loadavg 2>/dev/null",
      "echo '@@end'"
    ].join('; ');
    const raw = await this.exec(cmd, 6000);
    const now = Date.now();
    const grab = (name) => {
      const re = new RegExp('@@' + name + '\\n([\\s\\S]*?)(?=\\n@@|$)');
      const m = re.exec(raw);
      return m ? m[1] : '';
    };

    // CPU
    let cpuUsage = null;
    const cpuLine = grab('cpu').trim();
    if (cpuLine) {
      const parts = cpuLine.split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0);
      const total = parts.slice(0, 8).reduce((a, b) => a + (b || 0), 0);
      if (this.prev.cpu) {
        const dTotal = total - this.prev.cpu.total;
        const dIdle = idle - this.prev.cpu.idle;
        if (dTotal > 0) cpuUsage = Math.max(0, Math.min(100, 100 * (1 - dIdle / dTotal)));
      }
      this.prev.cpu = { total, idle };
    }

    // 内存 / Swap
    const mem = {};
    grab('mem')
      .split('\n')
      .forEach((line) => {
        const m = /^(\w+):\s+(\d+)/.exec(line);
        if (m) mem[m[1]] = parseInt(m[2], 10) * 1024;
      });
    const memTotal = mem.MemTotal || 0;
    const memAvail =
      mem.MemAvailable !== undefined
        ? mem.MemAvailable
        : (mem.MemFree || 0) + (mem.Buffers || 0) + (mem.Cached || 0);
    const memUsed = Math.max(0, memTotal - memAvail);
    const swapTotal = mem.SwapTotal || 0;
    const swapUsed = Math.max(0, swapTotal - (mem.SwapFree || 0));

    // 网络
    let ifaces = [];
    grab('net')
      .split('\n')
      .forEach((line) => {
        const idx = line.indexOf(':');
        if (idx < 0) return;
        const name = line.slice(0, idx).trim();
        const cols = line
          .slice(idx + 1)
          .trim()
          .split(/\s+/)
          .map(Number);
        if (!name || cols.length < 9) return;
        ifaces.push({ name, rxTotal: cols[0], txTotal: cols[8] });
      });
    // /proc/net/dev 不可读或为空时，用 /sys/class/net 兜底（统计文件可读则速率仍可计算）
    if (!ifaces.length) {
      ifaces = grab('ifstats')
        .split('\n')
        .map((line) => {
          const p = line.trim().split(/\s+/);
          if (!p[0]) return null;
          return { name: p[0], rxTotal: Number(p[1]) || 0, txTotal: Number(p[2]) || 0 };
        })
        .filter(Boolean);
    }
    if (!ifaces.length) {
      ifaces = grab('ifaces')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((name) => ({ name, rxTotal: 0, txTotal: 0 }));
    }
    const elapsed = this.prev.netTs ? (now - this.prev.netTs) / 1000 : 0;
    const netOut = ifaces.map((i) => {
      let rxRate = 0;
      let txRate = 0;
      if (elapsed > 0.15 && this.prev.net && this.prev.net[i.name]) {
        const p = this.prev.net[i.name];
        rxRate = Math.max(0, (i.rxTotal - p.rxTotal) / elapsed);
        txRate = Math.max(0, (i.txTotal - p.txTotal) / elapsed);
      }
      return { name: i.name, rxTotal: i.rxTotal, txTotal: i.txTotal, rxRate, txRate };
    });
    const netMap = {};
    ifaces.forEach((i) => (netMap[i.name] = { rxTotal: i.rxTotal, txTotal: i.txTotal }));
    this.prev.net = netMap;
    this.prev.netTs = now;

    // 磁盘
    const disks = [];
    grab('disk')
      .split('\n')
      .filter((l) => l.trim())
      .forEach((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) return;
        if (!/^\d+(\.\d+)?%?$/.test(parts[4])) return;
        const fsName = parts[0];
        const mount = parts.slice(5).join(' ');
        if (PSEUDO_FS.has(fsName)) return;
        if (!mount.startsWith('/')) return;
        if (mount.startsWith('/sys') || mount.startsWith('/proc') || mount.startsWith('/dev')) return;
        disks.push({
          fs: fsName,
          mount,
          size: parts[1],
          avail: parts[3],
          usedPct: parseInt(parts[4], 10) || 0,
          sizeBytes: parsePercentToBytes(parts[1]),
          availBytes: parsePercentToBytes(parts[3])
        });
      });

    const loadLine = grab('load').trim().split(/\s+/);
    return {
      sessionId: this.id,
      ts: now,
      cpu: {
        usage: cpuUsage,
        cores: (this.sysinfo && this.sysinfo.cores) || 0,
        load: [loadLine[0], loadLine[1], loadLine[2]].filter(Boolean)
      },
      mem: { total: memTotal, used: memUsed, available: memAvail },
      swap: { total: swapTotal, used: swapUsed },
      net: { ifaces: netOut },
      disk: disks.slice(0, 12)
    };
  }

  async pollProcs() {
    if (!this.alive) return;
    try {
      const raw = await this.exec('ps -eo pid,pcpu,pmem,rss,comm 2>/dev/null | head -n 300', 6000);
      const rows = [];
      raw.split('\n').forEach((line, i) => {
        if (i === 0 && /PID/i.test(line)) return;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) return;
        const pid = parseInt(parts[0], 10);
        if (!pid) return;
        const cpu = parseFloat(parts[1]) || 0;
        const memPct = parseFloat(parts[2]) || 0;
        const rss = (parseInt(parts[3], 10) || 0) * 1024;
        const name = parts.slice(4).join(' ');
        rows.push({ pid, cpu, memPct, rss, name });
      });
      rows.sort((a, b) => (this.procSort === 'mem' ? b.rss - a.rss : b.cpu - a.cpu));
      this.send('monitor:procs', {
        sessionId: this.id,
        sort: this.procSort,
        // 右栏「进程预览」按可用高度展示，这里给足条数（最多 60 条），由界面决定显示几行
        rows: rows.slice(0, 60)
      });
    } catch (_) {}
  }

  setProcSort(sort) {
    this.procSort = sort === 'mem' ? 'mem' : 'cpu';
    this.pollProcs();
  }

  /* ---------------- 全量进程 / 网络 ---------------- */

  async listProcesses() {
    const cmd =
      "ps -eo pid,user,pcpu,pmem,rss,comm,args 2>/dev/null | head -n 320; echo '@@cwd'; ls -l /proc/[0-9]*/cwd 2>/dev/null | head -n 500";
    const raw = await this.exec(cmd, 12000);
    const at = raw.indexOf('@@cwd');
    const psPart = at >= 0 ? raw.slice(0, at) : raw;
    const cwdPart = at >= 0 ? raw.slice(at + 5) : '';

    const cwdMap = new Map();
    cwdPart.split('\n').forEach((line) => {
      const m = /\/proc\/(\d+)\/cwd\s*->\s*(.+)$/.exec(line.trim());
      if (m) cwdMap.set(Number(m[1]), m[2].trim());
    });

    const rows = [];
    psPart.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      if (i === 0 && /^\s*PID\s+/i.test(line)) return;
      const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
      if (!m) return;
      const pid = Number(m[1]);
      rows.push({
        pid,
        user: m[2],
        cpu: parseFloat(m[3]) || 0,
        memPct: parseFloat(m[4]) || 0,
        rss: (parseInt(m[5], 10) || 0) * 1024,
        name: m[6],
        cmd: (m[7] || m[6]).trim(),
        cwd: cwdMap.get(pid) || ''
      });
    });
    return rows;
  }

  async killProcess(pid, signal) {
    const p = parseInt(pid, 10);
    if (!p || p <= 1) throw new Error('无效的 PID');
    const sig = signal === 'KILL' ? 'KILL' : 'TERM';
    const out = (await this.exec(`kill -${sig} ${p} 2>&1`, 6000)).trim();
    if (/operation not permitted|not permitted|no such process|invalid signal|bad pid/i.test(out)) {
      throw new Error(out);
    }
    return out || 'ok';
  }

  async listNetwork() {
    const raw = await this.exec('ss -tunapi 2>/dev/null || netstat -tunap 2>/dev/null', 12000);
    return parseNetwork(raw);
  }

  /* ---------------- SFTP ---------------- */

  getSftp() {
    if (this.sftpConn) return Promise.resolve(this.sftpConn);
    return new Promise((resolve, reject) => {
      if (!this.client || !this.alive) return reject(new Error('会话未连接'));
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        this.sftpConn = sftp;
        sftp.on('close', () => {
          this.sftpConn = null;
        });
        resolve(sftp);
      });
    });
  }

  async listDir(dir) {
    const sftp = await this.getSftp();
    const list = await new Promise((resolve, reject) => {
      sftp.readdir(dir, (err, entries) => (err ? reject(err) : resolve(entries)));
    });
    const items = list
      .filter((e) => e.filename !== '.' && e.filename !== '..')
      .map((e) => {
        const mode = e.attrs.mode || 0;
        const isDir = (mode & 0o170000) === 0o040000;
        const isLink = (mode & 0o170000) === 0o120000;
        return {
          name: e.filename,
          size: e.attrs.size || 0,
          mtime: (e.attrs.mtime || 0) * 1000,
          mode,
          perms: fmtPerms(mode),
          isDir,
          isLink
        };
      });
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    });
    return items;
  }

  async resolveHome() {
    if (this.homeDir) return this.homeDir;
    let home = '';
    try {
      home = (await this.exec('printf %s "$HOME"', 4000)).trim();
    } catch (_) {}
    if (!home || !home.startsWith('/')) home = '/';
    this.homeDir = home;
    return home;
  }

  async remove(paths) {
    if (!paths || !paths.length) return '';
    const cmd = 'rm -rf -- ' + paths.map(shq).join(' ');
    return this.exec(cmd, 30000);
  }

  /** 普通删除：走 SFTP unlink/rmdir（不执行 rm 命令） */
  async removePlain(paths, depth = 0) {
    if (depth > 24) throw new Error('目录层级过深，已停止删除');
    const sftp = await this.getSftp();
    for (const p of paths || []) {
      let st;
      try {
        st = await new Promise((resolve, reject) => {
          sftp.stat(p, (err, attrs) => (err ? reject(err) : resolve(attrs)));
        });
      } catch (err) {
        throw new Error('无法读取 ' + p + ': ' + err.message);
      }
      if (st.isDirectory()) {
        const list = await new Promise((resolve, reject) => {
          sftp.readdir(p, (err, entries) => (err ? reject(err) : resolve(entries || [])));
        });
        const kids = list
          .filter((e) => e.filename !== '.' && e.filename !== '..')
          .map((e) => this.posixJoin(p, e.filename));
        if (kids.length) await this.removePlain(kids, depth + 1);
        await new Promise((resolve, reject) => {
          sftp.rmdir(p, (err) => (err ? reject(new Error('删除目录失败: ' + err.message)) : resolve(true)));
        });
      } else {
        await new Promise((resolve, reject) => {
          sftp.unlink(p, (err) => (err ? reject(new Error('删除文件失败: ' + err.message)) : resolve(true)));
        });
      }
    }
    return true;
  }

  posixJoin(a, b) {
    return String(a).replace(/\/+$/, '') + '/' + String(b).replace(/^\/+/, '');
  }

  async copy(sources, destDir, move) {
    if (!sources || !sources.length) return '';
    const flag = move ? '-f' : '-a';
    const cmd = (move ? 'mv ' : 'cp ') + flag + ' -- ' + sources.map(shq).join(' ') + ' ' + shq(destDir);
    return this.exec(cmd, 60000);
  }

  /** 远端路径是否已存在（走 SFTP stat；权限不足按“不存在”处理，交给后续命令报错） */
  async remoteExists(remotePath) {
    const sftp = await this.getSftp();
    return new Promise((resolve) => {
      sftp.stat(remotePath, (err) => resolve(!err));
    });
  }

  /**
   * 按「源 → 目标文件名」逐项复制，用于粘贴时重命名 / 覆盖：
   * items: [{ src, name, overwrite }]
   * - name 为目标目录下的最终文件名（可改名）
   * - overwrite=true 时先删除同名目标再复制（目录整体替换，符合“覆盖文件”的预期）
   * - overwrite=false 且已存在同名项直接抛错，由前端提示
   */
  async copyItems(items, destDir, move) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return '';
    for (const it of list) {
      const src = String((it && it.src) || '');
      const name = String((it && it.name) || '').replace(/^\/+/, '');
      if (!src || !name || name === '.' || name === '..' || name.includes('/')) {
        throw new Error('非法的粘贴项：' + (it && it.name));
      }
      const target = this.posixJoin(destDir, name);
      // 同一目录下同名覆盖等于覆盖自身：先删会把源一起删掉，直接跳过（不可先删再拷）
      const norm = (p) => String(p || '').replace(/\/+$/, '');
      if (norm(target) === norm(src)) continue;
      // 把目录粘贴到它自己的子目录里会无限递归，直接拒绝
      if (norm(src) !== '/' && (norm(target) + '/').startsWith(norm(src) + '/')) {
        throw new Error('不能把文件夹粘贴到它自己的子目录中');
      }
      const occupied = await this.remoteExists(target);
      if (occupied) {
        if (!it.overwrite) throw new Error(`目标已存在同名文件或文件夹：${name}`);
        await this.exec('rm -rf -- ' + shq(target), 60000);
      }
      // 复制到明确的完整目标路径：这样 name 可以与被复制项的名字不同（重命名粘贴）
      await this.exec((move ? 'mv -f -- ' : 'cp -a -- ') + shq(src) + ' ' + shq(target), 60000);
    }
    return true;
  }

  async mkdir(remotePath) {
    const sftp = await this.getSftp();
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => (err ? reject(err) : resolve(true)));
    });
  }

  async rename(from, to) {
    const sftp = await this.getSftp();
    return new Promise((resolve, reject) => {
      sftp.rename(from, to, (err) => (err ? reject(err) : resolve(true)));
    });
  }

  /** 批量修改权限；recursive 时按 scope 应用到文件 / 目录 */
  async chmodItems(items, mode, recursive, scope) {
    const sftp = await this.getSftp();
    const bits = Number(mode) & 0o777;
    let changed = 0;
    const errors = [];
    const chmodOne = (p) => new Promise((resolve, reject) => {
      sftp.chmod(p, bits, (err) => (err ? reject(err) : resolve(true)));
    });
    const apply = async (p, isDir, depth) => {
      if (depth > 30) return;
      const should = !recursive || scope === 'all' || (scope === 'files' && !isDir) || (scope === 'dirs' && isDir);
      if (should) {
        try {
          await chmodOne(p);
          changed++;
        } catch (err) {
          errors.push(`${p}: ${err.message || err}`);
        }
      }
      if (!recursive || !isDir) return;
      let list;
      try {
        list = await new Promise((resolve, reject) => {
          sftp.readdir(p, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });
      } catch (err) {
        errors.push(`${p}: ${err.message || err}`);
        return;
      }
      for (const e of list) {
        if (!e || e.filename === '.' || e.filename === '..') continue;
        const m = (e.attrs && e.attrs.mode) || 0;
        const childDir = (m & 0o170000) === 0o040000;
        await apply(this.posixJoin(p, e.filename), childDir, depth + 1);
      }
    };
    for (const item of items || []) {
      if (!item || !item.path) continue;
      await apply(String(item.path), !!item.isDir, 0);
    }
    return { changed, errors };
  }

  /** 读取远端文本文件（限制大小，供内置编辑器使用） */
  async readTextFile(remotePath, maxBytes = 10 * 1024 * 1024) {
    const sftp = await this.getSftp();
    const attrs = await new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, st) => (err ? reject(new Error('无法读取文件属性: ' + err.message)) : resolve(st)));
    });
    const size = attrs.size || 0;
    if (size > maxBytes) {
      throw new Error(`文件大小 ${(size / 1024 / 1024).toFixed(2)} MB，超过 ${Math.round(maxBytes / 1024 / 1024)} MB 编辑上限`);
    }
    const buf = await new Promise((resolve, reject) => {
      sftp.readFile(remotePath, (err, data) => (err ? reject(new Error('读取文件失败: ' + err.message)) : resolve(data)));
    });
    // 粗略二进制判定：前 8KB 出现 NUL 字节或非法 UTF-8 替换率过高
    const head = buf.subarray(0, Math.min(buf.length, 8192));
    if (head.includes(0)) throw new Error('这是二进制文件，内置编辑器仅支持文本文件');
    const text = buf.toString('utf8');
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (text.length && bad / Math.max(1, text.length) > 0.02) {
      throw new Error('文件编码不是 UTF-8，暂不支持在线编辑（可下载后本地编辑）');
    }
    return {
      path: remotePath,
      size,
      mtime: (attrs.mtime || 0) * 1000,
      mode: attrs.mode || 0,
      content: text.replace(/\r\n/g, '\n')
    };
  }

  /** 写回远端文本文件（保留原权限，写入前先备份同名 .bak? 不备份，直接覆写） */
  async writeTextFile(remotePath, content) {
    const sftp = await this.getSftp();
    const data = Buffer.from(String(content), 'utf8');
    await new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, data, (err) => (err ? reject(new Error('保存失败: ' + err.message)) : resolve(true)));
    });
    return data.length;
  }

  /** 可取消的下载（流模式，便于下载管理器中断） */
  async downloadFile(remotePath, localPath, transferId) {
    const sftp = await this.getSftp();
    fs.mkdirSync(nodePath.dirname(localPath), { recursive: true });
    let total = 0;
    try {
      const st = await new Promise((resolve, reject) => {
        sftp.stat(remotePath, (err, attrs) => (err ? reject(err) : resolve(attrs)));
      });
      total = st.size || 0;
    } catch (_) {}

    return new Promise((resolve, reject) => {
      const rs = sftp.createReadStream(remotePath);
      const ws = fs.createWriteStream(localPath);
      const rec = { rs, ws, localPath, cancelled: false, keepFile: false, reject };
      this.activeTransfers.set(transferId, rec);
      let transferred = 0;
      let done = false;
      let last = 0;
      const name = nodePath.basename(remotePath);
      const finish = (err) => {
        if (done) return;
        done = true;
        this.activeTransfers.delete(transferId);
        try { rs.destroy(); } catch (_) {}
        try { ws.destroy(); } catch (_) {}
        if (rec.cancelled) {
          if (!rec.keepFile) {
            try { fs.unlinkSync(localPath); } catch (_) {}
          }
          return reject(new Error(rec.keepFile ? '已暂停' : '已取消'));
        }
        if (err) {
          try { fs.unlinkSync(localPath); } catch (_) {}
          return reject(err);
        }
        this.send('fs:progress', { id: transferId, name, transferred: total || transferred, total: total || transferred });
        resolve(localPath);
      };
      rs.on('data', (chunk) => {
        transferred += chunk.length;
        const now = Date.now();
        if (now - last > 110 || transferred >= total) {
          last = now;
          this.send('fs:progress', { id: transferId, name, transferred, total });
        }
      });
      rs.on('error', finish);
      ws.on('error', finish);
      ws.on('finish', () => finish(null));
      ws.on('close', () => { if (!done) finish(null); });
      rs.pipe(ws);
    });
  }

  async downloadDir(remoteDir, localDir, transferId, depth = 0) {
    fs.mkdirSync(localDir, { recursive: true });
    const entries = await this.listDir(remoteDir);
    for (const entry of entries) {
      const rp = nodePath.posix.join(remoteDir, entry.name);
      const lp = nodePath.join(localDir, entry.name);
      if (entry.isDir) {
        if (depth < 12) await this.downloadDir(rp, lp, transferId, depth + 1);
      } else {
        await this.downloadFile(rp, lp, transferId);
      }
    }
    return localDir;
  }

  /** 可取消的上传 */
  async uploadFile(localPath, remoteDir, transferId) {
    const sftp = await this.getSftp();
    const remote = nodePath.posix.join(remoteDir, nodePath.basename(localPath));
    const total = fs.statSync(localPath).size;
    return new Promise((resolve, reject) => {
      const rs = fs.createReadStream(localPath);
      const ws = sftp.createWriteStream(remote);
      const rec = { rs, ws, localPath: null, remote, cancelled: false, keepFile: false, reject };
      this.activeTransfers.set(transferId, rec);
      let transferred = 0;
      let done = false;
      let last = 0;
      const name = nodePath.basename(localPath);
      const finish = (err) => {
        if (done) return;
        done = true;
        this.activeTransfers.delete(transferId);
        try { rs.destroy(); } catch (_) {}
        try { ws.destroy(); } catch (_) {}
        if (rec.cancelled) return reject(new Error(rec.keepFile ? '已暂停' : '已取消'));
        if (err) return reject(err);
        this.send('fs:progress', { id: transferId, name, transferred: total, total, direction: 'upload' });
        resolve(remote);
      };
      rs.on('data', (chunk) => {
        transferred += chunk.length;
        const now = Date.now();
        if (now - last > 110 || transferred >= total) {
          last = now;
          this.send('fs:progress', { id: transferId, name, transferred, total, direction: 'upload' });
        }
      });
      rs.on('error', finish);
      ws.on('error', finish);
      ws.on('finish', () => finish(null));
      ws.on('close', () => { if (!done) finish(null); });
      rs.pipe(ws);
    });
  }

  /** 停止某个传输：keepFile=true 时保留已下载分片（暂停），否则删除未完成文件（取消） */
  cancelTransfer(transferId, keepFile) {
    const rec = this.activeTransfers.get(transferId);
    if (!rec) return false;
    rec.cancelled = true;
    rec.keepFile = !!keepFile;
    try { rec.rs.destroy(); } catch (_) {}
    try { rec.ws.destroy(); } catch (_) {}
    if (!keepFile) {
      if (rec.localPath) {
        try { fs.unlinkSync(rec.localPath); } catch (_) {}
      }
      if (rec.remote) {
        // 上传取消：顺带清理远端未完成文件
        this.getSftp().then((sftp) => sftp.unlink(rec.remote, () => {})).catch(() => {});
      }
    }
    this.activeTransfers.delete(transferId);
    try { rec.reject(new Error(keepFile ? '已暂停' : '已取消')); } catch (_) {}
    return true;
  }

  close() {
    this.alive = false;
    this.stopMonitor();
    try {
      if (this.sftpConn) this.sftpConn.end();
    } catch (_) {}
    try {
      if (this.client) this.client.end();
    } catch (_) {}
    this.sftpConn = null;
  }
}

/* ---------------- 对外接口 ---------------- */

function createSession(cfg, secrets, send) {
  const id = 'sess-' + ++seq;
  const sess = new SshSession(id, cfg, secrets, send);
  sessions.set(id, sess);
  return sess;
}

function getSession(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('会话不存在或已关闭');
  return s;
}

function closeSession(id) {
  const s = sessions.get(id);
  if (s) {
    s.close();
    sessions.delete(id);
  }
}

function closeAll() {
  for (const id of Array.from(sessions.keys())) closeSession(id);
}

function findSessionByConfig(configId) {
  for (const s of sessions.values()) {
    if (s.cfg && s.cfg.id === configId) return s;
  }
  return null;
}

module.exports = {
  createSession,
  getSession,
  closeSession,
  closeAll,
  findSessionByConfig,
  isIp,
  resolveDoh,
  makeProxySocket,
  sessions
};
