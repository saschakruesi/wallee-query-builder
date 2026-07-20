// Minimaler DOM-Ersatz fuer Tests, die tatsaechlich gerenderte Struktur oder
// Interaktion pruefen wollen.
//
// Der No-Op-Stub in test/harness.js verhindert nur, dass das Script beim Laden
// stolpert - er behaelt weder Kinder noch Text und wuerde jeden Renderfehler
// verschlucken. Dieser Ersatz merkt sich Kinder, Textinhalte, Klassen und
// Event-Handler, sodass Tests eine Eingabe ausloesen und das Ergebnis auslesen
// koennen. Bewusst kein jsdom: das Projekt bleibt ohne npm-Abhaengigkeiten.

// --- Minimaler DOM ---------------------------------------------------------

function makeNode(tagName) {
  const node = {
    tagName: String(tagName || '').toUpperCase(),
    children: [],
    _text: '',
    className: '',
    style: {},
    dataset: {},
    attributes: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) { if (on === undefined) on = !this._set.has(c); on ? this._set.add(c) : this._set.delete(c); },
    },
    appendChild(kind) { node.children.push(kind); return kind; },
    removeChild(kind) {
      const i = node.children.indexOf(kind);
      if (i >= 0) node.children.splice(i, 1);
      return kind;
    },
    _listeners: {},
    addEventListener(typ, fn) {
      (node._listeners[typ] = node._listeners[typ] || []).push(fn);
    },
    removeEventListener(typ, fn) {
      const l = node._listeners[typ];
      if (l) node._listeners[typ] = l.filter(x => x !== fn);
    },
    // Loest die registrierten Handler aus, damit Tests eine Eingabe simulieren
    // koennen (der Report soll auf Aenderungen reaktiv neu rechnen).
    dispatch(typ, event) {
      (node._listeners[typ] || []).forEach(fn => fn(event || { preventDefault() {} }));
    },
    setAttribute(k, v) { node.attributes[k] = v; },
    getAttribute(k) { return k in node.attributes ? node.attributes[k] : null; },
    removeAttribute(k) { delete node.attributes[k]; },
    focus() {}, blur() {}, select() {}, click() {}, closest() { return null; },
    querySelector(sel) { return finde(node, sel); },
    querySelectorAll() { return []; },
  };

  Object.defineProperty(node, 'textContent', {
    get() {
      if (node.children.length) return node.children.map(k => k.textContent).join('');
      return node._text;
    },
    set(v) { node._text = String(v); node.children.length = 0; },
  });

  Object.defineProperty(node, 'innerHTML', {
    get() { return node._html || ''; },
    // Im Report wird innerHTML nur zum Leeren benutzt ('').
    set(v) { node._html = String(v); if (v === '') node.children.length = 0; },
  });

  return node;
}

// Reicht fuer das eine Muster, das der Report braucht: querySelector('tbody').
function finde(wurzel, sel) {
  const gesucht = String(sel).toUpperCase();
  for (const kind of wurzel.children) {
    if (kind.tagName === gesucht) return kind;
    const treffer = finde(kind, sel);
    if (treffer) return treffer;
  }
  return null;
}

function makeDocument() {
  const nachId = new Map();
  const body = makeNode('body');
  return {
    body,
    getElementById(id) {
      if (!nachId.has(id)) nachId.set(id, makeNode('div'));
      return nachId.get(id);
    },
    createElement(tag) { return makeNode(tag); },
    querySelector() { return makeNode('div'); },
    querySelectorAll() { return []; },
    createRange: () => ({ selectNodeContents() {} }),
    addEventListener() {},
  };
}

// Sammelt alle Knoten eines Tags unterhalb von wurzel.
function alleTags(wurzel, tag) {
  const gesucht = tag.toUpperCase();
  const treffer = [];
  (function lauf(n) {
    n.children.forEach(k => {
      if (k.tagName === gesucht) treffer.push(k);
      lauf(k);
    });
  })(wurzel);
  return treffer;
}

module.exports = { makeNode, makeDocument, alleTags };
