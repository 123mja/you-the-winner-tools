/* calculator.js
   Extracted from my-daily-tools.html's inline classic <script> block
   (2026-08-14) — the calculator was already fully self-contained (only
   localStorage + its own local state, no Firebase/UP/shared-state
   dependency), so this is a plain <script src> file, not a module; every
   window.calc..., openCalcDialog, closeCalcDialog exports below work exactly
   as they did inline. Content is unchanged, just moved.

   Restored 2026-08-30: this file had gone missing from the repo entirely
   (my-daily-tools.html's <script src="calculator.js"> 404'd in production),
   despite the comment above saying it was extracted rather than deleted.
   Recovered verbatim from a still-live stale copy being served by
   tools.you-the-winner.com's CDN edge (which had this exact file cached
   from before it disappeared, discovered while chasing an unrelated
   Netlify cache-staleness issue on that domain) -- this is the original
   file's real content, not a reconstruction.
*/

/* ── CALCULATOR ── */
// A basic calculator with a running history log — the log matters for
// accessibility here: someone who needs a calculator for daily math may also
// need to look back and check what they just did, rather than relying on
// remembering it. History persists in localStorage (device-local, not synced
// to Firebase — it's a personal scratch tool, not app data) capped at the 20
// most recent operations.
var _calcCurrent = '0';
var _calcPrevValue = null;
var _calcPendingOp = null;
var _calcStartNew = false; // true right after "=" or an operator — next digit starts fresh instead of appending
var CALC_HISTORY_KEY = 'dt-calc-history';

function _calcGetHistory() {
  try { return JSON.parse(localStorage.getItem(CALC_HISTORY_KEY) || '[]'); } catch(e) { return []; }
}
function _calcSaveHistory(list) {
  try { localStorage.setItem(CALC_HISTORY_KEY, JSON.stringify(list.slice(-20))); } catch(e) {}
}
function _calcRenderHistory() {
  var el = document.getElementById('calc-history-list');
  if (!el) return;
  var list = _calcGetHistory();
  if (!list.length) {
    el.innerHTML = '<div style="color:var(--muted);padding:6px 0;">No calculations yet.</div>';
    return;
  }
  el.innerHTML = list.slice().reverse().map(function(h) {
    return '<div style="padding:5px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;">'
      + '<span style="color:var(--muted);">' + h.expr + '</span>'
      + '<span style="font-weight:700;">= ' + h.result + '</span></div>';
  }).join('');
}
function _calcUpdateDisplay() {
  var el = document.getElementById('calc-display');
  if (el) el.textContent = _calcCurrent;
}
window.openCalcDialog = function() {
  var ov = document.getElementById('calc-dialog-overlay');
  if (ov) ov.style.display = 'flex';
  _calcRenderHistory();
};
window.closeCalcDialog = function() {
  var ov = document.getElementById('calc-dialog-overlay');
  if (ov) ov.style.display = 'none';
};
window.calcDigit = function(d) {
  if (_calcStartNew) { _calcCurrent = '0'; _calcStartNew = false; }
  if (d === '.' && _calcCurrent.includes('.')) return;
  _calcCurrent = (_calcCurrent === '0' && d !== '.') ? d : _calcCurrent + d;
  _calcUpdateDisplay();
};
window.calcBackspace = function() {
  _calcCurrent = _calcCurrent.length > 1 ? _calcCurrent.slice(0, -1) : '0';
  _calcUpdateDisplay();
};
window.calcClear = function() {
  _calcCurrent = '0'; _calcPrevValue = null; _calcPendingOp = null; _calcStartNew = false;
  _calcUpdateDisplay();
};
function _calcApply(a, b, op) {
  a = parseFloat(a); b = parseFloat(b);
  if (op === '+') return a + b;
  if (op === '−') return a - b;
  if (op === '×') return a * b;
  if (op === '÷') return b === 0 ? NaN : a / b;
  return b;
}
function _calcRound(n) {
  // Trim float drift (0.1+0.2 etc.) without over-truncating real decimals.
  return Math.round(n * 1e10) / 1e10;
}
window.calcOp = function(op) {
  if (_calcPendingOp && !_calcStartNew) {
    var result = _calcRound(_calcApply(_calcPrevValue, _calcCurrent, _calcPendingOp));
    _calcPrevValue = String(result);
    _calcCurrent = String(result);
  } else {
    _calcPrevValue = _calcCurrent;
  }
  _calcPendingOp = op;
  _calcStartNew = true;
  _calcUpdateDisplay();
};
window.calcEquals = function() {
  if (!_calcPendingOp || _calcPrevValue === null) return;
  var expr = _calcPrevValue + ' ' + _calcPendingOp + ' ' + _calcCurrent;
  var result = _calcRound(_calcApply(_calcPrevValue, _calcCurrent, _calcPendingOp));
  var resultStr = isNaN(result) ? 'Error' : String(result);
  _calcCurrent = resultStr;
  _calcUpdateDisplay();
  if (!isNaN(result)) {
    var list = _calcGetHistory();
    list.push({ expr: expr, result: resultStr, ts: Date.now() });
    _calcSaveHistory(list);
    _calcRenderHistory();
  }
  _calcPendingOp = null;
  _calcPrevValue = null;
  _calcStartNew = true;
};
window.calcClearHistory = function() {
  if (!confirm('Clear the calculator history?')) return;
  _calcSaveHistory([]);
  _calcRenderHistory();
};
