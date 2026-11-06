import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const modulePath = process.env.ZEAPLAY_PLAYWRIGHT_MODULE;
if (!modulePath) throw Error('Set ZEAPLAY_PLAYWRIGHT_MODULE to the installed Playwright index.js path');
const playwright = await import(pathToFileURL(modulePath).href);
const chromium = playwright.chromium ?? playwright.default?.chromium;
const browser = await chromium.launch({ headless: true,
  ...(process.env.ZEAPLAY_CHROMIUM_EXECUTABLE ? { executablePath: process.env.ZEAPLAY_CHROMIUM_EXECUTABLE } : {}),
});
const output = path.join(tmpdir(), 'zeaplay-task-groups');
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(18000);
  try {
    const source = await readFile(new URL('./task-groups.playwright.js', import.meta.url), 'utf8');
    const run = new Function('return (' + source + ')')();
    const result = await run(page);
    await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    throw error;
  }
} finally {
  await browser.close();
}
