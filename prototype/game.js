/* 「폭풍을 부르는 섬 이야기」 1차 프로토타입 — 엔진
 * 콘텐츠는 data.js에만 있습니다. 이 파일은 규칙만 압니다.
 */
(function () {
'use strict';

const SAVE_KEY = 'sci_proto_v1';
const $ = (s) => document.querySelector(s);

/* ── 저장 (회차 누적) ─────────────────────────────── */
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || { seen: [], runs: [] }; }
  catch (e) { return { seen: [], runs: [] }; }
}
function writeSave(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {}
}
let save = loadSave();

/* ── 회차 상태 ─────────────────────────────────────── */
let run = null;
let CH = null;      // 지금 보고 있는 챕터
let carried = [];   // CASE 1 에서 섬으로 들고 가는 것

function newRun(charId, chapterId, carry) {
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
  writeSave(save);
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

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => s
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>');

/* 인용(>)은 문단 단위로 처리한 뒤 이스케이프한다 */
function md(s) {
  return s.split('\n\n').map((b) => {
    if (b.indexOf('> ') === 0)
      return '<blockquote>' + inline(esc(b.replace(/^> ?/gm, ''))).replace(/\n/g, '<br>') + '</blockquote>';
    return '<p>' + inline(esc(b)).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function push(node, cls) {
  const box = $('#log');
  const d = document.createElement('div');
  d.className = 'entry' + (cls ? ' ' + cls : '');
  if (typeof node === 'string') d.innerHTML = node; else d.appendChild(node);
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  return d;
}

/* 서사 본문 */
function say(text, cls) { push(md(text), cls); }

/* 행동 머리줄 — 동사와 대상은 데이터에서 오므로 이스케이프한다 */
function sayAct(verb, label, free) {
  push('<span class="verb">' + esc(verb) + '</span> ' + esc(label) +
       (free ? ' <span class="free">무료</span>' : ''), 'act');
}

/* 수첩 획득 알림 */
function sayFact(f) {
  push('<span class="tag">수첩</span> <b>' + inline(esc(f.t)) + '</b>' +
       '<br><span class="dim">' + inline(esc(f.d)) + '</span>', 'got');
}

function gain(ids) {
  (ids || []).forEach((id) => {
    if (run.facts.has(id)) return;
    run.facts.add(id);
    if (save.seen.indexOf(id) === -1) save.seen.push(id);
    sayFact(DATA.facts[id]);
  });
  writeSave(save);
}

/* ── 행동 소모 ─────────────────────────────────────── */
function spend() {
  run.left--;
  run.clock += (CH.budget && CH.budget.minutesPerAction) || DATA.budget.minutesPerAction;
  // 지연 회신 도착
  run.pending = run.pending.filter((p) => {
    p.in--;
    if (p.in <= 0) {
      push('<span class="tag">회신</span>', 'arrive');
      say(p.act.onArrive.text, 'arrive');
      gain(p.act.onArrive.gives);
      return false;
    }
    return true;
  });
  if (run.left <= 0) endRun();
  render();
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

function doAction(act) {
  sayAct(act.verb, '— ' + act.label);
  const risk = riskFires(act.risk) ? act.risk : null;
  say((risk || act).text);
  if (act.delay) run.pending.push({ act: act, in: act.delay });
  else gain((risk || act).gives);
  if (!act.repeat) run.done.add(act.id);
  spend();
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
}

function present(npcId, factId) {
  const stages = CH.dialogue[npcId];
  const i = run.stage[npcId];
  const st = stages[Math.min(i, stages.length - 1)];
  const p = CH.people[npcId];
  run.spoke.add(npcId);
  const item = (CH.presentItems || []).filter((it) => it.id === factId)[0];
  const label = item ? item.t : DATA.facts[factId].t;
  sayAct('제시', '— ' + p.name + '에게 「' + label + '」');

  // 단계와 무관한 특수 반응 (열리지 않는 문에도 반응은 있다)
  const sp = (CH.presentSpecial || {})[npcId];
  const special = sp && sp[factId];

  if (special && !run.done.has('sp_' + npcId + '_' + factId)) {
    say(special.text);
    gain(special.gives);
    run.done.add('sp_' + npcId + '_' + factId);
  } else if (st.present && st.present.indexOf(factId) !== -1) {
    say((st.altText && st.altText[factId]) || st.text);
    gain(st.gives);
    run.stage[npcId] = Math.min(i + 1, stages.length - 1);
  } else {
    say('그는 그것을 본다. 그리고 아무 말도 하지 않는다.\n\n*(지금 이 사람에게 이것은 아무것도 열지 못한다.)*');
  }

  // 무언가를 내보이는 데에는 대가가 있다
  // 대가는 인물별로 다를 수 있다 — 내놓는 것이 자기 것인 사람에게만 값이 붙는다
  let cost = (CH.presentCost || {})[factId];
  if (cost && typeof cost === 'object') cost = canChar(cost.who) ? cost.fact : null;
  if (cost) gain([cost]);

  spend();
}

function compare(c) {
  sayAct('대조', '— ' + c.label, true);
  say(c.text);
  gain(c.gives);
  run.done.add(c.id);
  render();
}

function move(id) {
  run.place = id;
  const pl = CH.places[id];
  sayAct('이동', '— ' + pl.name, true);
  say(pl.desc);
  render();
}

/* ── 화면 ──────────────────────────────────────────── */
function availableActions() {
  return CH.actions.filter((a) =>
    a.at === run.place && canChar(a.who) && !run.done.has(a.id) &&
    (!a.need || a.need.every(has)) && flagOk(a.flagIf, a.flagNot)
  );
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

function render() {
  // 머리글은 마지막 행동까지 반영한다. 회차가 끝났으면 선택지는 다시 그리지 않는다.
  $('#clock').textContent = clockStr(run.clock);
  $('#left').textContent = run.left;
  $('#who').textContent = DATA.characters[run.char].name;
  $('#placeName').textContent = CH.places[run.place].name;
  if (run.over) return;

  // 이동
  const mv = $('#moves'); mv.innerHTML = '';
  Object.keys(CH.places).forEach((id) => {
    const b = document.createElement('button');
    b.className = 'move' + (id === run.place ? ' here' : '');
    b.textContent = CH.places[id].name;
    b.disabled = id === run.place;
    b.onclick = () => move(id);
    mv.appendChild(b);
  });

  // 행동
  const ac = $('#acts'); ac.innerHTML = '';
  availableCompares().forEach((c) => {
    const b = document.createElement('button');
    b.className = 'act free-act';
    b.innerHTML = '<span class="v">대조</span> ' + c.label + ' <span class="free">무료</span>';
    b.onclick = () => compare(c);
    ac.appendChild(b);
  });
  availableActions().forEach((a) => {
    const b = document.createElement('button');
    b.className = 'act';
    b.innerHTML = '<span class="v">' + a.verb + '</span> ' + a.label;
    b.onclick = () => doAction(a);
    ac.appendChild(b);
  });
  // 인물
  Object.keys(CH.people).forEach((id) => {
    if (id === run.char) return;                 // 나 자신은 심문하지 않는다
    if (CH.people[id].at !== run.place) return;
    const p = CH.people[id];
    const wrap = document.createElement('div');
    wrap.className = 'npc';
    wrap.innerHTML = '<div class="npcname">' + p.name + ' <span class="dim">' + p.job + '</span></div>';
    const q = document.createElement('button');
    q.className = 'act';
    q.innerHTML = '<span class="v">질문</span> 말을 건다';
    q.onclick = () => question(id);
    wrap.appendChild(q);
    const pr = document.createElement('button');
    pr.className = 'act';
    pr.innerHTML = '<span class="v">제시</span> 무언가를 보여준다';
    pr.onclick = () => openPresent(id);
    wrap.appendChild(pr);
    ac.appendChild(wrap);
  });
  if (!ac.children.length) ac.innerHTML = '<div class="dim pad">여기서 할 수 있는 것이 없다.</div>';

  renderNotebook();
}

function renderNotebook() {
  const nb = $('#notebook'); nb.innerHTML = '';
  const all = save.seen.slice();
  run.facts.forEach((f) => { if (all.indexOf(f) === -1) all.push(f); });
  if (!all.length) { nb.innerHTML = '<div class="dim pad">아직 아무것도 없다.</div>'; return; }
  all.forEach((id) => {
    const f = DATA.facts[id]; if (!f) return;
    const known = run.facts.has(id);
    const d = document.createElement('div');
    d.className = 'note' + (known ? '' : ' locked') + (f.key ? ' key' : '') + (f.hook ? ' hook' : '');
    d.innerHTML = '<b>' + inline(esc(f.t)) + '</b><span class="nd">' + inline(esc(f.d)) + '</span>' +
      (known ? '' : '<span class="lockmsg">이 회차의 나는 이것을 모른다</span>');
    nb.appendChild(d);
  });
}

function openPresent(npcId) {
  const items = [];
  (CH.presentItems || []).forEach((it) => {
    if (it.who && it.who.indexOf(run.char) === -1) return;
    if (it.need && !it.need.every(has)) return;
    items.push({ id: it.id, t: it.t });
  });
  run.facts.forEach((id) => items.push({ id: id, t: DATA.facts[id].t }));
  if (!items.length) { say('*(보여줄 것이 없다.)*'); return; }
  const m = $('#modal');
  m.innerHTML = '<div class="sheet"><h3>' + CH.people[npcId].name + '에게 무엇을 보여줄까</h3></div>';
  const sh = m.querySelector('.sheet');
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'act'; b.textContent = it.t;
    b.onclick = () => { m.classList.remove('on'); present(npcId, it.id); };
    sh.appendChild(b);
  });
  const c = document.createElement('button');
  c.className = 'act cancel'; c.textContent = '그만둔다 (행동을 쓰지 않는다)';
  c.onclick = () => m.classList.remove('on');
  sh.appendChild(c);
  m.classList.add('on');
}

/* ── 종료 · 판단 ───────────────────────────────────── */
function endRun() {
  run.over = true;
  $('#play').classList.add('hide');
  if (CH.judge === false) { renderFinal(); return; }
  $('#judge').classList.remove('hide');
  $('#judgeClock').textContent = clockStr(run.clock);

  const sel = $('#accuse'); sel.innerHTML = '';
  const ids = [];
  Object.keys(CH.people).concat(Object.keys(DATA.characters)).forEach((id) => {
    if (id !== run.char && ids.indexOf(id) === -1) ids.push(id);
  });
  const nameOf = (id) => (CH.people[id] || DATA.characters[id]).name;
  const opts = [{ id: 'none', n: '모르겠다' }].concat(ids.map((id) => ({ id: id, n: nameOf(id) })));
  opts.forEach((o) => {
    const el = document.createElement('option');
    el.value = o.id; el.textContent = o.n; sel.appendChild(el);
  });

  const dp = $('#disposal'); dp.innerHTML = '';
  DATA.disposals.forEach((d) => {
    const el = document.createElement('option');
    el.value = d.id; el.textContent = d.label + ' — ' + d.d; dp.appendChild(el);
  });
}

function submitJudgement() {
  const accuse = $('#accuse').value;
  const disposal = $('#disposal').value;
  // 캐릭터가 자기 기준을 가지면 그것을 쓴다 (전부 충족), 없으면 공통 기준 (하나라도)
  const deep = isDeep();
  const rec = {
    char: run.char, accuse: accuse, disposal: disposal,
    henryLine: has('f_henry_line'), match: has('f_match'),
    wary: has('f_caught'),
    // 09번 §5 ③ : 처분이 정하는 것은 결국 이것 하나다
    michaelFree: !(accuse === 'michael' && disposal === 'isolate'),
    facts: run.facts.size, deep: deep,
  };
  save.runs.push(rec);
  writeSave(save);

  $('#judge').classList.add('hide');
  $('#endcard').classList.remove('hide');

  const who = accuse === 'none' ? null
    : (CH.people[accuse] || DATA.characters[accuse]).name;
  const name = who ? who + objp(who) + ' 지목했다' : '아무도 지목하지 않았다';
  const dl = DATA.disposals.filter((d) => d.id === disposal)[0];

  carried = Array.from(run.facts);   // 섬으로 들고 간다
  $('#endTitle').textContent = '배가 섬에 닿았다';
  $('#endBody').innerHTML =
    md('**' + name + '.** ' + (accuse === 'none' ? '아무도 격리되지 않은 채 섬에 도착한다.' : dl.label + '.'));

  // 발견한 순서대로 — 마지막에 알아챈 것이 마지막에 남는다
  const hooks = openHooks();
  const notes = (CH.endnotes || []).filter((n) =>
    needList(n.need).every(has) && !(n.not && has(n.not)));
  if (notes.length)
    $('#endBody').innerHTML += '<hr>' + notes.map((n) => md(n.text)).join('');

  $('#endHooks').innerHTML = hookList(hooks, '확인하지 못한 채 섬에 내린 것');

  const used = new Set(save.runs.map((r) => r.char));
  const rest = Object.keys(DATA.characters).filter((c) => !used.has(c));
  $('#endNext').innerHTML =
    '<p class="dim">회차 ' + save.runs.length + ' · 이번에 알아낸 것 ' + run.facts.size +
    '개 · 수첩에 쌓인 것 ' + save.seen.length + '개</p>' +
    (rest.length
      ? '<p>' + md('아직 **' + rest.map((c) => DATA.characters[c].name).join(', ') + '**(으)로는 이 밤을 보지 않았다.') + '</p>'
      : '<p>' + md('세 사람으로 다 보았다. 그런데도 **확신은 없다.**') + '</p>');
}

/* ── 시작 화면 ─────────────────────────────────────── */
function renderStart() {
  const wrap = $('#chars'); wrap.innerHTML = '';
  const used = new Set(save.runs.map((r) => r.char));
  Object.keys(DATA.characters).forEach((id) => {
    const c = DATA.characters[id];
    const b = document.createElement('button');
    b.className = 'card' + (used.has(id) ? ' played' : '');
    b.innerHTML = '<div class="cname">' + c.name + '</div>' +
      '<div class="cjob">' + c.job + '</div>' +
      '<div class="cblurb">' + c.blurb + '</div>' +
      '<div class="csec"><b>내가 숨기고 있는 것</b><br>' + c.secret + '</div>' +
      (used.has(id) ? '<div class="cplayed">이미 플레이함</div>' : '');
    b.onclick = () => start(id);
    wrap.appendChild(b);
  });
  $('#carry').innerHTML = save.seen.length
    ? md('지난 회차까지 **' + save.seen.length + '개**를 알아냈다. 수첩은 그대로 남아 있지만, **이번 인물이 모르는 것은 쓸 수 없다.**')
    : '';
}

function start(id, chapterId, carry) {
  newRun(id, chapterId || 'case1', carry);
  ['#start', '#endcard', '#island', '#judge'].forEach((k) => $(k).classList.add('hide'));
  $('#play').classList.remove('hide');
  $('#log').innerHTML = '';
  window.scrollTo(0, 0);
  const c = DATA.characters[id];
  push('<b>' + esc(c.name) + '</b> · ' + esc(c.job), 'act');
  say(CH.openings[id]);
  say(CH.open.replace('{n}', run.left));
  move(CH.from);
}

function needList(n) { return Array.isArray(n) ? n : [n]; }

/* 깊은 회차인가 — 두 챕터가 같은 규칙을 쓴다 */
function isDeep() {
  if (((CH.deepNot || {})[run.char] || []).some(has)) return false;
  const rule = (CH.deepIf || {})[run.char];
  return rule ? rule.every(has) : (DATA.deepFacts || []).some(has);
}

function hookList(hooks, title) {
  return '<h4>' + title + '</h4>' + (hooks.length
    ? '<ul>' + hooks.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>'
    : '<p class="dim">없다. 알아낸 것은 많은데, 걸리는 것이 하나도 없다.</p>');
}
function openHooks() {
  return Array.from(run.facts)
    .filter((id) => DATA.facts[id] && DATA.facts[id].hook)
    .map((id) => DATA.facts[id].t);
}

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

function renderIsland() {
  const c2 = DATA.island;
  const f = save.runs[save.runs.length - 1];
  let html = '<div class="lead">' + md(c2.arrive) + '</div>';
  if (c2.byChar[f.char]) html += md(c2.byChar[f.char]);
  html += '<h2>부두</h2>' + md(c2.arthur);

  c2.reads.forEach((r) => {
    const hit = firstMatch(r.when, f);
    if (!hit || !hit.text) return;
    html += '<h2>' + r.title + '</h2>' + md(withWary(hit, f));
  });
  $('#islandBody').innerHTML = html;

}

/* ── 섬이 끝난다 ── 09번 §6 결말 4종 ─────────────── */
function renderFinal() {
  const c2 = DATA.island;
  const f = save.runs[save.runs.length - 1];
  const deep = isDeep();

  $('#final').classList.remove('hide');
  window.scrollTo(0, 0);

  const end = firstMatch(c2.endings, f);
  $('#islandEnd').innerHTML = '<h2>' + end.label + '</h2>' + md(withWary(end, f));

  // ④+⑤ 는 회차를 넘어 누적된다 — 09번 §6 D
  const held = c2.truth.need.every((k) => save.runs.some((r) => r[k]));
  $('#islandTruth').innerHTML = held
    ? '<h2>' + c2.truth.label + '</h2>' + md(c2.truth.text)
    : '<div class="dim">' + md(c2.locked) + '</div>';
  $('#islandTruth').style.borderLeftColor = held ? '' : 'transparent';

  const notes = (CH.endnotes || []).filter((n) =>
    needList(n.need).every(has) && !(n.not && has(n.not)));
  $('#finalMono').innerHTML = md(CH.monologue[run.char][deep ? 'deep' : 'shallow']) +
    (notes.length ? '<hr>' + notes.map((n) => md(n.text)).join('') : '');
  $('#finalHooks').innerHTML = hookList(openHooks(), '확인하지 못한 채 섬을 떠난 것');

  f.islandFacts = run.facts.size;
  f.islandDeep = deep;
  writeSave(save);

  const used = new Set(save.runs.map((r) => r.char));
  const rest = Object.keys(DATA.characters).filter((c) => !used.has(c));
  $('#finalNext').innerHTML =
    md('회차 ' + save.runs.length + ' · 섬에서 알아낸 것 ' + run.facts.size +
       '개 · 수첩에 쌓인 것 ' + save.seen.length + '개') +
    (rest.length
      ? md('아직 **' + rest.map((c) => DATA.characters[c].name).join(', ') + '**(으)로는 이 밤을 보지 않았다.')
      : md('네 사람으로 다 보았다. 그런데도 **확신은 없다.**'));
}

function toIsland() {
  $('#endcard').classList.add('hide');
  $('#island').classList.remove('hide');
  window.scrollTo(0, 0);
  renderIsland();
}

function restart() {
  $('#endcard').classList.add('hide');
  $('#island').classList.add('hide');
  $('#final').classList.add('hide');
  $('#start').classList.remove('hide');
  window.scrollTo(0, 0);
  renderStart();
}
function wipe() {
  if (!confirm('쌓인 회차 기록을 전부 지웁니다. 계속할까요?')) return;
  save = { seen: [], runs: [] }; writeSave(save); renderStart();
}

window.addEventListener('DOMContentLoaded', () => {
  $('#submit').onclick = submitJudgement;
  $('#again').onclick = restart;
  $('#again2').onclick = restart;
  $('#again3').onclick = restart;
  $('#toIsland').onclick = toIsland;
  $('#toCase2').onclick = () => start(run.char, 'case2', carried);
  $('#wipe').onclick = wipe;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') e.target.classList.remove('on'); };
  renderStart();
});
})();
