import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

export async function appendJsonlEntry(
  filePath: string,
  entry: unknown,
  errorTag: string
): Promise<void> {
  const line = JSON.stringify(entry);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${line}\n`, 'utf8');
  } catch (error) {
    console.error(`[${errorTag}] Failed to persist audit log:`, error);
  }
}
