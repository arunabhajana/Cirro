import { unzipSync, strFromU8 } from 'fflate';
import { describeFile } from './shared/fileDescription';
import type { DriveFile } from './data';
export type PreviewContent = { kind: 'text'; text: string; note?: string } | { kind: 'table'; rows: string[][]; note?: string } | { kind: 'archive'; entries: { name: string; size: number; directory: boolean }[]; note?: string };
const MAX_SOURCE = 32 * 1024 * 1024;
const MAX_EXTRACTED = 2 * 1024 * 1024;
export function archiveContents(bytes: Uint8Array) {
  const entries: { name: string; size: number; directory: boolean }[] = [];
  unzipSync(bytes, { filter: file => { if (entries.length >= 2000) throw new Error('Archive contains more than 2,000 entries. Open it in an archive application.'); entries.push({ name: file.name, size: file.originalSize, directory: file.name.endsWith('/') }); return false; } });
  return entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}
function extract(bytes: Uint8Array, names: (name: string) => boolean) {
  let total = 0;
  return unzipSync(bytes, { filter: file => { if (!names(file.name)) return false; total += file.originalSize; if (file.originalSize > MAX_EXTRACTED || total > 4 * MAX_EXTRACTED) throw new Error('Document is too large for a quick preview. Download it to open in its application.'); return true; } });
}
function xml(bytes?: Uint8Array) { if (!bytes) return null; const doc = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('The document contains invalid XML.'); return doc; }
const nodes = (doc: Document | Element, name: string) => Array.from(doc.getElementsByTagNameNS('*', name));
export function delimitedRows(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length && rows.length < 100; index++) { const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && character === delimiter) { if (row.length < 24) row.push(field); field = ''; }
    else if (!quoted && character === '\n') { if (row.length < 24) row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (rows.length < 100 && (field || row.length)) { if (row.length < 24) row.push(field); rows.push(row); }
  return rows;
}
export async function loadPreview(file: DriveFile, signal: AbortSignal, sourceBlob?: Blob): Promise<PreviewContent> {
  if (!file.url?.startsWith('blob:')) throw new Error('File content is not available in memory. Open Quick Look again to request it from Google Drive.');
  const units = ['B','KB','MB','GB','TB'];
  const unit = units.indexOf(file.size.split(' ').pop()?.toUpperCase() || 'B');
  if ((parseFloat(file.size) || 0) * 1000 ** Math.max(0, unit) > MAX_SOURCE) throw new Error('Quick previews support files up to 32 MB. Download this file to open it.');
  let blob=sourceBlob;
  if(!blob){const response=await fetch(file.url,{signal});if(!response.ok)throw new Error('This local file is no longer available. Add it again to preview.');blob=await response.blob();}
  const info = describeFile(file);
  if (blob.size > MAX_SOURCE) throw new Error('Quick previews support files up to 32 MB. Download this file to open it.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const ext = info.extension;
  if (ext === 'zip') return { kind: 'archive', entries: archiveContents(bytes) };
  if (ext === 'csv' || ext === 'tsv') return { kind: 'table', rows: delimitedRows(new TextDecoder().decode(bytes.slice(0, MAX_EXTRACTED)), ext === 'tsv' ? '\t' : ','), note: 'First 100 rows · up to 24 columns' };
  if (['docx','pptx','xlsx','odt','ods','odp'].includes(ext)) {
    const files = extract(bytes, name => ext === 'docx' ? name === 'word/document.xml' : ext === 'pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(name) : ext === 'xlsx' ? ['xl/sharedStrings.xml','xl/workbook.xml','xl/_rels/workbook.xml.rels'].includes(name) || /^xl\/worksheets\/sheet\d+\.xml$/.test(name) : name === 'content.xml');
    if (ext === 'xlsx') {
      const shared = xml(files['xl/sharedStrings.xml']);
      const strings = shared ? nodes(shared, 'si').map(item => nodes(item, 't').map(node => node.textContent).join('')) : [];
      const book = xml(files['xl/workbook.xml']); const rels = xml(files['xl/_rels/workbook.xml.rels']);
      const firstSheet = book && nodes(book, 'sheet')[0]; const relationship = firstSheet?.getAttribute('r:id');
      const target = rels && nodes(rels, 'Relationship').find(node => node.getAttribute('Id') === relationship)?.getAttribute('Target');
      const path = target ? target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}` : Object.keys(files).find(name => /^xl\/worksheets\//.test(name));
      const sheet = path && xml(files[path]);
      if (!sheet) throw new Error('No readable worksheet was found.');
      const rows = nodes(sheet, 'row').slice(0, 100).map(row => { const values: string[] = []; for (const cell of nodes(row, 'c')) { const letters = cell.getAttribute('r')?.match(/^[A-Z]+/)?.[0] || 'A'; const column = [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1; if (column >= 24) continue; const value = nodes(cell, 'v')[0]?.textContent || nodes(cell, 't')[0]?.textContent || ''; while (values.length <= column) values.push(''); values[column] = cell.getAttribute('t') === 's' ? strings[+value] || '' : value; } return values; });
      return { kind: 'table', rows, note: 'First worksheet · first 100 rows · cached values' };
    }
    const ordered = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const text = ordered.map(name => { const doc = xml(files[name]); if (!doc) return ''; const paragraphs = nodes(doc, 'p'); return (ext === 'pptx' ? `Slide ${name.match(/slide(\d+)/)?.[1]}\n` : '') + paragraphs.map(p => ext === 'docx' || ext === 'pptx' ? nodes(p, 't').map(t => t.textContent).join('') : p.textContent).join('\n'); }).join('\n\n');
    return { kind:'text', text: text.slice(0, 100000) || 'No readable text was found.', note: 'Text preview · original layout and formatting may differ' };
  }
  if (['text','code','mail','calendar','contact'].includes(info.kind)) { const text = new TextDecoder().decode(bytes.slice(0, 256 * 1024)); if (text.includes('\0')) throw new Error('This file contains binary data and cannot be shown as text.'); return { kind:'text', text, note: bytes.length > 256 * 1024 ? 'Showing the first 256 KB' : undefined }; }
  throw new Error('This format needs its original application. You can download the file to open it.');
}
