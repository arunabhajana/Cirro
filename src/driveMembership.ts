type FileNode={id:unknown;parents?:unknown;mimeType?:unknown;driveId?:unknown};
// Listing accessible files is broader than membership in My Drive. Require a
// complete parent chain ending at this account's actual root; never promote orphans.
export function myDriveMembers(files:FileNode[],root:string):Set<string>{
 const children=new Map<string,FileNode[]>();for(const file of files){if(file.driveId||!Array.isArray(file.parents))continue;for(const parent of file.parents)if(typeof parent==='string'){const list=children.get(parent)||[];list.push(file);children.set(parent,list);}}
 const result=new Set<string>();const queue=[root];const seen=new Set<string>();while(queue.length){const parent=queue.pop()!;if(seen.has(parent))continue;seen.add(parent);for(const file of children.get(parent)||[]){if(typeof file.id!=='string')continue;result.add(file.id);if(file.mimeType==='application/vnd.google-apps.folder')queue.push(file.id);}}
 return result;
}
