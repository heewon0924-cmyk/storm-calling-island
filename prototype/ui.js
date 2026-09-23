/* 「폭풍을 부르는 섬 이야기」 프로토타입 — 화면
 *
 * 이 파일은 규칙을 모릅니다. 조건도 플래그도 여기서 따지지 않습니다.
 * 하는 일은 셋뿐입니다 — 규칙에게 물어 그리고, 누르면 규칙에게 알리고,
 * 규칙이 돌려준 사건 목록을 글로 바꿉니다.
 *
 * 01번 §16-F — 나중에 Godot 으로 옮길 때, 다시 쓰는 쪽이 이 파일입니다.
 */
(function () {
'use strict';

const $ = (s) => document.querySelector(s);

/* ── 저장소 — 플랫폼이 주는 것 ─────────────────────── */
const SAVE_KEY = 'sci_proto_v1';
RULES.setIO({
  read: function () {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
    catch (e) { return null; }
  },
  write: function (s) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {}
  },
});

/* ── 글자 ──────────────────────────────────────────── */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => s
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>');

/* 인용(>)은 문단 단위로 처리한 뒤 이스케이프한다 */
function md(s) {
  return s.split('\n\n').map((b) => {
    if (b.trim() === '---') return '<hr>';
    if (b.indexOf('> ') === 0)
      return '<blockquote>' + inline(esc(b.replace(/^> ?/gm, ''))).replace(/\n/g, '<br>') + '</blockquote>';
    return '<p>' + inline(esc(b)).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function push(html, cls) {
  const box = $('#log');
  const d = document.createElement('div');
  d.className = 'entry' + (cls ? ' ' + cls : '');
  d.innerHTML = html;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  return d;
}

/* ── 사건 목록을 글로 ──────────────────────────────── */
function play(events) {
  let ended = false;
  events.forEach((e) => {
    if (e.k === 'who') {
      push('<b>' + esc(e.name) + '</b> · ' + esc(e.job), 'act');
    } else if (e.k === 'act') {
      // 동사와 대상은 데이터에서 오므로 이스케이프한다
      push('<span class="verb">' + esc(e.verb) + '</span> ' + esc(e.label) +
           (e.free ? ' <span class="free">무료</span>' : ''), 'act');
    } else if (e.k === 'text') {
      push(md(e.text), e.cls);
    } else if (e.k === 'fact') {
      push('<span class="tag">수첩</span> <b>' + inline(esc(e.t)) + '</b>' +
           '<br><span class="dim">' + inline(esc(e.d)) + '</span>', 'got');
    } else if (e.k === 'reply') {
      push('<span class="tag">회신</span>', 'arrive');
    } else if (e.k === 'end') {
      ended = true;
    }
  });
  if (ended) endRun(); else render();
}

/* ── 놀이 화면 ─────────────────────────────────────── */
function render() {
  // 머리글은 마지막 행동까지 반영한다. 회차가 끝났으면 선택지는 다시 그리지 않는다.
  const s = RULES.state();
  $('#clock').textContent = s.clock;
  $('#left').textContent = s.left;
  $('#who').textContent = s.charName;
  $('#placeName').textContent = s.placeName;
  if (s.over) return;

  // 이동
  const mv = $('#moves'); mv.innerHTML = '';
  RULES.places().forEach((p) => {
    const b = document.createElement('button');
    b.className = 'move' + (p.here ? ' here' : '');
    b.textContent = p.name;
    b.disabled = p.here;
    b.onclick = () => play(RULES.move(p.id));
    mv.appendChild(b);
  });

  // 행동
  const ac = $('#acts'); ac.innerHTML = '';
  const board = RULES.boardItems();
  if (board.length >= 2) {
    const b = document.createElement('button');
    b.className = 'act free-act';
    b.innerHTML = '<span class="v">대조</span> 두 장을 맞춰본다 ' +
      '<span class="dim">(' + board.length + '장)</span> <span class="free">무료</span>';
    b.onclick = () => openBoard(board);
    ac.appendChild(b);
  }
  RULES.availableActions().forEach((a) => {
    const b = document.createElement('button');
    b.className = 'act';
    b.innerHTML = '<span class="v">' + a.verb + '</span> ' + a.label;
    b.onclick = () => play(RULES.doAction(a.id));
    ac.appendChild(b);
  });
  // 인물
  RULES.peopleHere().forEach((p) => {
    const wrap = document.createElement('div');
    wrap.className = 'npc';
    wrap.innerHTML = '<div class="npcname">' + p.name + ' <span class="dim">' + p.job + '</span></div>';
    const q = document.createElement('button');
    q.className = 'act';
    q.innerHTML = '<span class="v">질문</span> 말을 건다';
    q.onclick = () => play(RULES.question(p.id));
    wrap.appendChild(q);
    const pr = document.createElement('button');
    pr.className = 'act';
    pr.innerHTML = '<span class="v">제시</span> 무언가를 보여준다';
    pr.onclick = () => openPresent(p.id, p.name);
    wrap.appendChild(pr);
    ac.appendChild(wrap);
  });
  if (!ac.children.length) ac.innerHTML = '<div class="dim pad">여기서 할 수 있는 것이 없다.</div>';

  renderNotebook();
}

function renderNotebook() {
  const nb = $('#notebook'); nb.innerHTML = '';
  const lines = RULES.notebook();
  if (!lines.length) { nb.innerHTML = '<div class="dim pad">아직 아무것도 없다.</div>'; return; }
  lines.forEach((f) => {
    const d = document.createElement('div');
    d.className = 'note' + (f.known ? '' : ' locked') + (f.key ? ' key' : '') + (f.hook ? ' hook' : '');
    d.innerHTML = '<b>' + inline(esc(f.t)) + '</b><span class="nd">' + inline(esc(f.d)) + '</span>' +
      (f.known ? '' : '<span class="lockmsg">이 회차의 나는 이것을 모른다</span>');
    nb.appendChild(d);
  });
}

function openBoard(items) {
  const pick = [];
  const m = $('#modal');
  m.innerHTML = '<div class="sheet"><h3>무엇과 무엇을 맞춰볼까</h3>' +
    '<p class="dim" style="margin:0 0 12px">두 장, 또는 세 장. 행동을 쓰지 않는다.</p></div>';
  const sh = m.querySelector('.sheet');
  const go = document.createElement('button');
  const sync = () => {
    go.disabled = pick.length < 2;
    go.textContent = pick.length < 2 ? '두 장을 고른다' : '맞춰본다 (' + pick.length + '장)';
  };
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'act pick';
    b.textContent = it.t;
    b.onclick = () => {
      const i = pick.indexOf(it.id);
      if (i === -1) { if (pick.length >= 3) return; pick.push(it.id); b.classList.add('on'); }
      else { pick.splice(i, 1); b.classList.remove('on'); }
      sync();
    };
    sh.appendChild(b);
  });
  go.className = 'act go';
  go.onclick = () => { if (pick.length >= 2) { m.classList.remove('on'); play(RULES.tryCompare(pick)); } };
  sh.appendChild(go);
  const c = document.createElement('button');
  c.className = 'act cancel'; c.textContent = '그만둔다';
  c.onclick = () => m.classList.remove('on');
  sh.appendChild(c);
  sync();
  m.classList.add('on');
}

function openPresent(npcId, npcName) {
  const items = RULES.presentables();
  if (!items.length) { push(md('*(보여줄 것이 없다.)*')); return; }
  const m = $('#modal');
  m.innerHTML = '<div class="sheet"><h3>' + esc(npcName) + '에게 무엇을 보여줄까</h3></div>';
  const sh = m.querySelector('.sheet');
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'act'; b.textContent = it.t;
    b.onclick = () => { m.classList.remove('on'); play(RULES.present(npcId, it.id)); };
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
  render();                       // 머리글을 마지막 행동까지 맞춘다
  $('#play').classList.add('hide');
  if (!RULES.state().judges) { renderFinal(); return; }
  $('#judge').classList.remove('hide');

  const j = RULES.judgeData();
  $('#judgeClock').textContent = j.clock;

  const sel = $('#accuse'); sel.innerHTML = '';
  j.accuse.forEach((o) => {
    const el = document.createElement('option');
    el.value = o.id; el.textContent = o.name; sel.appendChild(el);
  });

  // 07번 §6-C 「자신이 숨긴 것을 스스로 밝힐 것인가」
  const ow = $('#own');
  if (j.own.kind === 'none') {
    ow.innerHTML = '<p class="dim">이 회차의 나는 감출 것이 없다.</p>';
  } else if (j.own.kind === 'told') {
    ow.innerHTML = '<p class="dim">이미 말해버렸다 — ' + esc(j.own.t) + '<br>되돌릴 수 없다.</p>';
  } else {
    ow.innerHTML = '<label class="chk"><input type="checkbox" id="tellOwn"> ' + esc(j.own.t) +
      ' — 사람들 앞에서 함께 밝힌다</label>' +
      '<p class="dim">행동을 쓰지 않는다. 대신 아무것도 열어주지 않는다. ' +
      '<b>배 위에서 먼저 말했다면 열렸을 문이 있었다.</b></p>';
  }

  const dp = $('#disposal'); dp.innerHTML = '';
  j.disposals.forEach((d) => {
    const el = document.createElement('option');
    el.value = d.id; el.textContent = d.label + ' — ' + d.d; dp.appendChild(el);
  });
}

function hookList(hooks, title) {
  return '<h4>' + title + '</h4>' + (hooks.length
    ? '<ul>' + hooks.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>'
    : '<p class="dim">없다. 알아낸 것은 많은데, 걸리는 것이 하나도 없다.</p>');
}

function restLine(rest) {
  return rest.length
    ? md('아직 **' + rest.join(', ') + '**(으)로는 이 밤을 보지 않았다.')
    : md('네 사람으로 다 보았다. 그런데도 **확신은 없다.**');
}

function submitJudgement() {
  const tell = $('#tellOwn');
  const r = RULES.submitJudgement($('#accuse').value, $('#disposal').value, !!(tell && tell.checked));

  $('#judge').classList.add('hide');
  $('#endcard').classList.remove('hide');

  $('#endTitle').textContent = '배가 섬에 닿았다';
  $('#endBody').innerHTML = md(r.line) +
    (r.notes.length ? '<hr>' + r.notes.map(md).join('') : '');
  $('#endHooks').innerHTML = hookList(r.hooks, '확인하지 못한 채 섬에 내린 것');
  $('#endNext').innerHTML =
    '<p class="dim">회차 ' + r.runs + ' · 이번에 알아낸 것 ' + r.facts +
    '개 · 수첩에 쌓인 것 ' + r.seen + '개</p>' + restLine(r.rest);
}

/* ── 시작 화면 ─────────────────────────────────────── */
function renderStart() {
  const d = RULES.startData();
  const wrap = $('#chars'); wrap.innerHTML = '';
  d.characters.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'card' + (c.played ? ' played' : '');
    b.innerHTML = '<div class="cname">' + c.name + '</div>' +
      '<div class="cjob">' + c.job + '</div>' +
      '<div class="cblurb">' + c.blurb + '</div>' +
      '<div class="csec"><b>내가 숨기고 있는 것</b><br>' + c.secret + '</div>' +
      (c.played ? '<div class="cplayed">이미 플레이함</div>' : '');
    b.onclick = () => enter(RULES.begin(c.id, 'case1'));
    wrap.appendChild(b);
  });
  $('#carry').innerHTML = d.seen
    ? md('지난 회차까지 **' + d.seen + '개**를 알아냈다. 수첩은 그대로 남아 있지만, **이번 인물이 모르는 것은 쓸 수 없다.**')
    : '';
}

function enter(events) {
  ['#start', '#endcard', '#island', '#judge', '#final'].forEach((k) => $(k).classList.add('hide'));
  $('#play').classList.remove('hide');
  $('#log').innerHTML = '';
  const s = RULES.state();
  $('#chapter').textContent = s.chapterTitle + ' · ' + s.runNo + '회차';
  window.scrollTo(0, 0);
  play(events);
}

/* ── CASE 2 — 규칙이 플래그를 읽고, 여기는 그리기만 한다 ── */
function renderIsland() {
  const d = RULES.islandData();
  let html = '<div class="lead">' + md(d.arrive) + '</div>';
  if (d.byChar) html += md(d.byChar);
  html += '<h2>부두</h2>' + md(d.arthur);
  d.sections.forEach((s) => { html += '<h2>' + s.title + '</h2>' + md(s.text); });
  $('#islandBody').innerHTML = html;
}

function renderFinal() {
  const d = RULES.finalData();
  $('#final').classList.remove('hide');
  window.scrollTo(0, 0);

  $('#islandEnd').innerHTML = '<h2>' + d.end.label + '</h2>' + md(d.end.text);
  $('#islandTruth').innerHTML = d.truth.held
    ? '<h2>' + d.truth.label + '</h2>' + md(d.truth.text) +
      (d.truth.after ? '<div class="closing">' + md(d.truth.after) + '</div>' : '')
    : '<div class="dim">' + md(d.truth.text) + '</div>';
  $('#islandTruth').style.borderLeftColor = d.truth.held ? '' : 'transparent';

  $('#finalMono').innerHTML = md(d.mono) +
    (d.notes.length ? '<hr>' + d.notes.map(md).join('') : '');
  $('#finalHooks').innerHTML = hookList(d.hooks, '확인하지 못한 채 섬을 떠난 것');
  $('#finalNext').innerHTML =
    md('회차 ' + d.runs + ' · 섬에서 알아낸 것 ' + d.facts + '개 · 수첩에 쌓인 것 ' + d.seen + '개') +
    restLine(d.rest);

  // 이야기는 D 에서 끝난다. 회차는 그 뒤로도 쌓을 수 있다 — 01번 §16
  $('#again3').textContent = d.truth.held ? '그래도 한 번 더 본다' : '다시 이 밤으로';
}

function toIsland() {
  $('#endcard').classList.add('hide');
  $('#island').classList.remove('hide');
  window.scrollTo(0, 0);
  renderIsland();
}

function restart() {
  ['#endcard', '#island', '#final'].forEach((k) => $(k).classList.add('hide'));
  $('#start').classList.remove('hide');
  window.scrollTo(0, 0);
  renderStart();
}
function wipe() {
  if (!confirm('쌓인 회차 기록을 전부 지웁니다. 계속할까요?')) return;
  RULES.wipe(); renderStart();
}

window.addEventListener('DOMContentLoaded', () => {
  $('#submit').onclick = submitJudgement;
  $('#again').onclick = restart;
  $('#again2').onclick = restart;
  $('#again3').onclick = restart;
  $('#toIsland').onclick = toIsland;
  $('#toCase2').onclick = () => enter(RULES.toCase2());
  $('#wipe').onclick = wipe;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') e.target.classList.remove('on'); };
  renderStart();
});
})();
