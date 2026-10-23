import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const reportPath = process.env.ZEAPLAY_BUILD_REPORT;
if (!reportPath) throw new Error('Set ZEAPLAY_BUILD_REPORT to an output JSON path');
await build({ plugins: [{
  name: 'report-initial-bundle',
  async generateBundle(_, bundle) {
    const entries = Object.values(bundle).filter(value => value.type === 'chunk' && value.isEntry);
    const visited = new Set();
    const visit = file => {
      if (visited.has(file)) return;
      visited.add(file);
      const chunk = bundle[file];
      if (chunk?.type === 'chunk') chunk.imports.forEach(visit);
    };
    entries.forEach(chunk => visit(chunk.fileName));
    const initial = [...visited].map(file => bundle[file]).filter(value => value?.type === 'chunk');
    const modules = initial.flatMap(chunk => Object.entries(chunk.modules).map(([id, info]) => ({
      id: id.replaceAll('\\', '/').replace(process.cwd().replaceAll('\\', '/'), '.'), bytes: info.renderedLength,
    }))).sort((a, b) => b.bytes - a.bytes);
    const report = {
      initialJavaScriptBytes: initial.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
      initialJavaScriptGzipBytes: initial.reduce((sum, chunk) => sum + gzipSync(chunk.code).length, 0),
      initialChunks: initial.map(chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code) })),
      initialModules: modules,
      chunks: Object.values(bundle).filter(value => value.type === 'chunk').map(chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code) })),
    };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Initial JavaScript: ${report.initialJavaScriptBytes} bytes (${report.initialJavaScriptGzipBytes} gzip)`);
  },
}] });
