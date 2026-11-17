import fs from 'node:fs';
import assert from 'node:assert/strict';
const s=fs.readFileSync(new URL('../sidecar.ps1',import.meta.url),'utf8');
assert.match(s,/public static bool MoveTogether/,'cursor and bubbles use a single placement transaction');
assert.match(s,/if \(batch == IntPtr.Zero\) return false/,'failed HDWP never reused');
assert.match(s,/EndDeferWindowPos\(batch\)/);
assert.doesNotMatch(s,/Location = new Point\((?:x, y|nx, ny|lastX, lastY)\)/,'no pre-batch cursor move');
assert.doesNotMatch(s,/DshBubble.FollowAll\(\)/,'no post-cursor individual bubble move');
console.log('PASS batch placement contract');
