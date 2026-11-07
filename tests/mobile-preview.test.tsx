import {afterEach,expect,it,vi} from 'vitest';
import {boundedBlob,MAX_PREVIEW_BYTES,previewContent} from '../src/platforms/android/preview/content';
vi.mock('../src/platforms/android/auth/nativeGoogle',()=>({driveAccessToken:vi.fn(),forgetDriveToken:vi.fn(),DriveConsentRequired:class extends Error{}}));
vi.mock('../src/platforms/android/offline/native',()=>({offlinePreview:vi.fn()}));
afterEach(()=>vi.restoreAllMocks());
it('rejects oversized declared content before reading its body',async()=>{const cancel=vi.fn();const response={ok:true,headers:new Headers({'Content-Length':String(MAX_PREVIEW_BYTES+1)}),body:{cancel}} as unknown as Response;await expect(boundedBlob(response,new AbortController().signal)).rejects.toThrow('32 MB');expect(cancel).toHaveBeenCalledOnce();});
it('enforces the byte limit even when Content-Length is missing',async()=>{let sent=0;const cancel=vi.fn();const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024));sent++;},cancel});await expect(boundedBlob(new Response(stream),new AbortController().signal)).rejects.toThrow('32 MB');expect(sent).toBeLessThanOrEqual(34);expect(cancel).toHaveBeenCalledOnce();});
it('returns bounded content and respects cancellation',async()=>{const result=await boundedBlob(new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}}),new AbortController().signal);expect(result.size).toBe(3);expect(result.type).toBe('image/png');const controller=new AbortController();controller.abort();await expect(boundedBlob(new Response('hello'),controller.signal)).rejects.toMatchObject({name:'AbortError'});});
it('rejects large metadata before requesting authentication or content',async()=>{const fetch=vi.spyOn(globalThis,'fetch');await expect(previewContent({id:'a',account:'a',name:'big.pdf',type:'pdf',size:'40 MB',byteSize:MAX_PREVIEW_BYTES+1,color:'blue',remote:true},new AbortController().signal)).rejects.toThrow('32 MB');expect(fetch).not.toHaveBeenCalled();});

it('reuses a bounded account-scoped preview and invalidates it on modification or logout',async()=>{
 const {clearPreviewCache}=await import('../src/platforms/android/preview/content');clearPreviewCache();
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:preview'),revokeObjectURL:vi.fn()}));
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png','Content-Length':'3'}}));
 const file={id:'a:f',account:'a',name:'small.png',type:'image' as const,size:'3 B',byteSize:3,color:'blue',remote:true,modified:'v1'};
 const first=await previewContent(file,new AbortController().signal);first.release();const second=await previewContent(file,new AbortController().signal);second.release();expect(fetcher).toHaveBeenCalledTimes(1);
 const newer=await previewContent({...file,modified:'v2'},new AbortController().signal);newer.release();expect(fetcher).toHaveBeenCalledTimes(2);
 const other=await previewContent({...file,account:'b'},new AbortController().signal);other.release();expect(fetcher).toHaveBeenCalledTimes(3);
 clearPreviewCache();const after=await previewContent(file,new AbortController().signal);after.release();expect(fetcher).toHaveBeenCalledTimes(4);clearPreviewCache();
});
