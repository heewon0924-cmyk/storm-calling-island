/* 「폭풍을 부르는 섬 이야기」 프로토타입 — 규칙
 *
 * 이 파일은 화면을 모릅니다. document 도 window 도 localStorage 도 여기 없습니다.
 * 규칙은 「일어난 일」을 사건 목록으로 돌려주고, 그리는 일은 ui.js 가 합니다.
 * 콘텐츠는 data.js 에만 있습니다.
 *
 * 01번 §16-F — 나중에 Godot 으로 옮길 때, 옮겨지는 쪽이 이 파일입니다.
 * 사건의 종류:
 *   { k:'who',   char }              누구로 보는 밤인지
 *   { k:'act',   verb, label, free } 행동 머리줄
 *   { k:'text',  text, cls }         서사 본문 (마크다운은 그리는 쪽이 푼다)
 *   { k:'fact',  id }                수첩에 한 줄 늘었다
 *   { k:'reply' }                    지연 회신이 도착했다
 *   { k:'end' }                      회차가 끝났다
 */
var RULES = (function () {
'use strict';

/* ── 바깥이 채워주는 것 ─────────────────────────────
 * 저장소는 플랫폼마다 다릅니다 (웹은 localStorage, Godot 은 FileAccess).
 * 규칙은 「읽고 쓸 수 있다」는 것만 알면 됩니다. */
let io = { read: function () { return null; }, write: function () {} };
function setIO(x) { io = x; reload(); }

/* ── 저장 (회차 누적) ─────────────────────────────── */
let save = { seen: [], runs: [] };
function reload() { save = io.read() || { seen: [], runs: [] }; }
function persist() { io.write(save); }

/* ── 회차 상태 ─────────────────────────────────────── */
let run = null;
let CH = null;      // 지금 보고 있는 챕터
let carried = [];   // CASE 1 에서 섬으로 들고 가는 것
let runNo = 0;      // 회차는 배에서 시작한다. 섬은 같은 회차의 뒷장이다 — 01번 §16

/* ── 사건 모으기 ───────────────────────────────────── */
let out = [];
function emit(e) { out.push(e); return e; }
function flush() { const o = out; out = []; return o; }
function say(text, cls) { emit({ k: 'text', text: text, cls: cls }); }
function sayAct(verb, label, free) { emit({ k: 'act', verb: verb, label: label, free: !!free }); }

function newRun(charId, chapterId, carry) {
  if (chapterId === 'case1') runNo = save.runs.length + 1;
  CH = DATA.chapters[chapterId];
  run = {
    char: charId,
    chapter: chapterId,
    left: (CH.budget && CH.budget.actions) || DATA.budget.actions,
    clock: (CH.budget && CH.budget.startClock) || DATA.budget.startClock,
    place: CH.from,
    facts: new Set(),
    stage: {},       // npcId -> 진행 단계
    done: new Set(), // 1회성 행동 id
    spoke: new Set(),// 말을 건 사람 — 위험 교환이 읽는다
    pending: [],     // 지연 회신
    over: false,
  };
  Object.keys(CH.dialogue).forEach((k) => { run.stage[k] = 0; });
  (carry || []).forEach((id) => run.facts.add(id));   // 앞 챕터에서 들고 온 것
  // 처음부터 손에 쥐고 있는 것 (엘레나의 부재중 전화 등)
  (CH.startFacts[charId] || []).forEach((id) => {
    run.facts.add(id);
    if (save.seen.indexOf(id) === -1) save.seen.push(id);
  });
  persist();
}

/* ── 유틸 ──────────────────────────────────────────── */
const clockStr = (m) => {
  const t = m % (24 * 60);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
const has = (f) => run.facts.has(f);
/* 받침 유무로 을/를 */
function objp(name) {
  const c = name.charCodeAt(name.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return '을(를)';
  return (c - 0xac00) % 28 ? '을' : '를';
}
const canChar = (who) => !who || who.length === 0 || who.indexOf(run.char) !== -1;

/* 07번 §6-C ⑦ — 이 회차의 내가 내놓을 수 있는 「거짓말」과 그 값 */
function ownLieItem() {
  return (CH.presentItems || []).filter((it) => it.own && canChar(it.who))[0] || null;
}
function ownLieFact() {
  const it = ownLieItem();
  if (!it) return null;
  let c = (CH.presentCost || {})[it.id];
  if (c && typeof c === 'object') c = canChar(c.who) ? c.fact : null;
  return c || null;
}
function toldOwn() { return (DATA.ownLieFacts || []).some(has); }

function gain(ids) {
  (ids || []).forEach((id) => {
    if (run.facts.has(id)) return;
    run.facts.add(id);
    if (save.seen.indexOf(id) === -1) save.seen.push(id);
    emit({ k: 'fact', id: id, t: DATA.facts[id].t, d: DATA.facts[id].d });
  });
  persist();
}

/* ── 행동 소모 ─────────────────────────────────────── */
function spend() {
  run.left--;
  run.clock += (CH.budget && CH.budget.minutesPerAction) || DATA.budget.minutesPerAction;
  // 지연 회신 도착
  run.pending = run.pending.filter((p) => {
    p.in--;
    if (p.in <= 0) {
      emit({ k: 'reply' });
      say(p.act.onArrive.text, 'arrive');
      gain(p.act.onArrive.gives);
      return false;
    }
    return true;
  });
  if (run.left <= 0) { run.over = true; emit({ k: 'end' }); }
}

/* ── 행동 실행 ─────────────────────────────────────── */
/* 위험 교환이 터지는가 — 조건은 챕터마다 다르다 (12번 §5 5차·11차)
 *   seenBy : 그 사람에게 말을 건 적이 있으면 터진다 (배)
 *   flagIf : 앞 챕터의 플래그가 맞을 때만 위험하다  (섬)
 *   unless : 이것을 알고 있으면 안전하다            (섬) */
function riskFires(r) {
  if (!r) return false;
  if (r.unless && r.unless.some(has)) return false;
  if (r.flagIf && !flagOk(r.flagIf)) return false;
  if (r.seenBy && !run.spoke.has(r.seenBy)) return false;
  return true;
}

function doAction(actId) {
  const act = CH.actions.filter((a) => a.id === actId)[0];
  sayAct(act.verb, '— ' + act.label);
  const risk = riskFires(act.risk) ? act.risk : null;
  say((risk || act).text);
  if (act.delay) run.pending.push({ act: act, in: act.delay });
  else gain((risk || act).gives);
  if (!act.repeat) run.done.add(act.id);
  spend();
  return flush();
}

function question(npcId) {
  const stages = CH.dialogue[npcId];
  let i = run.stage[npcId];
  let st = stages[Math.min(i, stages.length - 1)];
  const p = CH.people[npcId];
  run.spoke.add(npcId);
  sayAct('질문', '— ' + p.name);

  const needOk = !st.need || (st.anyNeed ? st.need.some(has) : st.need.every(has));
  if (st.present || !needOk) {
    say(CH.stalls[npcId] || '(더 나오지 않는다.)');
  } else {
    say(st.text);
    gain(st.gives);
    if (!st.repeat) run.stage[npcId] = Math.min(i + 1, stages.length - 1);
  }
  spend();
  return flush();
}

function present(npcId, factId) {
  const stages = CH.dialogue[npcId];
  const i = run.stage[npcId];
  const st = stages[Math.min(i, stages.length - 1)];
  const p = CH.people[npcId];
  run.spoke.add(npcId);
  const item = (CH.presentItems || []).filter((it) => it.id === factId)[0];
  const own = !!(item && item.own);
  const label = item ? item.t : DATA.facts[factId].t;
  sayAct('제시', '— ' + p.name + '에게 「' + label + '」');

  // 단계와 무관한 특수 반응 (열리지 않는 문에도 반응은 있다)
  const sp = (CH.presentSpecial || {})[npcId];
  const special = sp && sp[factId];

  if (special && !run.done.has('sp_' + npcId + '_' + factId)) {
    say(special.text);
    gain(special.gives);
    run.done.add('sp_' + npcId + '_' + factId);
  } else if (own && st.ownText) {
    // 누가 먼저 말하면 열리는 단계가 있다 — 증거가 아니라 순서로 여는 문.
    // 말로 연 문은 말까지만 여는 경우가 있다 (ownGives).
    say(st.ownText);
    gain(st.ownGives || st.gives);
    run.stage[npcId] = Math.min(i + 1, stages.length - 1);
  } else if (st.present && st.present.indexOf(factId) !== -1) {
    say((st.altText && st.altText[factId]) || st.text);
    gain(st.gives);
    run.stage[npcId] = Math.min(i + 1, stages.length - 1);
  } else if (own) {
    // 아무것도 열지 못해도 말한 것은 돌아오지 않는다
    say(item.miss || '그 사람은 듣는다. 그리고 아무 말도 하지 않는다.');
  } else {
    say('그는 그것을 본다. 그리고 아무 말도 하지 않는다.\n\n*(지금 이 사람에게 이것은 아무것도 열지 못한다.)*');
  }

  // 무언가를 내보이는 데에는 대가가 있다
  // 대가는 인물별로 다를 수 있다 — 내놓는 것이 자기 것인 사람에게만 값이 붙는다
  let cost = (CH.presentCost || {})[factId];
  if (cost && typeof cost === 'object') cost = canChar(cost.who) ? cost.fact : null;
  if (cost) gain([cost]);

  spend();
  return flush();
}

function compare(c) {
  sayAct('대조', '— ' + c.label, true);
  say(c.text);
  gain(c.gives);
  run.done.add(c.id);
}

/* 안에서 부르는 쪽은 사건을 쌓기만 한다 — 비우는 것은 바깥에서 부른 쪽 하나뿐이다.
 * (begin 이 move 를 부르는데 move 가 비워버려서 첫 장면이 통째로 사라졌던 적이 있다) */
function moveTo(id) {
  run.place = id;
  const pl = CH.places[id];
  sayAct('이동', '— ' + pl.name, true);
  say(pl.desc);
}
function move(id) { moveTo(id); return flush(); }

/* ── 선택지 ────────────────────────────────────────── */
function actionsHere() {
  return CH.actions.filter((a) =>
    a.at === run.place && canChar(a.who) && !run.done.has(a.id) &&
    (!a.need || a.need.every(has)) && flagOk(a.flagIf, a.flagNot)
  );
}
function availableActions() {
  return actionsHere().map((a) => ({ id: a.id, verb: a.verb, label: a.label }));
}
/* 앞 챕터에서 한 일이 이 챕터의 선택지를 바꾼다 — 09번 §5 */
function lastFlags() { return save.runs[save.runs.length - 1] || null; }
function flagOk(yes, no) {
  if (!yes && !no) return true;
  const f = lastFlags(); if (!f) return false;
  const test = (o) => Object.keys(o).every((k) =>
    Array.isArray(o[k]) ? o[k].indexOf(f[k]) !== -1 : f[k] === o[k]);
  return (!yes || test(yes)) && (!no || !test(no));
}

function availableCompares() {
  return CH.compares.filter((c) => !run.done.has(c.id) && c.need.every(has));
}

/* ── 대조판 ── 01번 §16-D
 * 판에 올릴 수 있는 것은 수첩 전체가 아니라 대조가 요구하는 줄 중 지금 아는 것이다.
 * 한 회차에 7~9장이므로 플레이어가 직접 집을 수 있다. */
function boardItems() {
  const s = new Set();
  (CH.compares || []).forEach((c) => c.need.forEach((n) => s.add(n)));
  return Array.from(s).filter(has).map((id) => ({ id: id, t: DATA.facts[id].t }));
}

function tryCompare(ids) {
  const set = new Set(ids);
  const hit = (CH.compares || []).filter((c) =>
    !run.done.has(c.id) && c.need.length === set.size && c.need.every((n) => set.has(n)))[0];
  if (hit) { compare(hit); return flush(); }
  // 이어지지 않아도 값은 없다 — 06번 §3. 대신 그 사람이 일하는 방식이 나온다.
  const t = ids.map((id) => DATA.facts[id].t);
  const tpl = (DATA.compareMiss || {})[run.char] || '*(이어지지 않는다.)*';
  sayAct('대조', '— 맞춰본다', true);
  say(tpl.replace('{a}', t[0]).replace('{b}', t.slice(1).join('」 그리고 「')));
  return flush();
}

/* 지금 이 사람에게 보여줄 수 있는 것 */
function presentables() {
  const items = [];
  (CH.presentItems || []).forEach((it) => {
    if (it.who && it.who.indexOf(run.char) === -1) return;
    if (it.need && !it.need.every(has)) return;
    items.push({ id: it.id, t: it.t });
  });
  run.facts.forEach((id) => items.push({ id: id, t: DATA.facts[id].t }));
  return items;
}

/* 지금 여기 있는 사람 — 나 자신은 심문하지 않는다 */
function peopleHere() {
  return Object.keys(CH.people)
    .filter((id) => id !== run.char && CH.people[id].at === run.place)
    .map((id) => ({ id: id, name: CH.people[id].name, job: CH.people[id].job }));
}

function places() {
  return Object.keys(CH.places).map((id) => ({
    id: id, name: CH.places[id].name, here: id === run.place,
  }));
}

/* 수첩 — 쌓인 것 전부. 이 회차의 내가 모르는 줄은 잠겨 있다. */
function notebook() {
  const all = save.seen.slice();
  run.facts.forEach((f) => { if (all.indexOf(f) === -1) all.push(f); });
  return all.map((id) => {
    const f = DATA.facts[id];
    if (!f) return null;
    return { id: id, t: f.t, d: f.d, key: !!f.key, hook: !!f.hook, known: run.facts.has(id) };
  }).filter(Boolean);
}

/* ── 지금 상태 ─────────────────────────────────────── */
function state() {
  return {
    char: run.char, charName: DATA.characters[run.char].name,
    chapter: run.chapter, chapterTitle: CH.title, runNo: runNo,
    place: run.place, placeName: CH.places[run.place].name,
    left: run.left, clock: clockStr(run.clock), over: run.over,
    factCount: run.facts.size, seenCount: save.seen.length,
    judges: CH.judge !== false,
  };
}

function needList(n) { return Array.isArray(n) ? n : [n]; }

/* 깊은 회차인가 — 두 챕터가 같은 규칙을 쓴다 */
function isDeep() {
  if (((CH.deepNot || {})[run.char] || []).some(has)) return false;
  const rule = (CH.deepIf || {})[run.char];
  return rule ? rule.every(has) : (DATA.deepFacts || []).some(has);
}

function openHooks() {
  return Array.from(run.facts)
    .filter((id) => DATA.facts[id] && DATA.facts[id].hook)
    .map((id) => DATA.facts[id].t);
}

function endnotes() {
  return (CH.endnotes || [])
    .filter((n) => needList(n.need).every(has) && !(n.not && has(n.not)))
    .map((n) => n.text);
}

function restCharacters() {
  const used = new Set(save.runs.map((r) => r.char));
  return Object.keys(DATA.characters).filter((c) => !used.has(c))
    .map((c) => DATA.characters[c].name);
}

/* ── 판단 화면이 필요로 하는 것 ─────────────────────── */
function judgeData() {
  const ids = [];
  Object.keys(CH.people).concat(Object.keys(DATA.characters)).forEach((id) => {
    if (id !== run.char && ids.indexOf(id) === -1) ids.push(id);
  });
  const nameOf = (id) => (CH.people[id] || DATA.characters[id]).name;
  const item = ownLieItem();
  return {
    clock: clockStr(run.clock),
    accuse: [{ id: 'none', name: '모르겠다' }]
      .concat(ids.map((id) => ({ id: id, name: nameOf(id) }))),
    disposals: DATA.disposals.map((d) => ({ id: d.id, label: d.label, d: d.d })),
    // 07번 §6-C 「자신이 숨긴 것을 스스로 밝힐 것인가」
    own: !item ? { kind: 'none' }
       : toldOwn() ? { kind: 'told', t: item.t.replace(/^— /, '') }
       : { kind: 'offer', t: item.t.replace(/^— /, '') },
  };
}

function submitJudgement(accuse, disposal, tell) {
  // 배에서 말하지 않았다면 여기서 마지막으로 한 번 더 기회가 있다
  if (tell && !toldOwn()) {
    const f = ownLieFact();
    if (f) { run.facts.add(f); if (save.seen.indexOf(f) === -1) save.seen.push(f); }
  }
  // 캐릭터가 자기 기준을 가지면 그것을 쓴다 (전부 충족), 없으면 공통 기준 (하나라도)
  const deep = isDeep();
  const rec = {
    char: run.char, accuse: accuse, disposal: disposal,
    henryLine: has('f_henry_line'), match: has('f_match'),
    wary: has('f_caught'),
    // 09번 §5 ⑦ : 자기 거짓말을 스스로 밝혔는가
    told: toldOwn(),
    // 09번 §5 ③ : 처분이 정하는 것은 결국 이것 하나다
    michaelFree: !(accuse === 'michael' && disposal === 'isolate'),
    facts: run.facts.size, deep: deep,
  };
  save.runs.push(rec);
  persist();

  carried = Array.from(run.facts);   // 섬으로 들고 간다

  const who = accuse === 'none' ? null : (CH.people[accuse] || DATA.characters[accuse]).name;
  const dl = DATA.disposals.filter((d) => d.id === disposal)[0];
  return {
    line: '**' + (who ? who + objp(who) + ' 지목했다' : '아무도 지목하지 않았다') + '.** ' +
          (accuse === 'none' ? '아무도 격리되지 않은 채 섬에 도착한다.' : dl.label + '.'),
    // 발견한 순서대로 — 마지막에 알아챈 것이 마지막에 남는다
    notes: endnotes(),
    hooks: openHooks(),
    runs: save.runs.length, facts: run.facts.size, seen: save.seen.length,
    rest: restCharacters(),
  };
}

/* ── 시작 화면이 필요로 하는 것 ─────────────────────── */
function startData() {
  const used = new Set(save.runs.map((r) => r.char));
  return {
    characters: Object.keys(DATA.characters).map((id) => {
      const c = DATA.characters[id];
      return { id: id, name: c.name, job: c.job, blurb: c.blurb, secret: c.secret, played: used.has(id) };
    }),
    seen: save.seen.length,
  };
}

function begin(id, chapterId, carry) {
  newRun(id, chapterId || 'case1', carry);
  emit({ k: 'who', name: DATA.characters[id].name, job: DATA.characters[id].job });
  say(CH.openings[id]);
  say(CH.open.replace('{n}', run.left));
  moveTo(CH.from);
  return flush();
}

function toCase2() { return begin(run.char, 'case2', carried); }

function wipe() { save = { seen: [], runs: [] }; persist(); }

/* ── CASE 2 — 플래그를 읽는다 ── 09번 §5·§6 ──────────
 * 챕터 본편은 없다. 여기 있는 것은 플래그가 섬을 바꾸는 부분뿐이다. */
function flagMatch(cond, f) {
  return Object.keys(cond || {}).every((k) => f[k] === cond[k]);
}
function firstMatch(list, f) {
  for (let i = 0; i < list.length; i++) if (flagMatch(list[i].if || list[i].when, f)) return list[i];
  return null;
}
// wary 가 붙은 항목은 ⑥이 켜진 회차에만 뒷문장이 따라온다
function withWary(entry, f) {
  return entry.text + (f.wary && entry.wary ? entry.wary : '');
}

function islandData() {
  const c2 = DATA.island;
  const f = save.runs[save.runs.length - 1];
  const sections = [];
  c2.reads.forEach((r) => {
    const hit = firstMatch(r.when, f);
    if (!hit || !hit.text) return;
    sections.push({ title: r.title, text: withWary(hit, f) });
  });
  return {
    arrive: c2.arrive,
    byChar: c2.byChar[f.char] || '',
    arthur: c2.arthur,
    sections: sections,
  };
}

/* ── 섬이 끝난다 ── 09번 §6 결말 4종 ─────────────── */
function finalData() {
  const c2 = DATA.island;
  const f = save.runs[save.runs.length - 1];
  const deep = isDeep();
  const end = firstMatch(c2.endings, f);
  // ④+⑤ 는 회차를 넘어 누적된다 — 09번 §6 D
  const held = c2.truth.need.every((k) => save.runs.some((r) => r[k]));

  f.islandFacts = run.facts.size;
  f.islandDeep = deep;
  persist();

  return {
    end: { label: end.label, text: withWary(end, f) },
    truth: held
      ? { held: true, label: c2.truth.label, text: c2.truth.text, after: c2.truth.after || '' }
      : { held: false, text: c2.locked },
    mono: CH.monologue[run.char][deep ? 'deep' : 'shallow'],
    notes: endnotes(),
    hooks: openHooks(),
    runs: save.runs.length, facts: run.facts.size, seen: save.seen.length,
    rest: restCharacters(),
  };
}

return {
  setIO: setIO,
  begin: begin, toCase2: toCase2, wipe: wipe,
  state: state, startData: startData,
  places: places, move: move,
  availableActions: availableActions, doAction: doAction,
  peopleHere: peopleHere, question: question,
  presentables: presentables, present: present,
  boardItems: boardItems, tryCompare: tryCompare, availableCompares: availableCompares,
  notebook: notebook,
  judgeData: judgeData, submitJudgement: submitJudgement,
  islandData: islandData, finalData: finalData,
  // 재보는 쪽이 들여다보는 창 — 규칙을 바꾸지는 못한다
  clockStr: clockStr, isDeep: isDeep, openHooks: openHooks,
};
})();
