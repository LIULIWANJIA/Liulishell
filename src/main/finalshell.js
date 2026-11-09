'use strict';
/* FinalShell 导出配置解析：支持单条 / 数组 / id->配置映射；密码按 FinalShell 的 DES 派生算法解密 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MASK = (1n << 48n) - 1n;
const MULT = 0x5deece66dn;
const ADD = 0xbn;

class JavaRandom {
  constructor(seed) {
    this.seed = (BigInt.asIntN(64, BigInt(seed)) ^ MULT) & MASK;
  }
  next(bits) {
    this.seed = (this.seed * MULT + ADD) & MASK;
    const raw = this.seed >> BigInt(48 - bits);
    return bits === 32 ? Number(BigInt.asIntN(32, raw)) : Number(raw);
  }
  nextInt(bound) {
    if ((bound & -bound) === bound) {
      return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    }
    let bits;
    let val;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (bits - val + (bound - 1) < 0);
    return val;
  }
  nextLong() {
    return BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32)));
  }
}

function signedByte(v) {
  return v > 127 ? v - 256 : v;
}

function desKey(head) {
  const h = Array.from(head);
  const ks = 3680984568597093857n / BigInt(new JavaRandom(signedByte(h[5])).nextInt(127));
  const random = new JavaRandom(ks);
  const t = signedByte(h[0]);
  for (let i = 0; i < t; i++) random.nextLong();
  const n = random.nextLong();
  const r2 = new JavaRandom(n);
  const ld = [
    BigInt(signedByte(h[4])),
    r2.nextLong(),
    BigInt(signedByte(h[7])),
    BigInt(signedByte(h[3])),
    r2.nextLong(),
    BigInt(signedByte(h[1])),
    random.nextLong(),
    BigInt(signedByte(h[2]))
  ];
  const buf = Buffer.alloc(64);
  ld.forEach((v, i) => buf.writeBigUInt64BE(BigInt.asUintN(64, v), i * 8));
  return crypto.createHash('md5').update(buf).digest().subarray(0, 8);
}

function decryptPassword(base64) {
  const text = String(base64 || '').trim();
  if (!text) return '';
  try {
    const raw = Buffer.from(text, 'base64');
    if (raw.length <= 8 || (raw.length - 8) % 8 !== 0) return '';
    const decipher = crypto.createDecipheriv('des-ecb', desKey(raw.subarray(0, 8)), null);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(raw.subarray(8)), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

/** 把 FinalShell 配置对象整理成本软件连接字段；密码能解密就导入，否则留空 */
function normalizeConfig(raw, stats) {
  if (!raw || typeof raw !== 'object') return null;
  const host = String(raw.host || raw.ip || '').trim();
  const user = String(raw.user_name || raw.user || raw.username || '').trim();
  if (!host || !user) return null;
  const port = Number(raw.port) || 22;
  const name = String(raw.name || raw.description || host).trim() || host;
  const plain = decryptPassword(raw.password);
  if (raw.password && !plain && stats) stats.noPassword++;
  return {
    name,
    host,
    port,
    user,
    authType: 'password',
    password: plain,
    decryptFailed: !!(raw.password && !plain)
  };
}

function looksLikeConfig(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && (v.host || v.ip) && (v.user_name || v.user || v.username);
}

/** 支持单条配置、数组、以及 { id: 配置 } 映射 */
function collectConfigs(obj) {
  const out = [];
  if (!obj) return out;
  if (Array.isArray(obj)) {
    obj.forEach((x) => {
      if (looksLikeConfig(x)) out.push(x);
      else if (x && typeof x === 'object') out.push(...collectConfigs(x));
    });
    return out;
  }
  if (looksLikeConfig(obj)) return [obj];
  if (typeof obj === 'object') {
    Object.values(obj).forEach((v) => {
      if (looksLikeConfig(v)) out.push(v);
    });
  }
  return out;
}

module.exports = { decryptPassword, collectConfigs, normalizeConfig, scanPaths };

/* ---------------- 文件 / 文件夹扫描 ---------------- */

function parseJsonFile(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const configs = collectConfigs(raw);
    return { configs, error: configs.length ? '' : '未识别到连接配置' };
  } catch (_) {
    return { configs: [], error: 'JSON 解析失败' };
  }
}

function scanPath(target, depth, includeRaw) {
  let st;
  try {
    st = fs.statSync(target);
  } catch (_) {
    return { type: 'file', name: path.basename(target), path: target, count: 0, error: '文件不存在' };
  }
  if (st.isFile()) {
    if (!/\.json$/i.test(target)) {
      return { type: 'file', name: path.basename(target), path: target, count: 0, error: '不是 JSON 文件' };
    }
    const r = parseJsonFile(target);
    const node = { type: 'file', name: path.basename(target), path: target, count: r.configs.length, error: r.error };
    if (includeRaw) node.configs = r.configs;
    return node;
  }
  if (!st.isDirectory()) {
    return { type: 'file', name: path.basename(target), path: target, count: 0, error: '不支持的文件类型' };
  }

  const node = {
    type: 'folder',
    name: path.basename(target) || target,
    path: target,
    directTotal: 0,
    total: 0,
    direct: [],
    children: [],
    errors: []
  };
  if (depth >= 8) {
    node.errors.push('目录层级过深，已跳过');
    return node;
  }
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (_) {
    node.errors.push('无法读取目录');
    return node;
  }
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, 'zh-CN') : a.isDirectory() ? -1 : 1));
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      const child = scanPath(full, depth + 1, includeRaw);
      if (child && (child.total > 0 || child.children.length)) {
        node.children.push(child);
        node.total += child.total;
      }
    } else if (entry.isFile() && /\.json$/i.test(entry.name)) {
      const r = parseJsonFile(full);
      const file = { type: 'file', name: entry.name, path: full, count: r.configs.length, error: r.error };
      if (includeRaw) file.configs = r.configs;
      node.direct.push(file);
      node.directTotal += r.configs.length;
      node.total += r.configs.length;
      if (r.error) node.errors.push(`${entry.name}：${r.error}`);
    }
  }
  return node;
}

function scanPaths(paths, includeRaw) {
  const files = [];
  const folders = [];
  const errors = [];
  let totalConfigs = 0;
  let totalFiles = 0;
  for (const p of paths || []) {
    const node = scanPath(String(p), 0, includeRaw);
    if (!node) continue;
    if (node.type === 'folder') {
      folders.push(node);
      totalConfigs += node.total;
      totalFiles += countJsonFiles(node);
    } else {
      files.push(node);
      totalConfigs += node.count;
      if (node.error) errors.push(`${node.name}：${node.error}`);
      if (/\.json$/i.test(node.path)) totalFiles++;
    }
  }
  return { files, folders, totalConfigs, totalFiles, errors };
}

function countJsonFiles(node) {
  let n = node.direct.length;
  node.children.forEach((c) => { n += countJsonFiles(c); });
  return n;
}

