// Writes storyboard/STORYBOARD.md from the shot list: the script and the storyboard in one table.
//   npm run storyboard
import { writeFileSync } from 'node:fs';
import { SHOTS } from '../storyboard/shots';
import { duration, words } from '../storyboard/types';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const out: string[] = ['# Storyboard and script', '', 'Generated from `storyboard/shots.ts` by `npm run storyboard`. Edit the shot list, not this file.', ''];
let t = 0;
let total = 0;
let section = '';
const json: unknown[] = [];
for (const shot of SHOTS) {
  if (shot.section !== section) {
    section = shot.section;
    out.push('', `## ${section} (from ${clock(t)})`, '', '| Shot | At | Secs | Narration | On screen | Tag |', '|---|---|---|---|---|---|');
  }
  const d = duration(shot);
  const tag = shot.tag ? (Array.isArray(shot.tag) ? shot.tag.join(', ') : shot.tag) : '';
  out.push(`| ${shot.id} | ${clock(t)} | ${d} | ${shot.vo} | ${shot.onScreen} | ${tag} |`);
  json.push({ id: shot.id, section, at: clock(t), seconds: d, vo: shot.vo, onScreen: shot.onScreen, tag, kind: shot.kind });
  t += d;
  total += words(shot.vo);
}
out.push('', `Total: ${SHOTS.length} shots, ${clock(t)} of footage, ${total} words of narration.`, '');
writeFileSync('storyboard/STORYBOARD.md', out.join('\n'));
writeFileSync('out/storyboard.json', JSON.stringify(json, null, 1));
console.log(`${SHOTS.length} shots, ${clock(t)}, ${total} words`);
