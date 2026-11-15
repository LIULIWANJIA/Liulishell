'use strict';
/**
 * 本地 SSH 模拟服务器（仅用于开发自测）
 * - 密码认证：任意密码
 * - exec：模拟 Linux /proc、df、ps、rm、cp 等命令
 * - shell：极简交互（回显 + 提示符）
 * - sftp：映射到系统临时目录 liuli-mock-fs
 * 启动：node test/mock-ssh-server.js  端口 2222
 */
const { Server } = require('ssh2');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.MOCK_PORT) || 2222;
const ROOT = path.join(os.tmpdir(), 'liuli-mock-fs');

function seed() {
  const dirs = ['home/demo', 'var/log', 'etc', 'opt/app', 'usr/local/bin'];
  dirs.forEach((d) => fs.mkdirSync(path.join(ROOT, d), { recursive: true }));
  const files = {
    'home/demo/welcome.txt': 'hello from LIULI mock server\n',
    'home/demo/.bashrc': 'export PS1="demo@mock:~$ "\n',
    'var/log/app.log': '[info] service started\n[warn] slow query 1.2s\n[error] disk usage 82%\n',
    'etc/os-release': 'PRETTY_NAME="Ubuntu 22.04.4 LTS"\nVERSION_ID="22.04"\n',
    'etc/hostname': 'mock-node\n',
    'opt/app/config.json': '{"port":8080}\n',
    'home/demo/README.md': '# Mock server\n用于 LIULI Shell 的本地联调。\n'
  };
  Object.entries(files).forEach(([p, content]) => {
    const abs = path.join(ROOT, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, content);
  });
  // 造几个大文件，方便测试下载
  const big = path.join(ROOT, 'home/demo/sample.bin');
  if (!fs.existsSync(big)) fs.writeFileSync(big, crypto.randomBytes(320 * 1024));
}

function toLocal(remote) {
  const norm = path.posix.normalize('/' + String(remote || '/')).replace(/^(\.\.[/\\])+/, '');
  return path.join(ROOT, norm);
}

const HOSTNAME = 'mock-node';
const HOME = '/home/demo';

let tick = 0;
let detailSeq = 0;
const started = Date.now();

function cpuLine() {
  tick++;
  const user = 120000 + tick * 37;
  const system = 40000 + tick * 9;
  const idle = 900000 + tick * 26;
  return `cpu  ${user} 1200 ${system} ${idle} 800 0 0 0 0 0`;
}

function meminfo() {
  const total = 8 * 1024 * 1024;
  const avail = 3 * 1024 * 1024 + Math.round(Math.sin(tick / 4) * 200 * 1024);
  return [
    'MemTotal:        8388608 kB',
    `MemFree:         ${Math.round(avail * 0.55)} kB`,
    `MemAvailable:    ${avail} kB`,
    'Buffers:          131072 kB',
    'Cached:          1048576 kB',
    'SwapTotal:       2097152 kB',
    `SwapFree:        ${Math.round(2097152 * 0.86)} kB`
  ].join('\n');
}

function netDev() {
  const rx = 1234567890 + tick * 260000;
  const tx = 98765432 + tick * 41000;
  return [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    `    lo: ${120000 + tick * 300}    120    0    0    0     0          0         0 ${120000 + tick * 300}    120    0    0    0     0       0          0`,
    `  eth0: ${rx}  98000    0    0    0     0          0         0 ${tx}  45000    0    0    0     0       0          0`
  ].join('\n');
}

function df() {
  const lines = [
    'Filesystem      Size  Used Avail Use% Mounted on',
    '/dev/sda1        50G   21G   27G  44% /',
    '/dev/sdb1       200G  182G  8.5G  96% /data',
    '/dev/sdc1       500G  120G  380G  24% /backup',
    '/dev/sdd1       120G   96G   24G  80% /var/lib/docker',
    '/dev/sde1        32G   12G   20G  38% /opt',
    '/dev/sdf1        16G    4G   12G  25% /home',
    'tmpfs           3.9G     0  3.9G   0% /dev/shm',
    'tmpfs           782M  1.2M  781M   1% /run/user/0'
  ];
  return lines.join('\n');
}

function loadavg() {
  return `0.${20 + (tick % 30)} 0.${30 + (tick % 20)} 0.${10 + (tick % 15)} 1/238 9981`;
}

function ps() {
  const base = [
    '    PID USER     %CPU %MEM   RSS COMMAND         ',
    '   1024 root     12.5  4.2 348160 nginx           nginx: worker process',
    '   2048 mysql     8.1  2.4 198656 mysqld          /usr/sbin/mysqld --daemonize',
    '   3072 demo      3.4  1.1  92160 node            node /opt/app/server.js',
    '   4096 root      1.2  0.8  65536 dockerd         /usr/bin/dockerd -H fd://',
    '   5120 root      0.6  0.5  41984 sshd            sshd: demo [priv]',
    '   6000 root      0.2  0.3  24576 systemd         /sbin/init splash'
  ];
  // 再造一批进程，便于验证「进程预览按可用高度撑满」
  for (let i = 0; i < 34; i++) {
    const pid = 7000 + i * 7;
    base.push(
      `${String(pid).padStart(7)} root     ${(11 - i * 0.28).toFixed(1).padStart(4)}  0.3 ${String(16000 + i * 2200).padStart(6)} worker-${String(i + 1).padStart(2, '0')}      /opt/app/worker ${i + 1}`
    );
  }
  return base.join('\n');
}

function psBasic() {
  const base = [
    '    PID %CPU %MEM   RSS COMMAND',
    '   1024 12.5  4.2 348160 nginx',
    '   2048  8.1  2.4 198656 mysqld',
    '   3072  3.4  1.1  92160 node',
    '   4096  1.2  0.8  65536 dockerd',
    '   5120  0.6  0.5  41984 sshd',
    '   6000  0.2  0.3  24576 systemd'
  ];
  // 再造一批进程，方便验证「进程预览按高度撑满」
  for (let i = 0; i < 34; i++) {
    const pid = 7000 + i * 7;
    const cpu = (12 - i * 0.31).toFixed(1);
    const rss = 18000 + i * 2600;
    base.push(`${String(pid).padStart(7)} ${cpu.padStart(4)}  0.3 ${String(rss).padStart(6)} worker-${i + 1}`);
  }
  return base.join('\n');
}

function procCwd() {
  return [
    'lrwxrwxrwx 1 root root 0 Nov  9 10:00 /proc/1024/cwd -> /var/www/html',
    'lrwxrwxrwx 1 mysql mysql 0 Nov  9 10:00 /proc/2048/cwd -> /var/lib/mysql',
    'lrwxrwxrwx 1 demo demo 0 Nov  9 10:00 /proc/3072/cwd -> /opt/app',
    'lrwxrwxrwx 1 root root 0 Nov  9 10:00 /proc/4096/cwd -> /',
    'lrwxrwxrwx 1 root root 0 Nov  9 10:00 /proc/5120/cwd -> /root',
    'lrwxrwxrwx 1 root root 0 Nov  9 10:00 /proc/6000/cwd -> /'
  ].join('\n');
}

function ss() {
  return [
    'Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process',
    'tcp   LISTEN 0      511          0.0.0.0:80         0.0.0.0:*     users:(("nginx",pid=1024,fd=6))',
    '\t skmem:(r0,rb131072,t0,tb87040,f0,w0,o0,bl0,d0) ts sack cubic wscale:7,7',
    '\t bytes_sent:0 bytes_received:0',
    'tcp   LISTEN 0      151        127.0.0.1:3306       0.0.0.0:*     users:(("mysqld",pid=2048,fd=21))',
    'tcp   ESTAB  0      0       10.0.0.5:22        10.0.0.9:51514  users:(("sshd",pid=5120,fd=3))',
    '\t skmem:(r0,rb131072,t0,tb87040,f0,w0,o0,bl0,d0) ts sack cubic',
    '\t bytes_sent:84020 bytes_received:12933',
    'tcp   ESTAB  0      0       10.0.0.5:80        10.0.0.9:40322  users:(("nginx",pid=1024,fd=12))',
    '\t bytes_sent:204800 bytes_received:4096',
    'tcp   ESTAB  0      0       10.0.0.5:80        10.0.0.7:51120  users:(("nginx",pid=1024,fd=13))',
    '\t bytes_sent:65536 bytes_received:2048',
    'udp   UNCONN 0      0        0.0.0.0:68          0.0.0.0:*     users:(("dhclient",pid=456,fd=6))'
  ].join('\n');
}

function sysinfoBundle() {
  return [
    '@@os',
    'PRETTY_NAME="Ubuntu 22.04.4 LTS"',
    'NAME="Ubuntu"',
    'VERSION_ID="22.04"',
    '@@kernel',
    '5.15.0-113-generic',
    '@@arch',
    'x86_64',
    '@@host',
    HOSTNAME,
    '@@user',
    'demo',
    '@@cores',
    '8',
    '@@up',
    'up 12 days, 4 hours',
    '@@end'
  ].join('\n');
}

function monitorBundle() {
  return [
    '@@cpu',
    cpuLine(),
    '@@mem',
    meminfo(),
    '@@net',
    netDev(),
    '@@disk',
    df(),
    '@@load',
    loadavg(),
    '@@end'
  ].join('\n');
}

function detailBundle() {
  detailSeq++;
  const rx1 = 987654321 + detailSeq * 1000000;
  const tx1 = 123456789 + detailSeq * 300000;
  return [
    '@@sidetail',
    '@@os',
    'PRETTY_NAME="Ubuntu 22.04.4 LTS"',
    'NAME="Ubuntu"',
    'VERSION_ID="22.04"',
    '@@kernel',
    'Linux',
    '5.15.0-113-generic',
    '@@arch',
    'x86_64',
    '@@host',
    HOSTNAME,
    '@@user',
    'demo',
    '@@up',
    'up 12 days, 4 hours',
    '@@load',
    '0.28 0.38 0.18 1/234 5678',
    '@@cpuinfo',
    'model name : Intel(R) Xeon(R) Gold 6248 CPU @ 2.50GHz',
    'cpu MHz : 2499.998',
    'cache size : 28160 KB',
    '8',
    '@@stat1',
    'cpu  120000 1200 40000 900000 800 0 0 0 0 0',
    '@@mem',
    'MemTotal:       8388608 kB',
    'MemFree:        2097152 kB',
    'MemAvailable:   5242880 kB',
    'Buffers:         131072 kB',
    'Cached:         1048576 kB',
    'SwapTotal:      2097152 kB',
    'SwapFree:       1572864 kB',
    '@@net1',
    '    lo: 12345678 12345 0 0 0 0 0 0 12345678 12345 0 0 0 0 0 0',
    `  eth0: ${rx1} 654321 0 0 0 0 0 0 ${tx1} 234567 0 0 0 0 0 0`,
    '@@disk',
    'Filesystem     1024-blocks      Used Available Capacity Mounted on',
    '/dev/sda1         52428800  22020096  27761408      45% /',
    '/dev/sdb1        209715200 174483046  24551424      88% /data',
    '/dev/sdc1        524288000 125829120 372505600      26% /backup',
    'tmpfs              4194304         0   4194304       0% /dev/shm',
    '@@stat2',
    'cpu  120350 1200 40100 902000 820 0 0 0 0 0',
    '@@net2',
    '    lo: 12350000 12360 0 0 0 0 0 0 12350000 12360 0 0 0 0 0 0',
    `  eth0: ${rx1 + 2345678} 655000 0 0 0 0 0 0 ${tx1 + 243433} 234900 0 0 0 0 0 0`,
    '@@end'
  ].join('\n');
}

function shellQuoteStrip(s) {
  return s.trim().replace(/^'|'$/g, '').replace(/'\\''/g, "'");
}

function runCommand(cmd) {
  const c = cmd.trim();
  if (c.includes('@@sidetail')) return detailBundle();
  if (c.includes('@@cwd')) return ps() + '\n@@cwd\n' + procCwd();
  if (c.includes('@@cpu')) return monitorBundle();
  if (c.includes('@@os')) return sysinfoBundle();
  if (/printf %s "\$HOME"/.test(c)) return HOME;
  if (/^ps -eo pid,pcpu,pmem,rss,comm\b/.test(c)) return psBasic();
  if (/^ps -eo/.test(c)) return ps();
  if (/^ls -l \/proc/.test(c)) return procCwd();
  if (/^ss -tunapi/.test(c)) return ss();
  if (/^ss -tunlp/.test(c)) return ss();
  if (/^kill -/.test(c)) {
    const m = /kill -(\w+) (\d+)/.exec(c);
    if (m && Number(m[2]) === 1) return 'kill: (1) - Operation not permitted';
    return '';
  }
  if (/^df\b/.test(c)) return df();
  if (/^uptime -p/.test(c)) return 'up 12 days, 4 hours';
  if (/^head -n 1 \/proc\/stat/.test(c)) return cpuLine();
  if (/^rm -rf --/.test(c)) {
    const paths = c.slice(c.indexOf('--') + 2).split(/\s+/).filter(Boolean).map(shellQuoteStrip);
    paths.forEach((p) => {
      try {
        fs.rmSync(toLocal(p), { recursive: true, force: true });
      } catch (_) {}
    });
    return '';
  }
  if (/^cp -a --/.test(c) || /^mv -f --/.test(c)) {
    const move = c.startsWith('mv');
    const rest = c.slice(c.indexOf('--') + 2).trim().split(/\s+/).filter(Boolean).map(shellQuoteStrip);
    const dest = rest.pop();
    const destIsDir = (() => {
      try {
        return fs.statSync(toLocal(dest)).isDirectory();
      } catch (_) {
        return false;
      }
    })();
    rest.forEach((src) => {
      // 与真实 cp 一致：目标是已存在的目录 → 复制进去；目标不存在 → 直接落到该路径（支持粘贴时重命名）
      const target = destIsDir || rest.length > 1 ? path.join(toLocal(dest), path.basename(src)) : toLocal(dest);
      try {
        if (move) fs.renameSync(toLocal(src), target);
        else fs.cpSync(toLocal(src), target, { recursive: true });
      } catch (_) {}
    });
    return '';
  }
  if (/^echo /.test(c)) return c.slice(5).replace(/^['"]|['"]$/g, '');
  if (/^(cd|pwd)/.test(c)) return HOME;
  if (/^whoami/.test(c)) return 'demo';
  if (/^uname -r/.test(c)) return '5.15.0-113-generic';
  if (/^ls\b/.test(c)) {
    try {
      return fs
        .readdirSync(toLocal(HOME))
        .map((n) => (fs.statSync(path.join(toLocal(HOME), n)).isDirectory() ? n + '/' : n))
        .join('  ');
    } catch (_) {
      return '';
    }
  }
  if (/^cat \/etc\/os-release/.test(c)) return fs.readFileSync(path.join(ROOT, 'etc/os-release'), 'utf8');
  if (/^hostname/.test(c)) return HOSTNAME;
  if (/^nproc/.test(c)) return '8';
  if (/^grep -c/.test(c)) return '8';
  return '';
}

/* ---------------- SFTP ---------------- */
function statAttrs(p) {
  const st = fs.statSync(p);
  return {
    mode: st.isDirectory() ? 0o040755 : 0o100644,
    uid: 1000,
    gid: 1000,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000)
  };
}

function handleSftp(sftp) {
  const handles = new Map();
  let hid = 0;
  const nextHandle = (obj) => {
    const h = Buffer.alloc(4);
    h.writeUInt32BE(++hid, 0);
    handles.set(hid, obj);
    return h;
  };

  sftp.on('REALPATH', (reqid, p) => {
    const norm = path.posix.normalize(p || HOME);
    sftp.name(reqid, [{ filename: norm, longname: norm, attrs: statAttrsSafe(toLocal(norm)) }]);
  });

  const statAttrsSafe = (local) => {
    try {
      return statAttrs(local);
    } catch (_) {
      return { mode: 0o040755, uid: 1000, gid: 1000, size: 0, atime: 0, mtime: 0 };
    }
  };

  sftp.on('STAT', (reqid, p) => {
    try {
      sftp.attrs(reqid, statAttrs(toLocal(p)));
    } catch (_) {
      sftp.status(reqid, 2);
    }
  });
  sftp.on('LSTAT', (reqid, p) => {
    try {
      sftp.attrs(reqid, statAttrs(toLocal(p)));
    } catch (_) {
      sftp.status(reqid, 2);
    }
  });
  sftp.on('FSTAT', (reqid, handle) => {
    const h = handles.get(handle.readUInt32BE(0));
    if (!h) return sftp.status(reqid, 4);
    try {
      sftp.attrs(reqid, statAttrs(h.path));
    } catch (_) {
      sftp.status(reqid, 2);
    }
  });

  sftp.on('OPENDIR', (reqid, p) => {
    const local = toLocal(p);
    if (!fs.existsSync(local) || !fs.statSync(local).isDirectory()) return sftp.status(reqid, 2);
    sftp.handle(reqid, nextHandle({ type: 'dir', path: local, entries: null }));
  });

  sftp.on('READDIR', (reqid, handle) => {
    const h = handles.get(handle.readUInt32BE(0));
    if (!h) return sftp.status(reqid, 4);
    if (!h.entries) {
      h.entries = fs.readdirSync(h.path).map((name) => {
        const abs = path.join(h.path, name);
        const st = fs.statSync(abs);
        return {
          filename: name,
          longname: `${st.isDirectory() ? 'd' : '-'}rw-r--r-- 1 demo demo ${st.size} ${name}`,
          attrs: statAttrs(abs)
        };
      });
      sftp.name(reqid, h.entries);
    } else {
      sftp.status(reqid, 1); // EOF
    }
  });

  sftp.on('OPEN', (reqid, filename, flags) => {
    const local = toLocal(filename);
    const access = flags & 0x3; // 1=READ 2=WRITE 3=RDWR
    try {
      if (flags & 0x8 && !fs.existsSync(local)) fs.writeFileSync(local, '');
      let fsFlags = 'r';
      if (flags & 0x10) fsFlags = 'w'; // TRUNC
      else if (access === 2) fsFlags = 'w';
      else if (access === 3) fsFlags = 'r+';
      const fd = fs.openSync(local, fsFlags);
      sftp.handle(reqid, nextHandle({ type: 'file', path: local, fd }));
    } catch (_) {
      sftp.status(reqid, 2);
    }
  });

  sftp.on('READ', (reqid, handle, offset, length) => {
    const h = handles.get(handle.readUInt32BE(0));
    if (!h || h.fd === undefined) return sftp.status(reqid, 4);
    try {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(h.fd, buf, 0, length, offset);
      if (n <= 0) return sftp.status(reqid, 1);
      sftp.data(reqid, buf.slice(0, n));
    } catch (_) {
      sftp.status(reqid, 4);
    }
  });

  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const h = handles.get(handle.readUInt32BE(0));
    if (!h || h.fd === undefined) return sftp.status(reqid, 4);
    try {
      fs.writeSync(h.fd, data, 0, data.length, offset);
      sftp.status(reqid, 0);
    } catch (_) {
      sftp.status(reqid, 4);
    }
  });

  sftp.on('CLOSE', (reqid, handle) => {
    const id = handle.readUInt32BE(0);
    const h = handles.get(id);
    if (h && h.fd !== undefined) {
      try {
        fs.closeSync(h.fd);
      } catch (_) {}
    }
    handles.delete(id);
    sftp.status(reqid, 0);
  });

  sftp.on('MKDIR', (reqid, p) => {
    try {
      fs.mkdirSync(toLocal(p));
      sftp.status(reqid, 0);
    } catch (_) {
      sftp.status(reqid, 4);
    }
  });

  sftp.on('RMDIR', (reqid, p) => {
    try {
      fs.rmdirSync(toLocal(p));
      sftp.status(reqid, 0);
    } catch (_) {
      sftp.status(reqid, 4);
    }
  });

  sftp.on('REMOVE', (reqid, p) => {
    try {
      fs.unlinkSync(toLocal(p));
      sftp.status(reqid, 0);
    } catch (_) {
      sftp.status(reqid, 2);
    }
  });

  sftp.on('RENAME', (reqid, from, to) => {
    try {
      fs.renameSync(toLocal(from), toLocal(to));
      sftp.status(reqid, 0);
    } catch (_) {
      sftp.status(reqid, 4);
    }
  });

  sftp.on('SETSTAT', (reqid) => sftp.status(reqid, 0));
}

/* ---------------- Shell ---------------- */
function fakeShell(stream) {
  let buffer = '';
  let cwd = HOME;
  const osc7 = () => stream.write('\x1b]7;file://mock-node' + cwd + '\x1b\\');
  const prompt = () => {
    osc7();
    const shown = cwd === HOME ? '~' : cwd;
    stream.write('\x1b[32mdemo@mock-node\x1b[0m:\x1b[34m' + shown + '\x1b[0m$ ');
  };
  stream.write('Welcome to Ubuntu 22.04.4 LTS (mock)\r\n\r\n');
  prompt();
  stream.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    for (const ch of text) {
      if (ch === '\r' || ch === '\n') {
        stream.write('\r\n');
        const cmd = buffer.trim();
        buffer = '';
        if (cmd === 'clear') {
          stream.write('\x1b[2J\x1b[H');
        } else if (cmd === 'exit' || cmd === 'logout') {
          stream.write('logout\r\n');
          stream.exit(0);
          stream.end();
          return;
        } else if (/^cd(\s|$)/.test(cmd)) {
          const target = cmd.slice(2).trim().replace(/^['"]|['"]$/g, '');
          if (!target || target === '~') cwd = HOME;
          else if (target.startsWith('/')) cwd = path.posix.normalize(target);
          else cwd = path.posix.normalize(path.posix.join(cwd, target));
        } else if (cmd) {
          const out = runCommand(cmd);
          if (out) stream.write(out.replace(/\n/g, '\r\n') + '\r\n');
        }
        prompt();
      } else if (ch === '\x7f') {
        if (buffer.length) {
          buffer = buffer.slice(0, -1);
          stream.write('\b \b');
        }
      } else if (ch === '\x03') {
        buffer = '';
        stream.write('^C\r\n');
        prompt();
      } else if (ch >= ' ') {
        buffer += ch;
        stream.write(ch);
      }
    }
  });
}

/* ---------------- 启动 ---------------- */
seed();
const hostKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs1',
  format: 'pem'
});

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' || ctx.method === 'publickey' || ctx.method === 'none') ctx.accept();
    else ctx.reject();
  });
  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      session.on('pty', (acc) => acc && acc());
      session.on('window-change', (acc) => acc && acc());
      session.on('shell', (acc) => {
        const stream = acc();
        fakeShell(stream);
      });
      session.on('exec', (acc, rej, info) => {
        const stream = acc();
        const cmd = String(info.command || '').trim();

        const out = runCommand(cmd);
        if (out) stream.write(out + (out.endsWith('\n') ? '' : '\n'));
        stream.exit(0);
        stream.end();
      });
      session.on('sftp', (acc) => {
        const sftp = acc();
        handleSftp(sftp);
      });
    });
  });
  client.on('error', () => {});
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-ssh] listening on 127.0.0.1:${PORT}  fs=${ROOT}`);
  console.log('[mock-ssh] user=demo  password=任意');
});
