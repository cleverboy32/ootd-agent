import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

type ResultRow = {
  caseId: string;
  title: string;
  status: TestResult['status'];
  durationMs: number;
  file: string;
  error?: string;
};

const OUTPUT_FILES = {
  mock: path.join(process.cwd(), 'design/test-results/2026-08-31-e2e-mock-acceptance-results.md'),
  live: path.join(process.cwd(), 'design/test-results/2026-08-31-ui-live-acceptance-results.md'),
};

function resolveOutputFile(): string {
  if (process.env.PW_LIVE === '1') return OUTPUT_FILES.live;
  return OUTPUT_FILES.mock;
}

function resolveTitle(): string {
  return process.env.PW_LIVE === '1'
    ? '真实 UI 走查验收结果（Live · 无 API Mock）'
    : 'E2E 验收测试结果（Mock API · UI 逻辑）';
}

class AcceptanceMarkdownReporter implements Reporter {
  private rows: ResultRow[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const titlePath = test.titlePath().slice(1).join(' › ');
    const idMatch = test.title.match(/\[(ACC|LIVE)-[A-Z0-9]+\]/);

    this.rows.push({
      caseId: idMatch?.[0] ?? '-',
      title: titlePath,
      status: result.status,
      durationMs: result.duration,
      file: path.relative(process.cwd(), test.location.file),
      error: result.error?.message,
    });
  }

  onEnd(result: FullResult): void {
    const outputFile = resolveOutputFile();
    const outDir = path.dirname(outputFile);
    fs.mkdirSync(outDir, { recursive: true });

    const passed = this.rows.filter((row) => row.status === 'passed').length;
    const failed = this.rows.filter(
      (row) => row.status === 'failed' || row.status === 'timedOut' || row.status === 'interrupted'
    ).length;
    const skipped = this.rows.filter((row) => row.status === 'skipped').length;
    const isLive = process.env.PW_LIVE === '1';

    const lines: string[] = [
      `# ${resolveTitle()}`,
      '',
      `> 生成时间：${new Date().toISOString()}`,
      `> 方案文档：[2026-08-31-e2e-acceptance-test-plan.md](../features/2026-08-31-e2e-acceptance-test-plan.md)`,
      `> 浏览器：系统 Google Chrome（channel: chrome）`,
      isLive
        ? `> 说明：**真实** dev server + DB + ACCESS_CODE + LLM，无 page.route mock`
        : `> 说明：UI 交互真实，API 层使用 page.route mock（快速回归）`,
      '',
      '## 汇总',
      '',
      '| 指标 | 数值 |',
      '|---|---|',
      `| 总计 | ${this.rows.length} |`,
      `| 通过 | ${passed} |`,
      `| 失败 | ${failed} |`,
      `| 跳过 | ${skipped} |`,
      `| 总耗时 | ${Math.round(result.duration / 1000)}s |`,
      `| 整体状态 | ${result.status} |`,
      '',
      '## 用例明细',
      '',
      '| ID | 用例 | 状态 | 耗时 | 文件 |',
      '|---|---|---|---|---|',
    ];

    for (const row of this.rows) {
      const icon =
        row.status === 'passed' ? '✅' : row.status === 'skipped' ? '⏭️' : '❌';
      lines.push(
        `| ${row.caseId} | ${row.title} | ${icon} ${row.status} | ${row.durationMs}ms | \`${row.file}\` |`
      );
    }

    const failures = this.rows.filter(
      (row) =>
        row.status === 'failed' || row.status === 'timedOut' || row.status === 'interrupted'
    );

    if (failures.length > 0) {
      lines.push('', '## 失败详情', '');
      for (const failure of failures) {
        lines.push(`### ${failure.caseId} ${failure.title}`, '');
        lines.push('```');
        lines.push(failure.error ?? 'unknown error');
        lines.push('```', '');
      }
    }

    if (isLive) {
      lines.push(
        '## 仍未覆盖（需人工/脚本）',
        '',
        '- 衣橱上传 + COS + 双向量入库',
        '- RAG 分数阈值：`pnpm replay:rag-scores`',
        '- 效果图质量：`log/visual-audit.jsonl`',
        ''
      );
    } else {
      lines.push(
        '## 真实 UI 走查',
        '',
        '运行 `pnpm test:e2e:live` 对真实后端做 UI 验收，结果见 `2026-08-31-ui-live-acceptance-results.md`。',
        ''
      );
    }

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf8');
    console.log(`[acceptance-report] wrote ${outputFile}`);
  }
}

export default AcceptanceMarkdownReporter;
