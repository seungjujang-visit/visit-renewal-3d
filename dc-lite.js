/*
 * dc-lite — a tiny stand-in for the design canvas runtime, so the artboards
 * exported from the canvas (.dc.html markup) run as plain static pages.
 * Supports: {{ holes }}, <sc-if>, <sc-for>, on* handlers, ref, <helmet>,
 * and a DCLogic base class with props / state / setState.
 */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      this.state = Object.assign({}, this.state, typeof patch === 'function' ? patch(this.state) : patch);
      if (this.__render) this.__render();
    }
    forceUpdate() { if (this.__render) this.__render(); }
  }

  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    let v = scope;
    for (const key of path.split('.')) {
      if (v == null) return undefined;
      v = v[key];
    }
    return v;
  }

  function text(str, scope) {
    return str.replace(HOLE, (m, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); });
  }

  function build(node, scope, out, refs) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(text(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();

    if (tag === 'sc-if') {
      const m = WHOLE.exec(node.getAttribute('value') || '');
      if (m && lookup(m[1], scope)) node.childNodes.forEach((c) => build(c, scope, out, refs));
      return;
    }
    if (tag === 'sc-for') {
      const m = WHOLE.exec(node.getAttribute('list') || '');
      const list = (m && lookup(m[1], scope)) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, i) => {
        const inner = Object.create(scope);
        inner[as] = item; inner.$index = i;
        node.childNodes.forEach((c) => build(c, inner, out, refs));
      });
      return;
    }

    const el = node.namespaceURI === 'http://www.w3.org/1999/xhtml'
      ? document.createElement(tag)
      : document.createElementNS(node.namespaceURI, node.tagName);
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name, raw = attr.value, m = WHOLE.exec(raw);
      if (name.startsWith('hint-')) continue;
      if (/^on[a-z]/.test(name)) {
        const fn = m && lookup(m[1], scope);
        if (typeof fn === 'function') el.addEventListener(name.slice(2).toLowerCase(), fn, name === 'onwheel' ? { passive: true } : undefined);
        continue;
      }
      if (name === 'ref') { const fn = m && lookup(m[1], scope); if (typeof fn === 'function') refs.push([fn, el]); continue; }
      if (m) {
        const v = lookup(m[1], scope);
        if (v === false || v == null) continue;
        el.setAttribute(name, v === true ? '' : String(v));
      } else {
        el.setAttribute(name, text(raw, scope));
      }
    }
    node.childNodes.forEach((c) => build(c, scope, el, refs));
    out.appendChild(el);
  }

  function mount() {
    const host = document.querySelector('x-dc');
    const script = document.querySelector('script[data-dc-script]');
    if (!host || !script) return;

    const helmet = host.querySelector('helmet');
    if (helmet) { Array.from(helmet.children).forEach((c) => document.head.appendChild(c)); helmet.remove(); }

    const template = document.createDocumentFragment();
    while (host.firstChild) template.appendChild(host.firstChild);
    host.style.display = 'block';

    let decl = {};
    try { decl = JSON.parse(script.getAttribute('data-props') || '{}'); } catch (e) { decl = {}; }
    const props = {};
    Object.keys(decl).forEach((k) => { if (k[0] !== '$' && decl[k] && 'default' in decl[k]) props[k] = decl[k].default; });
    // ?accent=FF5A1F style overrides for quick comparisons
    new URLSearchParams(location.search).forEach((v, k) => {
      if (k in props) props[k] = typeof props[k] === 'number' ? Number(v) : typeof props[k] === 'boolean' ? v !== 'false' : (k === 'accent' && v[0] !== '#' ? '#' + v : v);
    });

    const Component = new Function('DCLogic', script.textContent + '\nreturn Component;')(DCLogic);
    const logic = new Component(props);
    logic.props = props;

    const kept = {};
    logic.__render = function () {
      const frag = document.createDocumentFragment();
      const refs = [];
      template.childNodes.forEach((c) => build(c, logic.renderVals(), frag, refs));
      // keep canvases alive across re-renders so the 3D scene never restarts
      frag.querySelectorAll('canvas[data-stage]').forEach((cv) => {
        const id = cv.getAttribute('data-stage');
        if (kept[id]) cv.replaceWith(kept[id]); else kept[id] = cv;
      });
      host.replaceChildren(frag);
      refs.forEach(([fn, el]) => fn(el.tagName === 'CANVAS' && el.getAttribute('data-stage') ? kept[el.getAttribute('data-stage')] : el));
    };
    logic.__render();
    if (logic.componentDidMount) logic.componentDidMount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
