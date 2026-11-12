#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const GH_REPO = 'LIULIWANJIA/Liulishell';
const GITEE_REPO = 'liuliwanjiaweb/liuli-shell';
const GITEE_BRANCH = 'master';
const UA = 'liuli-shell-release';
const GITEE_MAX = 100 * 1024 * 1024;

const opts = parseArgs(process.argv);
const version = opts.version || PKG.version;
const tag = 'v' + version;
const notes = opts.notes ? fs.readFileSync(opts.notes, 'utf8').trim() : '';
const setupExe = path.join(ROOT, 'dist', `LIULI Shell Setup ${version}.exe`);
const portableExe = path.join(ROOT, 'dist', `LIULI Shell ${version} Portable.exe`);

function help() {
  console.log(`用法：node scripts/release.js [选项]

  --platform=all|github|gitee  发布平台，默认 all
  --notes=<file>               UTF-8 发布说明（Markdown），提供时同步更新正文
  --version=<x.y.z>            版本号，默认读取 package.json
  --dry-run                    只检查与展示计划，不写远端
  --help                       显示本帮助

环境变量：
  GH_TOKEN / GITHUB_TOKEN      GitHub 令牌（repo 权限）
  GITEE_TOKEN                  Gitee 令牌（projects 权限）

约定：
  dist/ 需先打包；GitHub 上传安装版 + 便携版，Gitee 仅上传便携版（<100MB）`);
  process.exit(0);
}

function parseArgs(argv) {
  const out = { platform: 'all', notes: '', version: '', dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') help();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--platform=')) out.platform = a.slice(11);
    else if (a === '--platform') out.platform = argv[++i];
    else if (a.startsWith('--notes=')) out.notes = a.slice(8);
    else if (a === '--notes') out.notes = argv[++i];
    else if (a.startsWith('--version=')) out.version = a.slice(10);
    else if (a === '--version') out.version = argv[++i];
    else throw new Error('未知参数：' + a);
  }
  if (!['all', 'github', 'gitee'].includes(out.platform)) throw new Error('--platform 只能是 all / github / gitee');
  return out;
}

function collect(res, resolve) {
  const chunks = [];
  res.on('data', (d) => chunks.push(d));
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {}
    resolve({ status: res.statusCode, text, json });
  });
}

function req(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const h = { 'User-Agent': UA, ...headers };
    if (body !== undefined && h['Content-Length'] === undefined) h['Content-Length'] = Buffer.byteLength(body);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: h }, (res) => collect(res, resolve));
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

function uploadRaw(url, headers, file) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const size = fs.statSync(file).size;
    const r = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'User-Agent': UA, 'Content-Length': size, ...headers } },
      (res) => collect(res, resolve)
    );
    const s = fs.createReadStream(file);
    s.on('error', reject);
    r.on('error', reject);
    s.pipe(r);
  });
}

function uploadMultipart(url, token, file) {
  return new Promise((resolve, reject) => {
    const boundary = '----liuli' + Date.now().toString(16);
    const name = path.basename(file);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${token}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      'utf8'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const size = fs.statSync(file).size;
    const u = new URL(url);
    const r = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': head.length + size + tail.length
        }
      },
      (res) => collect(res, resolve)
    );
    r.on('error', reject);
    r.write(head);
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('end', () => r.end(tail));
    s.pipe(r, { end: false });
  });
}

function mustFile(file) {
  if (!fs.existsSync(file)) throw new Error('缺少产物：' + file + '（请先执行打包）');
  return file;
}

function fail(prefix, res) {
  throw new Error(prefix + '（HTTP ' + res.status + '）：' + String(res.text || '').slice(0, 300));
}

async function github() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token && opts.dryRun) return console.log('GitHub：未设置 GH_TOKEN，跳过');
  if (!token) throw new Error('缺少 GH_TOKEN / GITHUB_TOKEN 环境变量');
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  const api = (p, o = {}) => req('https://api.github.com/repos/' + GH_REPO + p, { ...o, headers: { ...headers, ...(o.headers || {}) } });

  const probe = await api('');
  if (probe.status !== 200) fail('GitHub 令牌校验失败', probe);

  let res = await api('/releases/tags/' + tag);
  if (res.status === 404) {
    if (opts.dryRun) return console.log('GitHub：Release ' + tag + ' 不存在，正式执行时将创建');
    res = await api('/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ tag_name: tag, name: tag, body: notes || 'LIULI Shell ' + tag, draft: false, prerelease: false })
    });
    if (res.status === 422) res = await api('/releases/tags/' + tag);
    if (res.status !== 201 && res.status !== 200) fail('GitHub Release 创建失败', res);
    console.log('GitHub：已创建 Release ' + tag);
  }
  if (res.status !== 200) fail('GitHub Release 查询失败', res);
  const release = res.json;

  if (notes && release.body !== notes) {
    if (opts.dryRun) console.log('GitHub：将更新发布说明');
    else {
      const upd = await api('/releases/' + release.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ body: notes })
      });
      if (upd.status !== 200) fail('GitHub 发布说明更新失败', upd);
      console.log('GitHub：已更新发布说明');
    }
  }

  const existing = new Map((release.assets || []).map((a) => [a.name, a]));
  for (const file of [mustFile(setupExe), mustFile(portableExe)]) {
    const name = path.basename(file).replace(/ /g, '.');
    if (existing.has(name)) {
      console.log('GitHub：跳过已存在资产 ' + name);
      continue;
    }
    if (opts.dryRun) {
      console.log('GitHub：将上传 ' + name);
      continue;
    }
    const up = await uploadRaw(
      'https://uploads.github.com/repos/' + GH_REPO + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(name),
      { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/octet-stream' },
      file
    );
    if (up.status !== 201) fail('GitHub 上传失败 ' + name, up);
    const local = fs.statSync(file).size;
    if (!up.json || up.json.size !== local) throw new Error('GitHub 上传大小不一致：' + name);
    console.log('GitHub：已上传 ' + name + '（' + local + ' 字节）');
  }

  const after = await api('/releases/' + release.id + '/assets');
  if (after.status === 200) {
    const list = after.json || [];
    for (const file of [setupExe, portableExe]) {
      const name = path.basename(file).replace(/ /g, '.');
      const hit = list.find((a) => a.name === name);
      if (!hit) throw new Error('GitHub 资产校验失败，缺少 ' + name);
    }
    console.log('GitHub：资产校验通过（' + list.map((a) => a.name).join(', ') + '）');
  }
  console.log('GitHub：https://github.com/' + GH_REPO + '/releases/tag/' + tag);
}

async function gitee() {
  const token = process.env.GITEE_TOKEN;
  if (!token && opts.dryRun) return console.log('Gitee：未设置 GITEE_TOKEN，跳过');
  if (!token) throw new Error('缺少 GITEE_TOKEN 环境变量');
  const base = 'https://gitee.com/api/v5/repos/' + GITEE_REPO;
  const q = '?access_token=' + encodeURIComponent(token);
  const g = (p, o = {}) => req(base + p + q, o);

  const probe = await req('https://gitee.com/api/v5/user' + q);
  if (probe.status !== 200) fail('Gitee 令牌校验失败', probe);

  let res = await g('/releases/tags/' + tag);
  let release = res.status === 200 && res.json && res.json.id ? res.json : null;
  if (!release && res.status !== 200 && res.status !== 404) fail('Gitee Release 查询失败', res);

  if (!release) {
    if (opts.dryRun) return console.log('Gitee：Release ' + tag + ' 不存在，正式执行时将创建');
    const payload = {
      access_token: token,
      tag_name: tag,
      name: tag,
      body: notes || 'LIULI Shell ' + tag,
      target_commitish: GITEE_BRANCH,
      prerelease: false
    };
    let created = await g('/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload)
    });
    if (!created.json || !created.json.id) {
      created = await g('/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(payload).toString()
      });
    }
    if (!created.json || !created.json.id) fail('Gitee Release 创建失败', created);
    release = created.json;
    console.log('Gitee：已创建 Release ' + tag);
  }

  if (notes && release.body !== notes) {
    if (opts.dryRun) console.log('Gitee：将更新发布说明');
    else {
      const upd = await g('/releases/' + release.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ access_token: token, tag_name: tag, name: tag, body: notes, prerelease: false })
      });
      if (upd.status !== 200) fail('Gitee 发布说明更新失败', upd);
      console.log('Gitee：已更新发布说明');
    }
  }

  const file = mustFile(portableExe);
  const size = fs.statSync(file).size;
  if (size > GITEE_MAX) throw new Error('Gitee 单文件上限 100MB，便携版为 ' + size + ' 字节');
  const name = path.basename(file);
  const existing = new Set((release.assets || []).map((a) => a.name));
  if (existing.has(name)) console.log('Gitee：跳过已存在资产 ' + name);
  else if (opts.dryRun) console.log('Gitee：将上传 ' + name);
  else {
    const up = await uploadMultipart(base + '/releases/' + release.id + '/attach_files', token, file);
    if (up.status !== 201) fail('Gitee 上传失败 ' + name, up);
    if (up.json && up.json.size && Number(up.json.size) !== size) throw new Error('Gitee 上传大小不一致：' + name);
    console.log('Gitee：已上传 ' + name + '（' + size + ' 字节）');
  }

  const after = await g('/releases/' + release.id);
  if (after.status === 200 && after.json && Array.isArray(after.json.assets)) {
    if (!after.json.assets.some((a) => a.name === name)) throw new Error('Gitee 资产校验失败，缺少 ' + name);
    console.log('Gitee：资产校验通过（' + after.json.assets.map((a) => a.name).join(', ') + '）');
  }
  console.log('Gitee：https://gitee.com/' + GITEE_REPO + '/releases/tag/' + tag);
}

(async () => {
  console.log('发布 ' + tag + '（' + opts.platform + (opts.dryRun ? '，dry-run' : '') + '）');
  if (opts.platform !== 'gitee') await github();
  if (opts.platform !== 'github') await gitee();
})().catch((err) => {
  console.error('失败：' + err.message);
  process.exit(1);
});
