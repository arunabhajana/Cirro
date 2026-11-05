import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import FileBrowser from '../src/FileBrowser';
import SidebarCustomizer from '../src/SidebarCustomizer';
import FileGlyph, { describeFile } from '../src/fileTypes';
import { archiveContents, delimitedRows, loadPreview } from '../src/preview';
import { defaultSidebar } from '../src/workspace';
import type { DriveFile } from '../src/data';
import FileInspector from '../src/FileInspector';
import QuickLook from '../src/QuickLook';

const file: DriveFile = { id:'file', name:'Readme.md', type:'text', account:'personal', color:'blue', size:'1 KB', modified:'Today' };
const folder: DriveFile = { ...file, id:'folder', name:'Research', type:'folder' };
const open = vi.fn();
beforeEach(() => { localStorage.clear(); open.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function browser() { return render(<FileBrowser items={[file,folder]} files={[file,folder]} page="My files" folder={null} query="" scope="all" canBack={false} canForward={false} back={() => {}} forward={() => {}} up={() => {}} onFolder={() => {}} onOpen={open} onContext={() => {}} onBulk={() => {}} onRename={() => {}} onCopy={() => {}} onPaste={() => {}} renderIcon={file => <FileGlyph file={file}/>}/>); }

describe('file browsing and pin customization', () => {
  it('single click inspects a name without opening, while double click opens', () => {
    browser(); fireEvent.click(screen.getByRole('button',{name:'Readme.md',exact:true}));
    expect(screen.getByRole('complementary',{name:'File inspector'})).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByRole('button',{name:'Readme.md',exact:true}));
    expect(open).toHaveBeenCalledExactlyOnceWith(file);
    fireEvent.click(screen.getByRole('button',{name:'Close file inspector'}));
    expect(screen.queryByRole('complementary',{name:'File inspector'})).toBeNull();
  });
  it('shows folder details on a click, opens with Enter, and supports grid inspection', () => {
    browser(); const name = screen.getByRole('button',{name:'Research',exact:true});
    fireEvent.click(name); expect(open).not.toHaveBeenCalled();
    fireEvent.keyDown(name.closest('tr')!,{key:'Enter'}); expect(open).toHaveBeenCalledWith(folder);
    fireEvent.click(screen.getByRole('button',{name:'Grid view'}));
    fireEvent.click(screen.getByRole('button',{name:'Readme.md',exact:true}));
    expect(within(screen.getByRole('complementary',{name:'File inspector'})).getByRole('heading',{name:'Readme.md'})).toBeTruthy();
  });
  it('checkbox selection stays separate from opening and has a partial page state', () => {
    browser(); fireEvent.click(screen.getByRole('checkbox',{name:'Select Readme.md'}));
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole('complementary',{name:'File inspector'})).toBeNull();
    expect((screen.getByRole('checkbox',{name:'Select this page'}) as HTMLInputElement).indeterminate).toBe(true);
    expect(screen.queryByRole('button',{name:'Pin to sidebar'})).toBeNull();
  });
  it('lists only pinned items and can reorder, sort and unpin them', () => {
    const setPins = vi.fn();
    render(<SidebarCustomizer preferences={defaultSidebar} onPreferences={() => {}} pins={['folder']} onPins={setPins} files={[file,folder]} initialTab="pins" onClose={() => {}}/>);
    expect(screen.getByText('Research',{exact:true})).toBeTruthy();
    expect(screen.queryByText('Readme.md',{exact:true})).toBeNull();
    expect(screen.queryByText('Add to sidebar')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Unpin Research from sidebar'})); expect(setPins).toHaveBeenCalledWith([]);
    expect(screen.getByRole('button',{name:'Sort pinned items by name'})).toBeTruthy();
  });
});

describe('file identification and local previews', () => {
  it.each([['backup.zip','archive'],['slides.pptx','slides'],['model.glb','model'],['settings.yaml','code'],['photo.heic','image'],['data.parquet','database'],['song.flac','audio'],['movie.mkv','video'],['unknown.weird','unknown']])('identifies %s as %s', (name,kind) => {
    expect(describeFile({...file,name}).kind).toBe(kind);
  });
  it('recognizes Google document MIME types and generic unknown files', () => {
    expect(describeFile({...file,name:'Quarterly plan',mimeType:'application/vnd.google-apps.presentation'}).kind).toBe('slides');
    expect(describeFile({...file,name:'Survey',mimeType:'application/vnd.google-apps.form'}).label).toBe('Google Form');
  });
  it('lists ZIP members without extracting their contents', () => {
    const bytes = zipSync({'docs/':new Uint8Array(), 'docs/notes.txt':strToU8('Actual note contents')});
    const entries=archiveContents(bytes); expect(entries.map(entry=>entry.name)).toEqual(['docs/','docs/notes.txt']); expect(entries[1].size).toBe(20);
    expect(() => archiveContents(strToU8('not a ZIP file'))).toThrow();
  });
  it('parses quoted CSV values, embedded newlines, and column limits', () => {
    expect(delimitedRows('Name,Notes\nMaya,"hello, world"\nArun,"two\nlines"')).toEqual([['Name','Notes'],['Maya','hello, world'],['Arun','two\nlines']]);
    expect(delimitedRows(Array.from({length:30},(_,i)=>String(i)).join(','))[0]).toHaveLength(24);
  });
  function content(bytes: Uint8Array) { vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>({size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})}))); }
  it('extracts real DOCX text without executing markup', async () => {
    content(zipSync({'word/document.xml':strToU8('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Project notes &lt;script&gt;</w:t></w:r></w:p></w:body></w:document>')}));
    const value=await loadPreview({...file,name:'Notes.docx',url:'blob:local'},new AbortController().signal);
    expect(value.kind).toBe('text'); expect('text' in value && value.text).toContain('Project notes <script>');
  });
  it('refuses oversized document expansion and nonlocal preview URLs', async () => {
    content(zipSync({'word/document.xml':new Uint8Array(2*1024*1024+1)}));
    await expect(loadPreview({...file,name:'large.docx',url:'blob:local'},new AbortController().signal)).rejects.toThrow('too large');
    await expect(loadPreview({...file,url:'https://untrusted.test/file'},new AbortController().signal)).rejects.toThrow('no local content');
  });
});

describe('details and modal preview separation', () => {
  it('never loads preview content in the details pane', () => {
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher);
    render(<FileInspector file={{...file,url:'blob:local'}} files={[file]} onClose={()=>{}} onOpen={()=>{}}/>);
    expect(screen.getByRole('heading',{name:'Information'})).toBeTruthy();
    expect(screen.queryByRole('heading',{name:'Quick preview'})).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('shows information when sample content is unavailable', async () => {
    render(<QuickLook file={file} files={[file]} onClose={()=>{}}/>);
    expect(await screen.findByRole('heading',{name:'No preview available'})).toBeTruthy();
    expect(screen.getByText('Kind',{exact:true})).toBeTruthy();
    expect(screen.getByText('1 KB',{exact:true})).toBeTruthy();
  });
  it('shows only preview content when text can be previewed', async () => {
    const bytes=strToU8('Preview of the actual document');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>({size:bytes.length,arrayBuffer:async()=>bytes.buffer})})));
    render(<QuickLook file={{...file,url:'blob:local'}} files={[file]} onClose={()=>{}}/>);
    expect(await screen.findByText('Preview of the actual document')).toBeTruthy();
    expect(screen.queryByText('Kind',{exact:true})).toBeNull();
    expect(screen.queryByRole('heading',{name:'Information'})).toBeNull();
  });
  it('switches to information after an image cannot be rendered', async () => {
    render(<QuickLook file={{...file,name:'Photo.heic',type:'image',url:'blob:local'}} files={[file]} onClose={()=>{}}/>);
    fireEvent.error(screen.getByRole('img',{name:'Photo.heic'}));
    expect(await screen.findByRole('heading',{name:'No preview available'})).toBeTruthy();
    expect(screen.getByText('Kind',{exact:true})).toBeTruthy();
  });
});
