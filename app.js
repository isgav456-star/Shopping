import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, writeBatch, query, where, getDocs, increment } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ---------- constants ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UNITS = { unit: { label: 'יח׳', step: 1 }, kg: { label: 'ק״ג', step: 0.5 }, g: { label: 'גרם', step: 100 } };
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAYCODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const EMOJIS = ['🥬','🍎','🥕','🧀','🥛','🥚','🥖','🍞','🍗','🥩','🐟','🥫','🍝','🍚','🫒','🧂','☕','🧃','🥤','🍷','🍫','🍪','🧊','🍦','🧽','🧻','🧴','🪥','🐾','👶','🎉','📦'];
const SEED_CATS = [
  ['c-veg', 'ירקות ופירות', '🥬'], ['c-dairy', 'מוצרי חלב וביצים', '🧀'], ['c-bread', 'לחם ומאפים', '🥖'], ['c-meat', 'בשר ודגים', '🍗'],
  ['c-pantry', 'מזווה', '🥫'], ['c-drinks', 'משקאות', '☕'], ['c-frozen', 'קפואים', '🧊'], ['c-clean', 'ניקיון', '🧽'],
  ['c-care', 'טואלטיקה', '🧴'], ['c-pets', 'חיות מחמד', '🐾']];
const SEED_PRODS = [
  ['p-tomato', 'עגבניות', 'c-veg', 'kg'], ['p-cucumber', 'מלפפונים', 'c-veg', 'kg'], ['p-banana', 'בננות', 'c-veg', 'kg'],
  ['p-milk', 'חלב', 'c-dairy', 'unit'], ['p-eggs', 'ביצים', 'c-dairy', 'unit'], ['p-cheese', 'גבינה לבנה', 'c-dairy', 'unit'],
  ['p-bread', 'לחם', 'c-bread', 'unit'], ['p-chicken', 'חזה עוף', 'c-meat', 'kg'], ['p-rice', 'אורז', 'c-pantry', 'unit'],
  ['p-pasta', 'פסטה', 'c-pantry', 'unit'], ['p-coffee', 'קפה', 'c-drinks', 'unit'], ['p-dish', 'סבון כלים', 'c-clean', 'unit'],
  ['p-tp', 'נייר טואלט', 'c-care', 'unit']];

/* ---------- state ---------- */
const S = { cats: [], prods: [], lists: [], items: [], purch: [], settings: {} };
const loaded = { cats: false, prods: false, lists: false, items: false, purch: false, settings: false };
let status = 'loading', errMsg = '';
let R = { screen: 'home' };
let pending = null, sheetState = {};
let fs = null, auth = null, user = null, unsubs = [];
let online = navigator.onLine;

/* ---------- Firestore adapter ----------
   Writes are fired without waiting for the server, so the app keeps working offline in the supermarket.
   Firestore applies them locally at once and syncs when the connection returns. */
const onWriteErr = e => { console.error(e); toast(e?.code === 'permission-denied' ? 'אין הרשאה לשמור. בדקו שהמייל שלכם מופיע בכללי Firestore.' : 'שמירה נכשלה. נסו שוב.'); };
const fire = p => { p.catch(onWriteErr); return Promise.resolve(); };
const db = {
  collection: c => ({
    add: data => { const r = doc(collection(fs, c)); fire(setDoc(r, data)); return Promise.resolve(r); },
    newId: () => doc(collection(fs, c)).id,
  }),
  doc: p => ({
    update: data => fire(updateDoc(doc(fs, p), data)),
    set: data => fire(setDoc(doc(fs, p), data)),
    delete: () => fire(deleteDoc(doc(fs, p))),
  }),
};
function batchRun(fn) { const b = writeBatch(fs); fn(b, p => doc(fs, p)); fire(b.commit()); }

/* ---------- helpers ---------- */
const unitOf = p => UNITS[p.unit] || UNITS.unit;
const fmtQty = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('he-IL');
const fmtMoney = n => '₪' + (Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const sortedCats = () => [...S.cats].sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(b.name, 'he'));
const nowIso = () => new Date().toISOString();
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2800); }
async function safe(fn, msg) { try { return await fn(); } catch (e) { console.error(e); toast(msg || 'הפעולה נכשלה. נסו שוב.'); } }
const itemsText = items => (items || []).map(i => `${i.name} ${fmtQty(i.qty)} ${(UNITS[i.unit] || UNITS.unit).label}`).join(', ');

function entriesFor(id) {
  if (id === 'home') return S.prods.filter(p => p.scope === 'home').map(p => ({ key: p.id, p, need: !!p.need, qty: Number(p.qty) || 0, path: 'products/' + p.id }));
  return S.items.filter(i => i.listId === id).map(i => { const p = S.prods.find(x => x.id === i.productId); return p ? { key: i.id, p, need: !!i.need, qty: Number(i.qty) || 0, path: 'listItems/' + i.id, item: i } : null; }).filter(Boolean);
}
function grouped(entries, showEmpty) {
  const cats = sortedCats();
  const out = cats.map(c => ({ c, rows: entries.filter(e => e.p.categoryId === c.id) }));
  const orphan = entries.filter(e => !cats.some(c => c.id === e.p.categoryId));
  if (orphan.length) out.push({ c: { id: null, name: 'ללא קטגוריה', emoji: '📦' }, rows: orphan });
  out.forEach(g => g.rows.sort((a, b) => String(a.p.name).localeCompare(b.p.name, 'he')));
  return out.filter(g => g.rows.length || (showEmpty && g.c.id));
}
const findEntry = key => entriesFor(R.id).find(e => e.key === key);
const reminder = () => S.settings.reminder || {};
function reminderText() { const r = reminder(); if (r.day == null) return 'לא הוגדרה עדיין'; return `${r.every == 2 ? 'כל שבועיים' : 'כל שבוע'}, יום ${DAYS[r.day]} ${r.time || ''}`; }
const sheetUrl = () => (S.settings.sheet || {}).url || '';

/* ---------- render ---------- */
function render() {
  const app = $('#app'); const y = window.scrollY;
  if (status === 'config') { app.innerHTML = viewConfig(); return; }
  if (status === 'signedout') { app.innerHTML = viewLogin(); return; }
  app.innerHTML = R.screen === 'list' ? viewList() : R.screen === 'history' ? viewHistory() : R.screen === 'settings' ? viewSettings() : viewHome();
  if (R._keepScroll) window.scrollTo(0, y); R._keepScroll = true;
}
function go(r) { R = { ...r, _keepScroll: false }; render(); window.scrollTo(0, 0); }

function statusBanner() {
  if (!online) return `<div class="banner">אין חיבור לאינטרנט. אפשר להמשיך לסמן, והשינויים יסונכרנו כשהחיבור יחזור.</div>`;
  if (status === 'loading') return `<div class="banner">טוען את הרשימות…</div>`;
  if (status === 'error') return `<div class="banner err">${esc(errMsg)}</div>`;
  return '';
}

function viewConfig() {
  return `<div class="login"><img class="logo" src="icons/icon-192.png" alt=""><h1>כמעט מוכן</h1>
    <p>חסרות הגדרות Firebase. פתחו את הקובץ <span class="code">config.js</span> והדביקו בו את ה-firebaseConfig של הפרויקט שלכם, לפי מדריך ההתקנה.</p></div>`;
}
function viewLogin() {
  return `<form class="login" id="loginForm" novalidate><img class="logo" src="icons/icon-192.png" alt=""><h1>הקניות שלנו</h1>
    <p>התחברו עם המייל והסיסמה שהוגדרו לכם ב-Firebase.</p>
    <label class="field">מייל<input id="li-email" type="email" autocomplete="username" dir="ltr" required></label>
    <label class="field">סיסמה<input id="li-pass" type="password" autocomplete="current-password" dir="ltr" required></label>
    <div class="ferr" id="li-err" hidden></div><div class="fok" id="li-ok" hidden></div>
    <div class="actions"><button class="primary" type="submit" id="li-btn">התחברות</button></div>
    <button type="button" class="mini" data-act="reset" style="margin-top:6px">שכחתי סיסמה</button></form>`;
}

function viewHome() {
  const homeE = entriesFor('home'); const miss = homeE.filter(e => e.need).length;
  const lists = [...S.lists].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const listHtml = lists.length ? `<ul class="lists">${lists.map(l => { const E = entriesFor(l.id); const m = E.filter(e => e.need).length;
      return `<li><button class="listcard" data-act="open" data-id="${l.id}"><span class="lc-body"><strong>${esc(l.name)}</strong><small>${E.length} מוצרים</small></span>${m ? `<span class="pill">${m} לקנייה</span>` : ''}<span class="chev">‹</span></button></li>`; }).join('')}</ul>`
    : `<p class="empty">אין רשימות כרגע. לחצו על + ובחרו "רשימה חדשה" כדי להכין רשימה לאירוע.</p>`;
  const waiting = S.purch.filter(p => !p.sheetSynced).length;
  return `<header class="top"><div><span class="eyebrow">משק הבית</span><h1>הקניות שלנו</h1></div>
    <div class="topbtns"><button class="gear" data-act="settings" aria-label="הגדרות">⚙︎</button><button class="fab" data-act="plus" aria-label="הוספה">+</button></div></header>
    ${statusBanner()}
    <button class="homecard" data-act="open" data-id="home"><span class="hc-icon">🏠</span>
      <span class="hc-body"><strong>רשימת הבית</strong><span>${homeE.length} מוצרים · ${miss ? miss + ' חסרים' : 'הכול בבית'}</span></span><span class="chev">‹</span></button>
    <h2 class="sec">רשימות לאירועים</h2>${listHtml}
    <div class="tools">
      <button class="tool" data-act="reminder"><span class="ti">⏰</span><strong>תזכורת לקניות</strong><small>${esc(reminderText())}</small></button>
      <button class="tool" data-act="history"><span class="ti">🧾</span><strong>היסטוריית קניות</strong><small>${S.purch.length} קניות${sheetUrl() ? (waiting ? ` · ${waiting} ממתינות לגיליון` : ' · מסונכרן לגיליון') : ' · הגיליון לא מחובר'}</small></button>
    </div>`;
}

function stepper(e) {
  const u = unitOf(e.p);
  return `<div class="step"><button data-act="dec" data-key="${e.key}" aria-label="פחות">−</button><input type="number" inputmode="decimal" min="0" step="${u.step}" data-key="${e.key}" class="qtyin" value="${e.qty || ''}" aria-label="כמות ${esc(e.p.name)}"><button data-act="inc" data-key="${e.key}" aria-label="יותר">+</button><span class="u">${u.label}</span></div>`;
}

function viewList() {
  const isHome = R.id === 'home'; const L = isHome ? null : S.lists.find(l => l.id === R.id);
  if (!isHome && !L) { R = { screen: 'home' }; return viewHome(); }
  const name = isHome ? 'רשימת הבית' : L.name;
  const E = entriesFor(R.id);
  if (R.shop) return viewShop(name, E);
  const miss = E.filter(e => e.need);
  const groups = grouped(E, R.edit && isHome);
  const body = groups.length ? groups.map(g => { const nm = g.rows.filter(r => r.need).length; return `<section class="group"><div class="ghead"><span class="ge">${esc(g.c.emoji || '📦')}</span><h2>${esc(g.c.name)}</h2>
      ${R.edit && g.c.id ? `<button class="gedit" data-act="editcat" data-cid="${g.c.id}">עריכה</button>` : `<span class="gcount">${nm ? nm + ' חסרים' : ''}</span>`}</div>
      ${g.rows.length ? `<ul class="rows">${g.rows.map(e => { const ph = e.p.photoCount || 0; return `<li class="row ${e.need ? 'need' : ''}">
        <label class="chk"><input type="checkbox" class="needbox" data-key="${e.key}" ${e.need ? 'checked' : ''}><span class="box"></span><span class="sr">חסר: ${esc(e.p.name)}</span></label>
        <button class="pname" data-act="prod" data-pid="${e.p.id}">${esc(e.p.name)}${e.need ? '<span class="tag">חסר</span>' : ''}${ph ? `<span class="cam">📷${ph > 1 ? ' ' + ph : ''}</span>` : ''}</button>
        ${e.need ? stepper(e) : `<span class="unit">${unitOf(e.p).label}</span>`}
        ${R.edit ? `<button class="del" data-act="rm" data-key="${e.key}" aria-label="הסרת ${esc(e.p.name)}">✕</button>` : ''}</li>`; }).join('')}</ul>` : `<p class="empty">אין מוצרים בקטגוריה הזו.</p>`}</section>`; }).join('')
    : `<p class="empty">${isHome ? 'אין עדיין מוצרים ברשימת הבית. לחצו "עריכה" ואז "הוספת מוצר".' : 'הרשימה ריקה. לחצו "עריכה" כדי להוסיף מוצרים מרשימת הבית או מוצרים חדשים לאירוע.'}</p>`;
  return `<header class="bar"><button class="iconbtn" data-act="home" aria-label="חזרה למסך הבית">→</button><h1>${esc(name)}</h1>
      ${isHome ? '' : `<button class="iconbtn" data-act="listmenu" aria-label="אפשרויות רשימה">⋯</button>`}</header>
    ${statusBanner()}
    <div class="toolbar"><button class="btn ${R.edit ? 'on' : ''}" data-act="edit">${R.edit ? 'סיום עריכה' : '✎ עריכה'}</button>
      <button class="btn primary" data-act="shop">🛒 לקנייה${miss.length ? ` <span class="badge">${miss.length}</span>` : ''}</button></div>
    <p class="legend">סמנו ✓ ליד מוצר שחסר, ובחרו כמה לקנות.</p>
    ${R.edit ? `<button class="addrow" data-act="addprod">+ הוספת מוצר</button>` : ''}
    ${body}`;
}

function viewShop(name, E) {
  const miss = E.filter(e => e.need); const picked = R.picked || new Set();
  const groups = grouped(miss, false);
  const body = groups.length ? groups.map(g => `<section class="group"><div class="ghead"><span class="ge">${esc(g.c.emoji || '📦')}</span><h2>${esc(g.c.name)}</h2><span class="gcount">${g.rows.length}</span></div>
     <ul class="rows">${g.rows.map(e => { const on = picked.has(e.key); return `<li class="row ${R.partial && on ? 'done' : ''}">
       ${R.partial ? `<label class="chk buy"><input type="checkbox" class="pickbox" data-key="${e.key}" ${on ? 'checked' : ''}><span class="box"></span><span class="sr">נקנה: ${esc(e.p.name)}</span></label>` : ''}
       <button class="pname" data-act="prod" data-pid="${e.p.id}">${esc(e.p.name)}${e.p.photoCount ? '<span class="cam">📷</span>' : ''}</button>
       <span class="qtyshow">${fmtQty(e.qty)} <span class="unit">${unitOf(e.p).label}</span></span></li>`; }).join('')}</ul></section>`).join('')
    : `<p class="empty">אין מה לקנות כרגע. סמנו מוצרים כחסרים ברשימה והם יופיעו כאן.</p>`;
  return `<header class="bar">${miss.length && !R.partial ? `<button class="iconbtn check" data-act="checkmenu" aria-label="סימון קנייה">✓</button>` : ''}<h1>לקנייה · ${esc(name)}</h1>
      <button class="textbtn" data-act="unshop">לרשימה ←</button></header>
    ${statusBanner()}
    ${R.partial ? `<p class="legend">סמנו את המוצרים שנקנו.</p>` : `<p class="legend">${miss.length} מוצרים לקנות</p>`}
    ${body}
    ${R.partial ? `<div class="spacer"></div><div class="bottombar"><div class="in"><button class="btn" data-act="partialback">חזור</button><span>${picked.size} נבחרו</span><button class="btn primary" data-act="partialdone" ${picked.size ? '' : 'disabled'}>סיום</button></div></div>` : ''}`;
}

function viewHistory() {
  const P = [...S.purch].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const months = {}; P.forEach(p => { const d = new Date(p.date); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); (months[k] = months[k] || { sum: 0, n: 0, d }); months[k].sum += Number(p.price) || 0; months[k].n++; });
  const mk = Object.keys(months).sort().reverse();
  const link = (S.settings.sheet || {}).link;
  return `<header class="bar"><button class="iconbtn" data-act="home" aria-label="חזרה">→</button><h1>היסטוריית קניות</h1>
      <button class="btn primary" data-act="export" ${P.length ? '' : 'disabled'}>ייצוא לאקסל</button></header>
    ${statusBanner()}
    ${sheetUrl() ? (link ? `<p class="legend"><a href="${esc(link)}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700">פתיחת הגיליון ב-Google Sheets ↗</a></p>` : '') : `<div class="banner">הגיליון עוד לא מחובר. חברו אותו בהגדרות (⚙︎) כדי שכל קנייה תירשם בו אוטומטית.</div>`}
    ${mk.length ? `<div class="months">${mk.map(k => `<div class="month"><small>${months[k].d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</small><b>${fmtMoney(months[k].sum)}</b><small>${months[k].n} קניות</small></div>`).join('')}</div>` : ''}
    ${P.length ? `<ul class="hist">${P.map(p => { const d = new Date(p.date); return `<li class="hcard"><div class="hb">
       <div class="hl"><strong>${esc(p.list)}</strong><span class="price">${fmtMoney(p.price)}</span></div>
       <small>${d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
         <span class="kind ${p.kind === 'partial' ? 'part' : ''}">${p.kind === 'partial' ? 'חלקית' : 'מלאה'}</span>
         ${sheetUrl() && !p.sheetSynced ? '<span class="kind wait">ממתין לגיליון</span>' : ''}</small>
       <div class="hitems">${esc(itemsText(p.items)).replace(/, /g, ' · ')}</div></div>
       <button class="mini" data-act="delpurch" data-id="${p.id}" aria-label="מחיקת רשומה">מחיקה</button></li>`; }).join('')}</ul>`
    : `<p class="empty">עוד לא נרשמו קניות. אחרי שתסמנו קנייה ותזינו מחיר, היא תופיע כאן ובגיליון.</p>`}`;
}

function viewSettings() {
  const sh = S.settings.sheet || {};
  return `<header class="bar"><button class="iconbtn" data-act="home" aria-label="חזרה">→</button><h1>הגדרות</h1></header>
    ${statusBanner()}
    <section class="card"><h2>Google Sheets</h2>
      <p>כל קנייה שמסמנים נרשמת אוטומטית בשורה חדשה בגיליון. מדביקים כאן את כתובת ה-Web app של Apps Script (מסתיימת ב-<span class="code">/exec</span>).</p>
      <label class="field">כתובת Web app<input id="s-url" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(sh.url || '')}"></label>
      <label class="field">קישור לגיליון (לא חובה, לפתיחה מהאפליקציה)<input id="s-link" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://docs.google.com/spreadsheets/…" value="${esc(sh.link || '')}"></label>
      <div class="ferr" id="s-err" hidden></div><div class="fok" id="s-ok" hidden></div>
      <div class="actions"><button data-act="testsheet">בדיקת חיבור</button><button class="primary" data-act="savesheet">שמירה</button></div></section>
    <section class="card"><h2>חשבון</h2><p>מחוברים כ-<span class="code">${esc(user?.email || '')}</span></p>
      <div class="actions"><button data-act="logout">התנתקות</button></div></section>
    <section class="card"><h2>התקנה באייפון</h2><p>בספארי: כפתור השיתוף ← "הוספה למסך הבית". האפליקציה תיפתח במסך מלא עם אייקון משלה.</p></section>`;
}

/* ---------- menus & sheets ---------- */
function openMenu(items, pos) {
  const L = $('#layer');
  L.innerHTML = `<div class="menuveil" data-mact="close"></div><div class="menu" role="menu" style="${pos}">${items.map((it, i) => `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-mi="${i}"><span class="mi">${it.icon}</span>${esc(it.label)}</button>`).join('')}</div>`;
  L.onclick = ev => { const b = ev.target.closest('[data-mi]'); const c = ev.target.closest('[data-mact]'); if (b) { closeLayer(); items[+b.dataset.mi].run(); } else if (c) closeLayer(); };
}
const topPos = side => `top:calc(env(safe-area-inset-top,0px) + 64px);${side}:max(16px,calc(50% - 264px))`;
let sheetCleanup = null;
function openSheet(html, onClick, onMount) {
  closeLayer();
  const L = $('#layer');
  L.innerHTML = `<div class="overlay" data-sact="backdrop"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  L.onclick = ev => { if (ev.target.dataset.sact === 'backdrop') { closeLayer(); return; } const b = ev.target.closest('[data-sact]'); if (b && b.dataset.sact === 'cancel') { closeLayer(); return; } if (b) onClick && onClick(b.dataset.sact, b, ev); };
  onMount && onMount(L);
}
function closeLayer() { if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; } const L = $('#layer'); L.innerHTML = ''; L.onclick = null; }
function confirmSheet(title, text, okLabel, fn) {
  openSheet(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="actions"><button data-sact="cancel">ביטול</button><button class="danger" data-sact="ok">${esc(okLabel)}</button></div>`,
    async a => { if (a === 'ok') { closeLayer(); await safe(fn); } });
}

/* product form */
function productForm(p) {
  const cats = sortedCats();
  const catId = p?.categoryId ?? sheetState.lastCat ?? cats[0]?.id ?? '';
  return `<label class="field">שם המוצר<input id="f-name" maxlength="60" value="${esc(p?.name || '')}" placeholder="למשל: חלב 3%" autocomplete="off"></label>
    <label class="field">קטגוריה<select id="f-cat">${cats.map(c => `<option value="${c.id}" ${c.id === catId ? 'selected' : ''}>${esc(c.emoji || '')} ${esc(c.name)}</option>`).join('')}<option value="__new">+ קטגוריה חדשה…</option></select></label>
    <div class="field">יחידת מידה<div class="seg" id="f-unit">${Object.entries(UNITS).map(([k, u]) => `<button type="button" data-sact="unit" data-u="${k}" class="${(p?.unit || sheetState.unit || 'unit') === k ? 'on' : ''}">${u.label}</button>`).join('')}</div></div>
    <div class="ferr" id="f-err" hidden></div>`;
}
function readProductForm(L) {
  const name = L.querySelector('#f-name').value.trim();
  const categoryId = L.querySelector('#f-cat').value;
  const unit = L.querySelector('#f-unit .on')?.dataset.u || 'unit';
  const err = L.querySelector('#f-err');
  if (!name) { err.textContent = 'כתבו שם למוצר.'; err.hidden = false; return null; }
  if (!categoryId || categoryId === '__new') { err.textContent = 'בחרו קטגוריה.'; err.hidden = false; return null; }
  return { name, categoryId, unit };
}
function wireProductForm(L, reopen) {
  L.querySelector('#f-cat').onchange = ev => { if (ev.target.value === '__new') categorySheet(null, id => { sheetState.lastCat = id; reopen(); }); };
}

function newProductSheet(ctx) {
  sheetState.tab = sheetState.tab || 'from';
  const isHome = ctx === 'home';
  if (!S.cats.length) { toast('קודם צרו קטגוריה'); categorySheet(null, () => newProductSheet(ctx)); return; }
  const reopen = () => newProductSheet(ctx);
  if (!isHome && sheetState.tab === 'from') {
    const inList = new Set(S.items.filter(i => i.listId === ctx).map(i => i.productId));
    const avail = S.prods.filter(p => p.scope === 'home' && !inList.has(p.id)).sort((a, b) => String(a.name).localeCompare(b.name, 'he'));
    const q = (sheetState.q || '').trim();
    const shown = avail.filter(p => !q || p.name.includes(q));
    openSheet(`<h3>הוספת מוצר לרשימה</h3><div class="tabs"><button data-sact="tab" data-t="from" class="on">מרשימת הבית</button><button data-sact="tab" data-t="new">מוצר חדש לאירוע</button></div>
      <label class="field"><span class="sr">חיפוש</span><input id="f-q" placeholder="חיפוש מוצר…" value="${esc(q)}" autocomplete="off"></label>
      ${shown.length ? `<ul class="pick">${shown.map(p => `<li><button data-sact="pick" data-pid="${p.id}"><span>${esc(p.name)}</span><small class="unit">${unitOf(p).label}</small><b>+</b></button></li>`).join('')}</ul>` : `<p>${avail.length ? 'לא נמצא מוצר בשם הזה.' : 'כל המוצרים של רשימת הבית כבר ברשימה.'}</p>`}
      <div class="actions"><button data-sact="cancel">סיום</button></div>`,
      async (a, b) => {
        if (a === 'tab') { sheetState.tab = b.dataset.t; reopen(); }
        if (a === 'pick') { const p = S.prods.find(x => x.id === b.dataset.pid); b.disabled = true; b.querySelector('b').textContent = '✓';
          await db.collection('listItems').add({ listId: ctx, productId: p.id, need: true, qty: unitOf(p).step, createdAt: nowIso() }); toast(`${p.name} נוסף`); }
      }, L => { const inp = L.querySelector('#f-q'); inp.oninput = () => { sheetState.q = inp.value; const pos = inp.selectionStart; reopen(); const n = $('#f-q'); n.focus(); n.setSelectionRange(pos, pos); }; });
    return;
  }
  openSheet(`<h3>${isHome ? 'מוצר חדש' : 'הוספת מוצר לרשימה'}</h3>
    ${isHome ? '' : `<div class="tabs"><button data-sact="tab" data-t="from">מרשימת הבית</button><button data-sact="tab" data-t="new" class="on">מוצר חדש לאירוע</button></div>`}
    ${productForm(null)}
    ${isHome ? '' : '<p>מוצר שנוצר כאן שייך רק לרשימה הזו ויימחק איתה.</p>'}
    <div class="actions"><button data-sact="cancel">סגירה</button><button class="primary" data-sact="save">הוספה</button></div>`,
    async (a, b) => {
      const L = $('#layer');
      if (a === 'tab') { sheetState.tab = b.dataset.t; reopen(); return; }
      if (a === 'unit') { L.querySelectorAll('#f-unit button').forEach(x => x.classList.toggle('on', x === b)); sheetState.unit = b.dataset.u; return; }
      if (a === 'save') {
        const f = readProductForm(L); if (!f) return;
        if (S.prods.some(p => p.scope === ctx && p.name === f.name)) { const err = L.querySelector('#f-err'); err.textContent = 'כבר יש מוצר בשם הזה ברשימה.'; err.hidden = false; return; }
        sheetState.lastCat = f.categoryId;
        const ref = await db.collection('products').add({ ...f, scope: ctx, need: false, qty: 0, photoCount: 0, createdAt: nowIso() });
        if (!isHome) await db.collection('listItems').add({ listId: ctx, productId: ref.id, need: true, qty: unitOf(f).step, createdAt: nowIso() });
        toast(`${f.name} נוסף`);
        const n = $('#f-name'); if (n) { n.value = ''; n.focus(); }
        L.querySelector('#f-err').hidden = true;
      }
    }, L => { wireProductForm(L, reopen); setTimeout(() => L.querySelector('#f-name')?.focus(), 50); });
}

/* product details: photos + edit */
function productSheet(pid) {
  const p = S.prods.find(x => x.id === pid); if (!p) return;
  let photos = [], un = null;
  const draw = () => { sheetCleanup = null; openSheet(`<h3>${esc(p.name)}</h3>
    <div class="photos" id="ph-grid">${photos.map((ph, i) => `<div class="ph"><button data-sact="view" data-i="${i}" style="width:100%;height:100%;padding:0" aria-label="הגדלת תמונה"><img src="${ph.data}" alt="${esc(p.name)}"></button><button class="x" data-sact="delph" data-i="${i}" aria-label="מחיקת תמונה">✕</button></div>`).join('')}
      <label class="addph"><b>+</b>${photos.length ? 'עוד תמונה' : 'הוספת תמונה'}<input type="file" accept="image/*" id="f-photo"></label></div>
    <div id="ph-status" class="legend" hidden></div>
    ${productForm(p)}
    <div class="actions"><button class="linkdanger" data-sact="delete">מחיקה</button><button data-sact="cancel">סגירה</button><button class="primary" data-sact="save">שמירה</button></div>`,
    async (a, b) => {
      const L = $('#layer');
      if (a === 'unit') { L.querySelectorAll('#f-unit button').forEach(x => x.classList.toggle('on', x === b)); return; }
      if (a === 'view') { const ph = photos[+b.dataset.i]; const v = document.createElement('div'); v.className = 'viewer'; v.innerHTML = `<img src="${ph.data}" alt="${esc(p.name)}">`; v.onclick = () => v.remove(); document.body.appendChild(v); return; }
      if (a === 'delph') { const ph = photos[+b.dataset.i]; batchRun((bt, d) => { bt.delete(d('photos/' + ph.id)); bt.update(d('products/' + pid), { photoCount: increment(-1) }); }); return; }
      if (a === 'save') { const f = readProductForm(L); if (!f) return; await db.doc('products/' + pid).update(f); closeLayer(); toast('נשמר'); return; }
      if (a === 'delete') deleteProduct(p);
    }, L => {
      wireProductForm(L, () => productSheet(pid));
      const fi = L.querySelector('#f-photo');
      fi.onchange = async () => {
        const file = fi.files[0]; if (!file) return;
        const st = L.querySelector('#ph-status'); st.hidden = false; st.textContent = 'מכין תמונה…';
        try {
          const data = await shrink(file);
          const id = db.collection('photos').newId();
          batchRun((bt, d) => { bt.set(d('photos/' + id), { productId: pid, data, createdAt: nowIso() }); bt.update(d('products/' + pid), { photoCount: increment(1) }); });
          st.hidden = true;
        } catch (e) { console.error(e); st.textContent = 'לא הצלחנו לקרוא את התמונה. נסו תמונה אחרת.'; }
      };
    }); sheetCleanup = un; };
  // live photos for this product while the sheet is open
  un = onSnapshot(query(collection(fs, 'photos'), where('productId', '==', pid)), snap => {
    photos = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const keep = { name: $('#f-name')?.value, cat: $('#f-cat')?.value, unit: $('#f-unit .on')?.dataset.u };
    if (!$('#ph-grid')) return;
    draw();
    if (keep.name != null) { $('#f-name').value = keep.name; $('#f-cat').value = keep.cat; $('#f-unit').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.u === keep.unit)); }
  }, () => {});
  draw();
}
async function shrink(file) {
  const url = URL.createObjectURL(file); const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  let max = 900, q = 0.72, out = '';
  for (let i = 0; i < 4; i++) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    if (out.length < 600000) break; // stay well under Firestore's 1 MB document limit
    max = Math.round(max * 0.75); q -= 0.1;
  }
  URL.revokeObjectURL(url);
  return out;
}
async function photoIdsFor(pids) {
  const ids = [];
  for (const pid of pids) { try { const s = await getDocs(query(collection(fs, 'photos'), where('productId', '==', pid))); s.forEach(d => ids.push(d.id)); } catch (e) {} }
  return ids;
}
function deleteProduct(p) {
  const inLists = S.items.filter(i => i.productId === p.id);
  confirmSheet(`למחוק את ${p.name}?`, p.scope === 'home' && inLists.length ? 'המוצר יימחק מרשימת הבית וגם מהרשימות לאירועים שהוא מופיע בהן.' : 'המוצר והתמונות שלו יימחקו.', 'מחיקה', async () => {
    batchRun((bt, d) => { inLists.forEach(i => bt.delete(d('listItems/' + i.id))); bt.delete(d('products/' + p.id)); });
    toast('המוצר נמחק');
    if (p.photoCount) { const ids = await photoIdsFor([p.id]); if (ids.length) batchRun((bt, d) => ids.forEach(id => bt.delete(d('photos/' + id)))); }
  });
}

/* category */
function categorySheet(cat, after) {
  let emoji = cat?.emoji || '🥬';
  openSheet(`<h3>${cat ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}</h3>
    <label class="field">שם הקטגוריה<input id="c-name" maxlength="40" value="${esc(cat?.name ?? '')}" placeholder="למשל: מוצרי חלב" autocomplete="off"></label>
    <div class="field">אמוג׳י<div class="emojis">${EMOJIS.map(e => `<button type="button" data-sact="emo" data-e="${e}" class="${e === emoji ? 'on' : ''}" aria-label="${e}">${e}</button>`).join('')}</div>
      <input id="c-emo" maxlength="4" value="${esc(emoji)}" aria-label="אמוג׳י אחר" style="width:80px;text-align:center;font-size:22px"></div>
    <div class="ferr" id="c-err" hidden></div>
    <div class="actions">${cat ? '<button class="linkdanger" data-sact="del">מחיקה</button>' : ''}<button data-sact="cancel">ביטול</button><button class="primary" data-sact="save">${cat ? 'שמירה' : 'יצירה'}</button></div>`,
    async (a, b) => {
      const L = $('#layer');
      if (a === 'emo') { emoji = b.dataset.e; L.querySelectorAll('.emojis button').forEach(x => x.classList.toggle('on', x === b)); L.querySelector('#c-emo').value = emoji; return; }
      if (a === 'save') {
        const name = L.querySelector('#c-name').value.trim(); emoji = L.querySelector('#c-emo').value.trim() || emoji;
        const err = L.querySelector('#c-err');
        if (!name) { err.textContent = 'כתבו שם לקטגוריה.'; err.hidden = false; return; }
        if (S.cats.some(c => c.name === name && c.id !== cat?.id)) { err.textContent = 'כבר יש קטגוריה בשם הזה.'; err.hidden = false; return; }
        let id = cat?.id;
        if (cat) await db.doc('categories/' + cat.id).update({ name, emoji });
        else { const order = Math.max(0, ...S.cats.map(c => c.order || 0)) + 1; const ref = await db.collection('categories').add({ name, emoji, order }); id = ref.id; }
        closeLayer(); toast(cat ? 'נשמר' : `הקטגוריה ${name} נוצרה`); after && after(id); return;
      }
      if (a === 'del') {
        const n = S.prods.filter(p => p.categoryId === cat.id).length;
        confirmSheet(`למחוק את ${cat.name}?`, n ? `${n} מוצרים בקטגוריה יעברו ל"ללא קטגוריה". אפשר לשייך אותם מחדש בלחיצה על שם המוצר.` : 'הקטגוריה ריקה.', 'מחיקה', async () => {
          await db.doc('categories/' + cat.id).delete(); toast('הקטגוריה נמחקה'); });
      }
    }, L => { setTimeout(() => { if (!cat) L.querySelector('#c-name')?.focus(); }, 50); L.querySelector('#c-emo').oninput = ev => { emoji = ev.target.value; }; });
}

/* lists */
function newListSheet() {
  openSheet(`<h3>רשימה חדשה</h3><p>רשימה לאירוע מיוחד. אחרי שתסמנו שהקנייה בוצעה ותזינו מחיר, היא תימחק.</p>
    <label class="field">שם הרשימה<input id="l-name" maxlength="50" placeholder="למשל: ארוחת שישי אצלנו" autocomplete="off"></label><div class="ferr" id="l-err" hidden></div>
    <div class="actions"><button data-sact="cancel">ביטול</button><button class="primary" data-sact="save">יצירה</button></div>`,
    async a => { if (a !== 'save') return; const L = $('#layer'); const name = L.querySelector('#l-name').value.trim();
      if (!name) { const e = L.querySelector('#l-err'); e.textContent = 'כתבו שם לרשימה.'; e.hidden = false; return; }
      const ref = await db.collection('lists').add({ name, createdAt: nowIso() }); closeLayer();
      sheetState = {}; go({ screen: 'list', id: ref.id, edit: true });
    }, L => setTimeout(() => L.querySelector('#l-name')?.focus(), 50));
}
function renameListSheet(L0) {
  openSheet(`<h3>שינוי שם</h3><label class="field">שם הרשימה<input id="l-name" maxlength="50" value="${esc(L0.name)}"></label>
    <div class="actions"><button data-sact="cancel">ביטול</button><button class="primary" data-sact="save">שמירה</button></div>`,
    async a => { if (a !== 'save') return; const name = $('#l-name').value.trim(); if (!name) return; await db.doc('lists/' + L0.id).update({ name }); closeLayer(); });
}
async function deleteList(id) {
  const own = S.prods.filter(p => p.scope === id);
  const items = S.items.filter(i => i.listId === id);
  batchRun((bt, d) => { items.forEach(i => bt.delete(d('listItems/' + i.id))); own.forEach(p => bt.delete(d('products/' + p.id))); bt.delete(d('lists/' + id)); });
  const withPhotos = own.filter(p => p.photoCount).map(p => p.id);
  if (withPhotos.length) { const ids = await photoIdsFor(withPhotos); if (ids.length) batchRun((bt, d) => ids.forEach(x => bt.delete(d('photos/' + x)))); }
}

/* purchase */
function priceSheet(kind, entries) {
  pending = { kind, entries, listId: R.id };
  const isHome = R.id === 'home';
  const note = kind === 'full' ? (isHome ? 'כל המוצרים יסומנו כקיימים בבית.' : 'הרשימה תימחק אחרי השמירה.') : 'המוצרים שסימנתם יסומנו כנקנו.';
  openSheet(`<h3>${kind === 'full' ? 'בוצעה קנייה מלאה' : 'בוצעה קנייה חלקית'}</h3><p>${entries.length} מוצרים. ${note}</p>
    <label class="field">כמה שילמתם?<div class="money"><input id="p-price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0"><span>₪</span></div></label>
    <div class="ferr" id="p-err" hidden></div>
    <div class="actions"><button data-sact="cancel">ביטול</button><button class="primary" data-sact="save">שמירה</button></div>`,
    async (a, b) => {
      if (a !== 'save') return;
      const v = $('#p-price').value.trim(); const price = Number(v);
      if (v === '' || !isFinite(price) || price < 0) { const e = $('#p-err'); e.textContent = 'הזינו את סכום הקנייה.'; e.hidden = false; return; }
      b.disabled = true; closeLayer(); finishPurchase(price);
    }, L => setTimeout(() => L.querySelector('#p-price')?.focus(), 80));
}
function finishPurchase(price) {
  const { kind, entries, listId } = pending; pending = null;
  const isHome = listId === 'home'; const L = S.lists.find(l => l.id === listId);
  const pid = db.collection('purchases').newId();
  const rec = { date: nowIso(), list: isHome ? 'רשימת הבית' : (L?.name || 'רשימה'), kind, price, by: user?.email || '', sheetSynced: false,
    items: entries.map(e => ({ name: e.p.name, qty: e.qty, unit: e.p.unit || 'unit' })) };
  if (!isHome && kind === 'full') {
    db.doc('purchases/' + pid).set(rec);
    deleteList(listId); go({ screen: 'home' }); toast('הקנייה נרשמה והרשימה נמחקה');
  } else {
    batchRun((bt, d) => { bt.set(d('purchases/' + pid), rec); entries.forEach(e => bt.update(d(e.path), { need: false, qty: 0 })); });
    R.partial = false; R.picked = new Set(); if (kind === 'full') R.shop = false;
    render(); toast('הקנייה נרשמה');
  }
  setTimeout(syncSheet, 600);
}

/* Google Sheets sync — each purchase is posted once; the script ignores ids it already has */
let syncing = false;
async function postToSheet(url, body) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) }); // text/plain, no preflight
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'sheet error');
  return j;
}
async function syncSheet() {
  const url = sheetUrl(); if (!url || syncing || !navigator.onLine) return;
  const todo = S.purch.filter(p => !p.sheetSynced && p.date); if (!todo.length) return;
  syncing = true;
  try {
    for (const p of todo.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      await postToSheet(url, { id: p.id, date: p.date, list: p.list, kind: p.kind === 'partial' ? 'חלקית' : 'מלאה', price: Number(p.price) || 0,
        count: (p.items || []).length, items: itemsText(p.items), by: p.by || '' });
      updateDoc(doc(fs, 'purchases/' + p.id), { sheetSynced: true }).catch(() => {});
    }
  } catch (e) { console.warn('sheet sync failed', e); }
  finally { syncing = false; }
}

/* reminder (.ics added to the iPhone calendar) */
function reminderSheet() {
  const r = reminder(); let every = r.every || 1, day = r.day ?? 5, time = r.time || '19:00';
  const draw = () => openSheet(`<h3>תזכורת לרשימת קניות</h3><p>התזכורת נוספת ליומן באייפון ומקפיצה התראה ביום ובשעה שבחרתם. כל אחד מכם מוסיף אותה ליומן שלו.</p>
    <div class="field">תדירות<div class="seg">${[1, 2].map(n => `<button data-sact="every" data-n="${n}" class="${every == n ? 'on' : ''}">${n == 1 ? 'כל שבוע' : 'כל שבועיים'}</button>`).join('')}</div></div>
    <div class="field">יום<div class="seg">${DAYS.map((d, i) => `<button data-sact="day" data-i="${i}" class="${day == i ? 'on' : ''}" aria-label="${d}">${d.slice(0, 1)}׳</button>`).join('')}</div></div>
    <label class="field">שעה<input id="r-time" type="time" value="${esc(time)}"></label>
    <p style="font-size:14px">אם הקובץ לא נפתח מהאפליקציה, פתחו את האתר בספארי ולחצו שוב.</p>
    <div class="actions"><button data-sact="cancel">ביטול</button><button class="primary" data-sact="save">הוספה ליומן</button></div>`,
    async (a, b) => {
      if (a === 'every') { every = +b.dataset.n; time = $('#r-time').value || time; draw(); return; }
      if (a === 'day') { day = +b.dataset.i; time = $('#r-time').value || time; draw(); return; }
      if (a === 'save') {
        time = $('#r-time').value || '19:00';
        db.doc('settings/reminder').set({ every, day, time, updatedAt: nowIso() });
        const ics = buildIcs(every, day, time);
        closeLayer();
        const a2 = document.createElement('a');
        a2.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
        a2.download = 'shopping-reminder.ics';
        document.body.appendChild(a2); a2.click(); a2.remove();
      }
    });
  draw();
}
function buildIcs(every, day, time) {
  const [hh, mm] = time.split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  let add = (day - d.getDay() + 7) % 7; if (add === 0 && d < new Date()) add = 7; d.setDate(d.getDate() + add);
  const p = n => String(n).padStart(2, '0');
  const loc = x => `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}T${p(x.getHours())}${p(x.getMinutes())}00`;
  const end = new Date(d.getTime() + 15 * 60000);
  const n = new Date(); const stamp = `${n.getUTCFullYear()}${p(n.getUTCMonth() + 1)}${p(n.getUTCDate())}T${p(n.getUTCHours())}${p(n.getUTCMinutes())}00Z`;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Our Shopping//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:shopping-reminder-${Date.now()}@our-shopping`, `DTSTAMP:${stamp}`, `DTSTART:${loc(d)}`, `DTEND:${loc(end)}`,
    `RRULE:FREQ=WEEKLY;INTERVAL=${every};BYDAY=${DAYCODES[day]}`, 'SUMMARY:🛒 להכין רשימת קניות', 'DESCRIPTION:לעבור על רשימת הבית ולסמן מה חסר',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:להכין רשימת קניות', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

/* xlsx export (backup; the live record is the Google Sheet) */
async function saveFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportXlsx() {
  if (!window.XLSX) { toast('רכיב האקסל לא נטען. בדקו חיבור ונסו שוב.'); return; }
  const P = [...S.purch].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rows = P.map(p => { const d = new Date(p.date); return { 'תאריך': d.toLocaleDateString('he-IL'), 'שעה': d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }), 'רשימה': p.list, 'סוג קנייה': p.kind === 'partial' ? 'חלקית' : 'מלאה', 'סכום (₪)': Number(p.price) || 0, 'מספר מוצרים': (p.items || []).length, 'מוצרים': itemsText(p.items), 'נרשם ע״י': p.by || '' }; });
  const m = {}; P.forEach(p => { const d = new Date(p.date); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; m[k] = m[k] || { 'חודש': k, 'מספר קניות': 0, 'סה״כ (₪)': 0 }; m[k]['מספר קניות']++; m[k]['סה״כ (₪)'] += Number(p.price) || 0; });
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(rows); ws1['!cols'] = [{ wch: 12 }, { wch: 7 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 60 }, { wch: 24 }];
  const ws2 = XLSX.utils.json_to_sheet(Object.values(m)); ws2['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'קניות'); XLSX.utils.book_append_sheet(wb, ws2, 'סיכום חודשי');
  wb.Workbook = { Views: [{ RTL: true }] };
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  await saveFile(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `shopping-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ---------- events ---------- */
document.addEventListener('click', async ev => {
  const b = ev.target.closest('#app [data-act]'); if (!b) return;
  const a = b.dataset.act;
  switch (a) {
    case 'plus': openMenu([
      { icon: '🥫', label: 'מוצר', run: () => { sheetState = {}; newProductSheet('home'); } },
      { icon: '📝', label: 'רשימה חדשה', run: newListSheet },
      { icon: '🏷️', label: 'קטגוריה חדשה', run: () => { sheetState = {}; categorySheet(null); } }], topPos('left')); break;
    case 'open': go({ screen: 'list', id: b.dataset.id }); break;
    case 'home': go({ screen: 'home' }); break;
    case 'history': go({ screen: 'history' }); syncSheet(); break;
    case 'settings': go({ screen: 'settings' }); break;
    case 'edit': R.edit = !R.edit; render(); break;
    case 'shop': go({ screen: 'list', id: R.id, shop: true }); break;
    case 'unshop': go({ screen: 'list', id: R.id }); break;
    case 'addprod': sheetState = { tab: 'from' }; newProductSheet(R.id); break;
    case 'prod': productSheet(b.dataset.pid); break;
    case 'editcat': sheetState = {}; categorySheet(S.cats.find(c => c.id === b.dataset.cid)); break;
    case 'rm': { const e = findEntry(b.dataset.key); if (!e) break;
      if (R.id === 'home') deleteProduct(e.p);
      else if (e.p.scope === R.id) confirmSheet(`להסיר את ${e.p.name}?`, 'זה מוצר של הרשימה הזו בלבד, והוא יימחק.', 'הסרה', async () => {
        batchRun((bt, d) => { bt.delete(d(e.path)); bt.delete(d('products/' + e.p.id)); });
        if (e.p.photoCount) { const ids = await photoIdsFor([e.p.id]); if (ids.length) batchRun((bt, d) => ids.forEach(x => bt.delete(d('photos/' + x)))); } });
      else db.doc(e.path).delete();
      break; }
    case 'inc': case 'dec': { const e = findEntry(b.dataset.key); if (!e) break; const st = unitOf(e.p).step; let q = Math.round((e.qty + (a === 'inc' ? st : -st)) * 100) / 100; if (q <= 0) q = st;
      db.doc(e.path).update({ qty: q }); break; }
    case 'checkmenu': { const E = entriesFor(R.id).filter(e => e.need); openMenu([
      { icon: '✅', label: 'בוצעה קנייה מלאה', run: () => priceSheet('full', E) },
      { icon: '☑️', label: 'בוצעה קנייה חלקית', run: () => { R.partial = true; R.picked = new Set(); render(); } }], topPos('right')); break; }
    case 'partialback': R.partial = false; R.picked = new Set(); render(); break;
    case 'partialdone': { const E = entriesFor(R.id).filter(e => e.need && R.picked?.has(e.key)); if (E.length) priceSheet('partial', E); break; }
    case 'listmenu': { const L = S.lists.find(l => l.id === R.id); if (!L) break; openMenu([
      { icon: '✎', label: 'שינוי שם', run: () => renameListSheet(L) },
      { icon: '🗑️', label: 'מחיקת הרשימה', danger: true, run: () => confirmSheet(`למחוק את ${L.name}?`, 'הרשימה והמוצרים שנוצרו במיוחד בשבילה יימחקו. מוצרי רשימת הבית לא ייפגעו.', 'מחיקה', async () => { await deleteList(L.id); go({ screen: 'home' }); toast('הרשימה נמחקה'); }) }], topPos('left')); break; }
    case 'reminder': reminderSheet(); break;
    case 'export': exportXlsx(); break;
    case 'delpurch': { const p = S.purch.find(x => x.id === b.dataset.id); if (p) confirmSheet('למחוק את הרשומה?', `${p.list} · ${fmtMoney(p.price)}. השורה בגיליון לא תימחק.`, 'מחיקה', () => db.doc('purchases/' + p.id).delete()); break; }
    case 'savesheet': case 'testsheet': {
      const url = $('#s-url').value.trim(), link = $('#s-link').value.trim();
      const err = $('#s-err'), ok = $('#s-ok'); err.hidden = ok.hidden = true;
      if (url && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) { err.textContent = 'הכתובת צריכה להתחיל ב-https://script.google.com/macros/s/ ולהסתיים ב-/exec'; err.hidden = false; break; }
      if (a === 'testsheet') {
        if (!url) { err.textContent = 'הדביקו קודם את הכתובת.'; err.hidden = false; break; }
        b.disabled = true; b.textContent = 'בודק…';
        try { await postToSheet(url, { ping: true }); ok.textContent = 'החיבור לגיליון עובד.'; ok.hidden = false; }
        catch (e) { err.textContent = 'החיבור נכשל. ודאו שה-Web app פורסם עם גישה "Anyone" ושהעתקתם את כתובת ה-/exec.'; err.hidden = false; }
        b.disabled = false; b.textContent = 'בדיקת חיבור'; break;
      }
      db.doc('settings/sheet').set({ url, link, updatedAt: nowIso() }); ok.textContent = 'נשמר. קניות שעוד לא נרשמו יישלחו לגיליון עכשיו.'; ok.hidden = false;
      setTimeout(syncSheet, 800); break; }
    case 'logout': unsubs.forEach(u => u()); unsubs = []; await signOut(auth); break;
    case 'reset': { const email = $('#li-email')?.value.trim(); const err = $('#li-err'), ok = $('#li-ok'); err.hidden = ok.hidden = true;
      if (!email) { err.textContent = 'כתבו את המייל ואז לחצו שוב.'; err.hidden = false; break; }
      try { await sendPasswordResetEmail(auth, email); ok.textContent = 'נשלח מייל לאיפוס סיסמה.'; ok.hidden = false; } catch (e) { err.textContent = 'לא הצלחנו לשלוח. בדקו את המייל.'; err.hidden = false; }
      break; }
  }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.classList.contains('needbox')) {
    const e = findEntry(t.dataset.key); if (!e) return;
    db.doc(e.path).update(t.checked ? { need: true, qty: e.qty || unitOf(e.p).step } : { need: false, qty: 0 });
  }
  if (t.classList.contains('qtyin')) {
    const e = findEntry(t.dataset.key); if (!e) return; let q = Number(t.value); if (!isFinite(q) || q <= 0) q = unitOf(e.p).step;
    db.doc(e.path).update({ qty: q });
  }
  if (t.classList.contains('pickbox')) { const k = t.dataset.key; R.picked = R.picked || new Set(); t.checked ? R.picked.add(k) : R.picked.delete(k); render(); }
});
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'loginForm') return;
  ev.preventDefault();
  const email = $('#li-email').value.trim(), pass = $('#li-pass').value; const err = $('#li-err'); err.hidden = true;
  const btn = $('#li-btn'); btn.disabled = true; btn.textContent = 'מתחבר…';
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (e) { err.textContent = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(e.code) ? 'המייל או הסיסמה לא נכונים.' : 'ההתחברות נכשלה. בדקו חיבור לאינטרנט.'; err.hidden = false; btn.disabled = false; btn.textContent = 'התחברות'; }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && $('#layer').innerHTML) closeLayer(); });
window.addEventListener('online', () => { online = true; render(); syncSheet(); });
window.addEventListener('offline', () => { online = false; render(); });

/* ---------- data ---------- */
function maybeSeed(snapMeta) {
  if (snapMeta.fromCache || S.settings.meta?.seeded || S.cats.length || S.prods.length) return;
  batchRun((bt, d) => {
    SEED_CATS.forEach(([id, name, emoji], i) => bt.set(d('categories/' + id), { name, emoji, order: i + 1 }));
    SEED_PRODS.forEach(([id, name, categoryId, unit]) => bt.set(d('products/' + id), { name, categoryId, unit, scope: 'home', need: false, qty: 0, photoCount: 0, createdAt: nowIso() }));
    bt.set(d('settings/meta'), { seeded: true, at: nowIso() });
  });
}
function startData() {
  status = 'loading'; render();
  Object.keys(loaded).forEach(k => loaded[k] = false);
  let firstServer = { cats: false, settings: false };
  const sub = (key, coll, map) => unsubs.push(onSnapshot(collection(fs, coll), { includeMetadataChanges: false }, snap => {
    if (map) map(snap); else S[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    loaded[key] = true;
    if (Object.values(loaded).every(Boolean) && status === 'loading') status = 'ready';
    if ((key === 'cats' || key === 'settings') && !snap.metadata.fromCache) firstServer[key] = true;
    if (firstServer.cats && firstServer.settings && !firstServer.done) { firstServer.done = true; maybeSeed(snap.metadata); }
    if (key === 'purch' || key === 'settings') { clearTimeout(startData._s); startData._s = setTimeout(syncSheet, 1500); }
    const ae = document.activeElement;
    const typing = ae && ae.closest('#app') && ae.matches('input:not([type]),input[type=text],input[type=number],input[type=url],input[type=email],input[type=search]');
    if (!typing) render();
  }, err => {
    status = 'error';
    errMsg = err?.code === 'permission-denied' ? 'אין הרשאה לקרוא את הנתונים. ודאו שהמייל שלכם מופיע בכללי Firestore.' : 'לא הצלחנו לטעון את הנתונים. בדקו חיבור ורעננו.';
    render();
  }));
  sub('cats', 'categories'); sub('prods', 'products'); sub('lists', 'lists'); sub('items', 'listItems'); sub('purch', 'purchases');
  sub('settings', 'settings', snap => { const o = {}; snap.docs.forEach(d => o[d.id] = d.data()); S.settings = o; });
}

/* ---------- boot ---------- */
(function boot() {
  if (!firebaseConfig || String(firebaseConfig.apiKey || '').startsWith('PASTE')) { status = 'config'; render(); return; }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { fs = initializeFirestore(app, {}); }
  onAuthStateChanged(auth, u => {
    unsubs.forEach(x => x()); unsubs = [];
    user = u;
    if (!u) { status = 'signedout'; R = { screen: 'home' }; closeLayer(); render(); return; }
    R = { screen: 'home' }; startData();
  });
})();
