import fs from 'node:fs';
import assert from 'node:assert/strict';
const s=fs.readFileSync(new URL('../sidecar.ps1',import.meta.url),'utf8');
const bubble=s.slice(s.indexOf('public static class DshBubble'),s.indexOf('public static class DshEye'));
assert.ok(bubble.includes('DshOverlay.OnUi('),'bubble must be created on overlay UI thread');
assert.ok(!bubble.includes('readonly System.Windows.Forms.Timer follow'),'no independent follow timer');
assert.ok(s.includes('DshBubble.FollowAll();'),'actual bounds publication must synchronously move bubbles');
console.log('sync contract: 3 passed');
