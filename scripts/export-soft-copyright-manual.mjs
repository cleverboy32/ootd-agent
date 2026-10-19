#!/usr/bin/env node
/**
 * 软著「文档鉴别材料」导出：软件说明书 → HTML → PDF
 * 规则：不足 60 页提交全文；每页排版保证可读且不少于约 30 行密度。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'design/soft-copyright');
const MD_PATH = path.join(OUT_DIR, '02-软件说明书.md');
const SOFTWARE_NAME = 'OOTD智能穿搭助手软件 V1.0';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
];

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

/** 够用的 Markdown → HTML（覆盖说明书里用到的语法） */
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];
  let inUl = false;
  let inOl = false;
  let tableBuf = [];

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };

  const flushTable = () => {
    if (tableBuf.length === 0) return;
    const rows = tableBuf.filter((r) => !/^\s*\|?\s*:?-{3,}/.test(r));
    if (rows.length === 0) {
      tableBuf = [];
      return;
    }
    out.push('<table>');
    rows.forEach((row, idx) => {
      const cells = row
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
      const tag = idx === 0 ? 'th' : 'td';
      out.push('<tr>');
      for (const c of cells) out.push(`<${tag}>${inlineFormat(c)}</${tag}>`);
      out.push('</tr>');
    });
    out.push('</table>');
    tableBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      flushTable();
      closeLists();
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeBuf = [];
      } else {
        out.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        inCode = false;
        codeBuf = [];
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }

    if (line.trim().startsWith('|')) {
      closeLists();
      tableBuf.push(line);
      i += 1;
      continue;
    }
    if (tableBuf.length) flushTable();

    if (/^\s*---+\s*$/.test(line)) {
      closeLists();
      out.push('<hr />');
      i += 1;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inlineFormat(h[2])}</h${level}>`);
      i += 1;
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${inlineFormat(ul[1])}</li>`);
      i += 1;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${inlineFormat(ol[1])}</li>`);
      i += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      closeLists();
      out.push(`<blockquote><p>${inlineFormat(line.slice(2))}</p></blockquote>`);
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      closeLists();
      i += 1;
      continue;
    }

    closeLists();
    out.push(`<p>${inlineFormat(line)}</p>`);
    i += 1;
  }

  flushTable();
  closeLists();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  return out.join('\n');
}

function wrapDocument(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(SOFTWARE_NAME)} 软件说明书</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "PingFang SC", "Songti SC", "STSong", serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #111;
  }
  h1 { font-size: 18pt; text-align: center; margin: 0 0 12pt; page-break-after: avoid; }
  h2 { font-size: 14pt; margin: 18pt 0 8pt; border-bottom: 1px solid #ccc; padding-bottom: 4pt; page-break-after: avoid; }
  h3 { font-size: 12pt; margin: 14pt 0 6pt; page-break-after: avoid; }
  h4 { font-size: 11pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  p, li { font-size: 11pt; line-height: 1.75; }
  p { margin: 0 0 8pt; text-align: justify; }
  ul, ol { margin: 0 0 10pt; padding-left: 1.4em; }
  li { margin: 2pt 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0 12pt;
    font-size: 10pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #444;
    padding: 4pt 6pt;
    vertical-align: top;
  }
  th { background: #f3f3f3; font-weight: 600; }
  pre {
    background: #f7f7f7;
    border: 1px solid #ddd;
    padding: 8pt;
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 9pt;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-all;
    page-break-inside: avoid;
  }
  code { font-family: Menlo, Monaco, Consolas, monospace; font-size: 0.92em; }
  hr { border: none; border-top: 1px solid #ccc; margin: 16pt 0; }
  blockquote {
    margin: 8pt 0;
    padding: 4pt 10pt;
    border-left: 3px solid #999;
    color: #333;
  }
  .cover {
    text-align: center;
    margin: 40pt 0 28pt;
  }
  .cover .sub { margin-top: 8pt; font-size: 12pt; color: #333; }
  .note {
    margin: 12pt 0 24pt;
    padding: 8pt 10pt;
    border: 1px solid #bbb;
    font-size: 10pt;
    background: #fafafa;
  }
</style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(SOFTWARE_NAME)}</h1>
    <div class="sub">软件说明书（文档鉴别材料）</div>
    <div class="sub">版本：V1.0</div>
  </div>
  <div class="note">
    本文档用于计算机软件著作权登记之文档鉴别材料交存。
    全文不足 60 页，按要求提交整个文档。文档内容涵盖程序组成、功能规格、使用方法与系统结构说明。
  </div>
  ${bodyHtml}
</body>
</html>
`;
}

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (c.includes('/') && fs.existsSync(c)) return c;
    const which = spawnSync('which', [c], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  return null;
}

function htmlToPdf(htmlPath, pdfPath) {
  const chrome = findChrome();
  if (!chrome) {
    console.warn('未找到 Chrome，请手动打开 HTML 后「打印 → 存储为 PDF」');
    return false;
  }
  // Chrome 对 @page 页眉页脚支持有限；用内置页眉页脚关闭，正文已自带封面说明
  const result = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { encoding: 'utf8', timeout: 120000 },
  );
  if (result.status !== 0 || !fs.existsSync(pdfPath)) {
    console.error('PDF 生成失败', {
      status: result.status,
      error: result.error?.message,
      stderr: (result.stderr || '').slice(0, 800),
      stdout: (result.stdout || '').slice(0, 400),
    });
    return false;
  }
  return true;
}

function main() {
  const md = fs.readFileSync(MD_PATH, 'utf8');
  // 去掉首行大标题，避免与封面重复
  const mdBody = md.replace(/^#\s+OOTD智能穿搭助手软件 V1\.0\s*\n+/, '');
  const html = wrapDocument(mdToHtml(mdBody));
  const htmlPath = path.join(OUT_DIR, '02-软件说明书.html');
  const pdfPath = path.join(OUT_DIR, '02-软件说明书.pdf');
  fs.writeFileSync(htmlPath, html, 'utf8');
  const ok = htmlToPdf(htmlPath, pdfPath);
  const approxPages = Math.max(1, Math.round(md.split('\n').length / 35));
  console.log(
    JSON.stringify(
      {
        md: path.relative(ROOT, MD_PATH),
        html: path.relative(ROOT, htmlPath),
        pdf: ok ? path.relative(ROOT, pdfPath) : null,
        mdLines: md.split('\n').length,
        note: `全文约 ${approxPages} 页量级（<60），应提交整个文档，无需再拆前30/后30`,
      },
      null,
      2,
    ),
  );
}

main();
