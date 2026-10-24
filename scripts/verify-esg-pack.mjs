import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function loadArtifactTool() {
  try { return await import('@oai/artifact-tool'); }
  catch {
    const bundled = process.env.ARTIFACT_TOOL_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs');
    return import(pathToFileURL(bundled).href);
  }
}
const { FileBlob, SpreadsheetFile } = await loadArtifactTool();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'app/downloads/esg');
const PREVIEWS = path.join(ROOT, 'run/xlsx-previews');
const sheets = {
  '摘要': 'A1:C14',
  '逐棵明細': 'A1:P20',
  '盤點紀錄': 'A1:H20',
  'GRI 對照': 'A1:E6',
  '報告書段落': 'A1:C4',
  '方法與限制': 'A1:B13',
};

await fs.mkdir(PREVIEWS, { recursive: true });
const files = (await fs.readdir(SOURCE)).filter((name) => name.endsWith('.xlsx')).sort();
const result = {};
for (const file of files) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(SOURCE, file)));
  result[file] = {};
  let formulaErrors = 0;
  for (const [sheetName, range] of Object.entries(sheets)) {
    const sheet = workbook.worksheets.getItem(sheetName);
    const values = sheet.getUsedRange(true).values;
    result[file][sheetName] = Math.max(0, values.length - 1);
    formulaErrors += values.flat().filter((value) => typeof value === 'string' && /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)$/.test(value)).length;
    const preview = await workbook.render({ sheetName, range, scale: 1, format: 'png' });
    await fs.writeFile(path.join(PREVIEWS, `${path.basename(file, '.xlsx')}-${sheetName.replaceAll(' ', '-')}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
  result[file].formulaErrors = formulaErrors;
}
console.log(JSON.stringify(result, null, 2));
