import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadReleaseNotes,renderReleaseNotes} from './release-notes.mjs';
test('the first release has complete categorized notes shared by the app and GitHub',()=>{
 const release=loadReleaseNotes('1.0.0');const markdown=renderReleaseNotes(release);
 assert.equal(release.version,'1.0.0');
 for(const title of ['Added','Improved','Fixed','Security & privacy','Limitations'])assert.ok(markdown.includes(`## ${title}`));
 for(const feature of ['five Google accounts','Cirro Flow','Cirro Cloud','Offline files','Windows Hello','horizontal breakdown','Verified application updates'])assert.ok(markdown.includes(feature),feature);
 assert.ok(!markdown.includes('What’s new'));assert.ok(!markdown.includes('<img'));
});
test('release preparation refuses missing notes and path-shaped versions',()=>{
 assert.throws(()=>loadReleaseNotes('999.999.999'),/before tagging/);
 assert.throws(()=>loadReleaseNotes('../1.0.0'),/stable version/);
});
