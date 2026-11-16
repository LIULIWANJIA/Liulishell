'use strict';
/*
 * 官网静态多语言构建
 * 输入：src/template.html + src/locales/<lang>.json
 * 输出：index.html、en.html、sitemap.xml、robots.txt
 * 用法：node build.js  或  powershell -File build.ps1
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const SITE = 'https://shell.minecft.cn';

const LANGS = [
  { id: 'zh', file: 'index.html', url: '/', htmlLang: 'zh-CN', ogLocale: 'zh_CN', hero: 'img/hero-zh.webp', label: '简体中文' },
  { id: 'zh-Hant', file: 'zh-Hant.html', url: '/zh-Hant.html', htmlLang: 'zh-Hant', ogLocale: 'zh_TW', hero: 'img/hero-zh-Hant.webp', label: '繁體中文' },
  { id: 'en', file: 'en.html', url: '/en.html', htmlLang: 'en', ogLocale: 'en_US', hero: 'img/hero-en.webp', label: 'English' },
  { id: 'ja', file: 'ja.html', url: '/ja.html', htmlLang: 'ja', ogLocale: 'ja_JP', hero: 'img/hero-ja.webp', label: '日本語' },
  { id: 'ko', file: 'ko.html', url: '/ko.html', htmlLang: 'ko', ogLocale: 'ko_KR', hero: 'img/hero-ko.webp', label: '한국어' },
  { id: 'ru', file: 'ru.html', url: '/ru.html', htmlLang: 'ru', ogLocale: 'ru_RU', hero: 'img/hero-ru.webp', label: 'Русский' },
  { id: 'fr', file: 'fr.html', url: '/fr.html', htmlLang: 'fr', ogLocale: 'fr_FR', hero: 'img/hero-fr.webp', label: 'Français' },
  { id: 'de', file: 'de.html', url: '/de.html', htmlLang: 'de', ogLocale: 'de_DE', hero: 'img/hero-de.webp', label: 'Deutsch' }
];

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

const template = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');
const packs = {};
for (const lang of LANGS) {
  const file = path.join(SRC, 'locales', lang.id + '.json');
  packs[lang.id] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

function absUrl(lang) {
  return SITE + (lang.url === '/' ? '/' : lang.url);
}

function seoLinks() {
  const lines = LANGS.map((l) => `<link rel="alternate" hreflang="${l.htmlLang}" href="${absUrl(l)}" />`);
  lines.push(`<link rel="alternate" hreflang="x-default" href="${absUrl(LANGS[0])}" />`);
  return lines.join('\n');
}

function seoMeta(lang, pack) {
  const canonical = absUrl(lang);
  const heroUrl = SITE + '/' + lang.hero;
  const others = LANGS.filter((l) => l.id !== lang.id);
  const lines = [
    `<link rel="canonical" href="${canonical}" />`,
    '<meta name="robots" content="index,follow" />',
    '<meta name="author" content="LIULIWANJIA" />',
    '<meta name="application-name" content="LIULI Shell" />',
    '<meta name="theme-color" content="#f5f6f6" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="LIULI Shell" />',
    `<meta property="og:title" content="${escAttr(pack.meta.title)}" />`,
    `<meta property="og:description" content="${escAttr(pack.meta.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${heroUrl}" />`,
    `<meta property="og:image:alt" content="${escAttr(pack.meta.ogImageAlt || 'LIULI Shell')}" />`,
    `<meta property="og:locale" content="${lang.ogLocale}" />`
  ];
  for (const o of others) lines.push(`<meta property="og:locale:alternate" content="${o.ogLocale}" />`);
  lines.push(
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escAttr(pack.meta.title)}" />`,
    `<meta name="twitter:description" content="${escAttr(pack.meta.description)}" />`,
    `<meta name="twitter:image" content="${heroUrl}" />`
  );
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'LIULI Shell',
    alternateName: '琉璃 Shell',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Windows 10/11, Linux, macOS',
    description: pack.meta.description,
    url: canonical,
    downloadUrl: 'https://github.com/LIULIWANJIA/Liulishell/releases',
    image: heroUrl,
    screenshot: heroUrl,
    inLanguage: lang.htmlLang,
    author: { '@type': 'Person', name: 'LIULIWANJIA' },
    sameAs: ['https://github.com/LIULIWANJIA/Liulishell']
  };
  lines.push(`<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>`);
  return lines.join('\n');
}

function langHref(l) {
  return l.url === '/' ? 'index.html' : l.file;
}

function langMenu(current) {
  const items = LANGS.map((l) => {
    const cur = l.id === current.id;
    return `<a href="${langHref(l)}" hreflang="${l.htmlLang}"${cur ? ' aria-current="page"' : ''}>${escHtml(l.label)}</a>`;
  }).join('');
  return `<details class="lang-menu"><summary aria-label="${escAttr(current.label)}">${escHtml(current.label)} <i>▾</i></summary><div class="lang-list">${items}</div></details>`;
}

const EXONYMS = {
  zh: 'Chinese (Simplified)',
  'zh-Hant': 'Chinese (Traditional)',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  fr: 'French',
  de: 'German'
};

function langCards(current) {
  return LANGS.map((l) => {
    const on = l.id === current.id;
    return `<div class="lang-card${on ? ' on' : ''}"><b>${escHtml(l.label)}</b><i>${escHtml(EXONYMS[l.id] || '')} · ${escHtml(l.htmlLang)}</i></div>`;
  }).join('');
}

function render(lang) {
  const pack = packs[lang.id];
  let out = template;
  out = out.replace(/\{\{htmlLang\}\}/g, lang.htmlLang);
  out = out.replace(/\{\{seoLinks\}\}/g, seoLinks());
  out = out.replace(/\{\{seoMeta\}\}/g, seoMeta(lang, pack));
  out = out.replace(/\{\{langMenu\}\}/g, langMenu(lang));
  out = out.replace(/\{\{langCards\}\}/g, langCards(lang));
  out = out.replace(/\{\{heroImage\}\}/g, lang.hero);
  out = out.replace(/\{\{meta\.title\}\}/g, escHtml(pack.meta.title));
  out = out.replace(/\{\{meta\.description\}\}/g, escAttr(pack.meta.description));
  out = out.replace(/\{\{meta\.keywords\}\}/g, escAttr(pack.meta.keywords));

  out = out.replace(/\{\{([kj]\d{3})\}\}/g, (m, key) => {
    const value = pack.text && pack.text[key];
    if (value == null) throw new Error(`Missing text key ${key} in ${lang.id}`);
    if (key[0] === 'j') return JSON.stringify(value);
    return value;
  });

  const left = out.match(/\{\{[^}]+\}\}/g);
  if (left) throw new Error(`Unreplaced placeholders in ${lang.id}: ${[...new Set(left)].slice(0, 8).join(', ')}`);
  if (!pack.meta.title || !pack.meta.description) throw new Error(`Missing meta in ${lang.id}`);
  return out;
}

for (const lang of LANGS) {
  const html = render(lang);
  fs.writeFileSync(path.join(ROOT, lang.file), html, 'utf8');
  console.log(`  ${lang.file}  ${Buffer.byteLength(html, 'utf8')} bytes`);
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const links = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.htmlLang}" href="${absUrl(l)}" />`);
  const xdefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${absUrl(LANGS[0])}" />`;
  const urls = LANGS.map((l) => [
    '  <url>',
    `    <loc>${absUrl(l)}</loc>`,
    ...links,
    xdefault,
    `    <lastmod>${today}</lastmod>`,
    '    <changefreq>monthly</changefreq>',
    `    <priority>${l.id === LANGS[0].id ? '1.0' : '0.9'}</priority>`,
    '  </url>'
  ].join('\n')).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    '</urlset>',
    ''
  ].join('\n');
}
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap(), 'utf8');
fs.writeFileSync(path.join(ROOT, 'robots.txt'), [
  'User-agent: *',
  'Allow: /',
  '',
  `Sitemap: ${SITE}/sitemap.xml`,
  ''
].join('\n'), 'utf8');
console.log('  sitemap.xml');
console.log('  robots.txt');
console.log('build done');
