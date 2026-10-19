#!/usr/bin/env node
/**
 * 软著源码鉴别材料导出
 * - 按固定模块顺序拼接业务源码
 * - 每页 50 行，页眉含软件全称与版本
 * - 输出前 30 页 + 后 30 页到 design/soft-copyright/03-源码鉴别材料/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'design/soft-copyright/03-源码鉴别材料');

const SOFTWARE_NAME = 'OOTD智能穿搭助手软件 V1.0';
const LINES_PER_PAGE = 50;
const PAGES_EACH = 30;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
  'chromium-browser',
];

/** 优先收录的目录（相对仓库根），按软著「连续源码」习惯从前到后排列 */
const INCLUDE_DIRS = [
  'server/agents/gatekeeper',
  'server/agents/intent',
  'server/agents/rag',
  'server/agents/stylist',
  'server/agents/copywriter',
  'server/agents/visual',
  'server/agents/user-profile',
  'server/utils',
  'server/auth',
  'server/services',
  'server/logging',
  'server/config',
  'app/api/generate-with-image',
  'app/api/wardrobe',
  'app/api/auth',
  'app/api/conversations',
  'app/api/profile',
  'app/api/upload',
  'app/api/access',
];

const EXT_OK = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_NAME = new Set(['.ds_store']);

const SECRET_LINE =
  /(api[_-]?key|secret|password|private[_-]?key|begin (rsa |ec )?private|sk-[a-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,})/i;

function walkFiles(dirAbs, acc = []) {
  if (!fs.existsSync(dirAbs)) return acc;
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const ent of entries) {
    const full = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walkFiles(full, acc);
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!EXT_OK.has(ext)) continue;
    if (ent.name.endsWith('.d.ts')) continue;
    if (SKIP_NAME.has(ent.name.toLowerCase())) continue;
    acc.push(full);
  }
  return acc;
}

function collectOrderedFiles() {
  const files = [];
  const seen = new Set();
  for (const rel of INCLUDE_DIRS) {
    const abs = path.join(ROOT, rel);
    for (const f of walkFiles(abs)) {
      if (seen.has(f)) continue;
      seen.add(f);
      files.push(f);
    }
  }
  return files;
}

function sanitizeLine(line) {
  if (!SECRET_LINE.test(line)) return line;
  return '// [REDACTED: sensitive literal removed for soft-copyright deposit]';
}

function buildLineStream(files) {
  /** @type {string[]} */
  const lines = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    lines.push(`// ===== FILE: ${rel} =====`);
    const raw = fs.readFileSync(file, 'utf8');
    const fileLines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    for (const line of fileLines) {
      // 软著页宽友好：过长行截断，避免 PDF 排版溢出（保留可识别前缀）
      const sanitized = sanitizeLine(line);
      const clipped =
        sanitized.length > 120 ? `${sanitized.slice(0, 117)}...` : sanitized;
      lines.push(clipped.length === 0 ? ' ' : clipped);
    }
    lines.push(' ');
  }
  return lines;
}

function paginate(allLines) {
  const pages = [];
  for (let i = 0; i < allLines.length; i += LINES_PER_PAGE) {
    pages.push(allLines.slice(i, i + LINES_PER_PAGE));
  }
  // 最后一页若不足 50 行，用空行补齐（交存习惯：每页尽量满行）
  if (pages.length > 0) {
    const last = pages[pages.length - 1];
    while (last.length < LINES_PER_PAGE) last.push(' ');
  }
  return pages;
}

function renderPages(pages, startPageNum, { formFeed = false } = {}) {
  const chunks = [];
  pages.forEach((pageLines, idx) => {
    const pageNum = startPageNum + idx;
    if (idx > 0) {
      chunks.push(formFeed ? '\f' : '');
    }
    chunks.push(`${SOFTWARE_NAME}    第 ${pageNum} 页`);
    chunks.push('-'.repeat(72));
    for (const line of pageLines) chunks.push(line);
    if (!formFeed) {
      chunks.push('');
      chunks.push('');
    }
  });
  return chunks.join('\n');
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 每逻辑页一个 block，CSS 强制 PDF 一页对应一逻辑页（Pages/Word 不认 \f 时用这个） */
function renderHtml(pageSets) {
  const blocks = [];
  for (const { pages, startPageNum } of pageSets) {
    pages.forEach((pageLines, idx) => {
      const pageNum = startPageNum + idx;
      const body = pageLines.map((line) => escapeHtml(line)).join('\n');
      blocks.push(
        [
          '<section class="page">',
          `<header>${escapeHtml(SOFTWARE_NAME)}　　第 ${pageNum} 页</header>`,
          `<pre>${body}</pre>`,
          '</section>',
        ].join('\n'),
      );
    });
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(SOFTWARE_NAME)} 源程序鉴别材料</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  .page {
    page-break-after: always;
    break-after: page;
    width: 100%;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  header {
    font-family: "PingFang SC", "Helvetica Neue", sans-serif;
    font-size: 10pt;
    font-weight: 600;
    margin: 0 0 6px 0;
    border-bottom: 1px solid #333;
    padding-bottom: 4px;
  }
  pre {
    margin: 0;
    font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
    font-size: 8.2pt;
    line-height: 1.28;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
</head>
<body>
${blocks.join('\n')}
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
    console.warn('未找到 Chrome/Chromium，跳过 PDF 生成。可打开 .html 用浏览器「打印 → 存储为 PDF」。');
    return false;
  }
  const htmlUrl = `file://${htmlPath}`;
  const result = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      htmlUrl,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !fs.existsSync(pdfPath)) {
    console.error(result.stderr || result.stdout || 'Chrome 打印 PDF 失败');
    return false;
  }
  return true;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = collectOrderedFiles();
  if (files.length === 0) {
    console.error('未找到可导出源码文件');
    process.exit(1);
  }

  const allLines = buildLineStream(files);
  const pages = paginate(allLines);
  const totalPages = pages.length;
  const take = Math.min(PAGES_EACH, totalPages);

  let frontPages;
  let backPages;
  let frontStart;
  let backStart;

  if (totalPages <= PAGES_EACH * 2) {
    // 不足 60 页：全部提交，前半 / 后半拆分便于对照
    const mid = Math.ceil(totalPages / 2);
    frontPages = pages.slice(0, mid);
    backPages = pages.slice(mid);
    frontStart = 1;
    backStart = mid + 1;
  } else {
    frontPages = pages.slice(0, take);
    backPages = pages.slice(totalPages - take);
    frontStart = 1;
    backStart = totalPages - take + 1;
  }

  const meta = [
    `# ${SOFTWARE_NAME} — 源码鉴别材料说明`,
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 收录文件数：${files.length}`,
    `- 源程序连续行数（含文件分隔注释）：${allLines.length}`,
    `- 分页：每页 ${LINES_PER_PAGE} 行，共 ${totalPages} 页`,
    `- 前部页码：${frontStart}–${frontStart + frontPages.length - 1}（${frontPages.length} 页）`,
    `- 后部页码：${backStart}–${backStart + backPages.length - 1}（${backPages.length} 页）`,
    `- 敏感字面量已替换为 REDACTED 注释`,
    '',
    '## 收录文件顺序',
    '',
    ...files.map((f, i) => `${i + 1}. ${path.relative(ROOT, f).replace(/\\/g, '/')}`),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(OUT_DIR, '00-生成说明.md'), meta, 'utf8');

  // 纯文本：提交用（无 Markdown、无代码围栏）。页间含分页符，便于 Word 按页断开。
  const frontTxt = renderPages(frontPages, frontStart, { formFeed: true });
  const backTxt = renderPages(backPages, backStart, { formFeed: true });
  const mergedTxt = [
    frontTxt,
    '\f',
    backTxt,
    '',
  ].join('\n');

  fs.writeFileSync(path.join(OUT_DIR, 'front.txt'), frontTxt, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'back.txt'), backTxt, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '源码鉴别材料-合并.txt'), mergedTxt, 'utf8');

  // Markdown 预览稿（仍用代码围栏方便阅读；正式提交请用上面的 .txt）
  fs.writeFileSync(
    path.join(OUT_DIR, 'front.md'),
    `# ${SOFTWARE_NAME}\n\n> 预览用。正式提交请用 \`front.txt\` / \`源码鉴别材料-合并.txt\`。\n\n\`\`\`\n${renderPages(frontPages, frontStart)}\n\`\`\`\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'back.md'),
    `# ${SOFTWARE_NAME}\n\n> 预览用。正式提交请用 \`back.txt\` / \`源码鉴别材料-合并.txt\`。\n\n\`\`\`\n${renderPages(backPages, backStart)}\n\`\`\`\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(OUT_DIR, '源码鉴别材料-合并.md'),
    [
      `# ${SOFTWARE_NAME}`,
      '',
      '> **预览用。** Mac 用户请直接提交同目录 `源码鉴别材料-合并.pdf`（逻辑页 = PDF 页）。',
      '> `.txt` 里的分页符 Pages 往往不认；`.md` 的代码块只是编辑器壳。',
      '',
      '```',
      renderPages(frontPages, frontStart),
      '',
      renderPages(backPages, backStart),
      '```',
      '',
    ].join('\n'),
    'utf8',
  );

  // HTML + PDF：保证「第 N 页」= PDF 物理页（不等 Pages/Word 认分页符）
  const htmlPath = path.join(OUT_DIR, '源码鉴别材料-合并.html');
  const pdfPath = path.join(OUT_DIR, '源码鉴别材料-合并.pdf');
  fs.writeFileSync(
    htmlPath,
    renderHtml([
      { pages: frontPages, startPageNum: frontStart },
      { pages: backPages, startPageNum: backStart },
    ]),
    'utf8',
  );
  const pdfOk = htmlToPdf(htmlPath, pdfPath);

  console.log(
    JSON.stringify(
      {
        files: files.length,
        lines: allLines.length,
        totalPages,
        frontPages: frontPages.length,
        backPages: backPages.length,
        pdf: pdfOk ? path.relative(ROOT, pdfPath) : null,
        html: path.relative(ROOT, htmlPath),
        outDir: path.relative(ROOT, OUT_DIR),
      },
      null,
      2,
    ),
  );
}

main();
