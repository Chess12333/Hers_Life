import fs from 'node:fs';
for(const label of ['current','batch']){
 const d=JSON.parse(fs.readFileSync(new URL(`live-duration-${label}.json`,import.meta.url),'utf8').replace(/^\uFEFF/,''));
 const phases={}, first=[], seen=new Set(), runs=[];let run=null,previous=null;
 for(const s of d.samples){
 if(!s.stable)continue;let bad=0,total=0;
 for(const w of s.windows){if(w.w!==245||w.h!==58)continue;total++;const c=s.cursorBefore;const dx=w.x-(c.x+Math.trunc((c.w-w.w)/2)),dy=w.y-(c.y-w.h-18);if(dx||dy)bad++;
 if(!seen.has(w.hwnd)){seen.add(w.hwnd);first.push({ms:s.ms,phase:s.phase,dx,dy});}}
 const p=phases[s.phase]??={samples:0,bubbles:0,bad:0};p.samples++;p.bubbles+=total;p.bad+=bad;
 if(bad){if(!run)run={start:s.ms,last:s.ms,previousGood:previous?.ms,count:0};run.last=s.ms;run.count++;}
 else if(run){runs.push({...run,nextGood:s.ms,observedSpan:run.last-run.start,bracketMs:s.ms-run.previousGood});run=null;}
 previous=s;
 }
 if(run)runs.push(run);
 console.log(JSON.stringify({label,pid:d.pid,foregroundUnchanged:d.foregroundBefore===d.foregroundAfter,phases,first,runs}));
}
