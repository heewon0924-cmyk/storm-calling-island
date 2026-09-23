/* data.js → data.json
 *
 * 01번 §16-F — 본편은 Godot 4 입니다. 규칙(game.js)은 다시 쓰지만
 * 내용(data.js)은 다시 쓰지 않습니다. 이 스크립트가 그 다리입니다.
 *
 *   node tools/data-to-json.js            → tools/data.json
 *   node tools/data-to-json.js <경로>      → 원하는 곳으로
 *
 * Godot 쪽에서는 JSON.parse_string() 으로 그대로 읽힙니다.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'prototype', 'data.js'), 'utf8');
const DATA = new Function(src + '; return DATA;')();

const out = process.argv[2] || path.join(__dirname, 'data.json');
fs.writeFileSync(out, JSON.stringify(DATA, null, 2), 'utf8');

const ch = DATA.chapters;
const n = (o) => Object.keys(o).length;
console.log('→ ' + out);
console.log('   사실 ' + n(DATA.facts) + ' · 인물 ' + n(DATA.characters) +
            ' · 장소 ' + (n(ch.case1.places) + n(ch.case2.places)) +
            ' · 행동 ' + (ch.case1.actions.length + ch.case2.actions.length) +
            ' · 대조 ' + (ch.case1.compares.length + ch.case2.compares.length));
console.log('   ' + (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
