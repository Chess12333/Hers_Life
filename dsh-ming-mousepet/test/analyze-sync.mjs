import fs from 'node:fs';
for(const name of ['live-bracket-before.json','live-accept-result.json']) {
const d=JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8').replace(/^\uFEFF/,''));let count=0,bad=[],stable=0;
for(const s of d.samples){if(!s.stable)continue;stable++;const c=s.cursorBefore;for(const w of s.windows){if(w.hwnd===d.finalDebug.hwnd||w.w!==245||w.h!==58)continue;count++;const dx=w.x-(c.x+Math.trunc((c.w-w.w)/2));const dy=w.y-(c.y-w.h-18);if(dx||dy)bad.push({phase:s.phase,ms:s.ms,dx,dy});}}
console.log(JSON.stringify({name,pid:d.pid,samples:d.samples.length,stable,matchedBubbles:count,badCount:bad.length,worst:bad.sort((a,b)=>Math.abs(b.dx)+Math.abs(b.dy)-Math.abs(a.dx)-Math.abs(a.dy)).slice(0,3),foregroundUnchanged:d.foregroundBefore===d.foregroundAfter}));}
