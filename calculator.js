/**
 * calculator.js — simple four-function calculator dialog + running history,
 * used by the "🧮 Calculator" button on the Money tab of my-daily-tools.html
 * (see #calc-dialog-overlay there).
 *
 * Recreated 2026-08-30: this file was missing entirely from the deployed
 * site (my-daily-tools.html's <script src="calculator.js"> 404'd in
 * production -- reported live on Calm Corner's console, which loads the
 * same script) even though my-daily-tools.html's own comment says it was
 * "extracted 2026-08-14 into its own file." Rebuilt from the button wiring
 * still present in that file's calculator dialog markup (onclick=
 * calcDigit/calcOp/calcEquals/calcClear/calcBackspace/calcClearHistory,
 * plus openCalcDialog/closeCalcDialog on the trigger button and overlay),
 * which is the only surviving record of its exact API -- so every function
 * name here is load-bearing, not just a convenient choice.
 *
 * Plain classic script (no import/export), loaded directly so its
 * window.calc... / openCalcDialog / closeCalcDialog exports are ready before
 * anything could call them.
 */
(function () {
  'use strict';

  var HISTORY_KEY = 'calc-history';
  var HISTORY_MAX = 20;

  var display = '0';         // what's currently shown
  var stored = null;         // first operand, once an operator is pressed
  var pendingOp = null;      // '÷' | '×' | '−' | '+'
  var justEvaluated = false; // true right after "=" -- next digit starts fresh

  function fmt(n) {
    if (!isFinite(n)) return 'Error';
    // Trim floating-point noise (0.1+0.2 etc.) without mangling a
    // legitimate long decimal.
    var r = Math.round(n * 1e10) / 1e10;
    return String(r);
  }

  function renderDisplay() {
    var el = document.getElementById('calc-display');
    if (el) el.textContent = display;
  }

  function escapeCalcHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch (e) {}
  }
  function renderHistory() {
    var el = document.getElementById('calc-history-list');
    if (!el) return;
    var list = loadHistory();
    if (!list.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:4px 0;">No calculations yet</div>';
      return;
    }
    el.innerHTML = list.map(function (entry) {
      return '<div style="padding:5px 0;border-top:1px solid var(--border);">'
        + '<div style="color:var(--muted);font-size:.74rem;">' + escapeCalcHtml(entry.expr) + '</div>'
        + '<div style="font-weight:700;">' + escapeCalcHtml(entry.result) + '</div>'
        + '</div>';
    }).join('');
  }
  function pushHistory(expr, result) {
    var list = loadHistory();
    list.unshift({ expr: expr, result: result });
    saveHistory(list);
    renderHistory();
  }

  function compute(a, op, b) {
    switch (op) {
      case '+': return a + b;
      case '−': return a - b;
      case '×': return a * b;
      case '÷': return b === 0 ? NaN : a / b;
      default:  return b;
    }
  }

  window.calcDigit = function (d) {
    if (justEvaluated) { display = '0'; justEvaluated = false; }
    if (d === '.') {
      if (display.indexOf('.') !== -1) return; // one decimal point only
      display = display + '.';
      renderDisplay();
      return;
    }
    display = (display === '0') ? d : display + d;
    renderDisplay();
  };

  window.calcOp = function (op) {
    if (pendingOp && stored !== null && !justEvaluated) {
      // Chain without pressing "=" first, e.g. 5 + 3 + -- evaluate the
      // pending 5+3 immediately, then continue from that result.
      var r = compute(stored, pendingOp, parseFloat(display));
      stored = r;
      display = fmt(r);
    } else {
      stored = parseFloat(display);
    }
    pendingOp = op;
    justEvaluated = false;
    renderDisplay();
  };

  window.calcEquals = function () {
    if (pendingOp === null || stored === null) return;
    var b = parseFloat(display);
    var r = compute(stored, pendingOp, b);
    var expr = fmt(stored) + ' ' + pendingOp + ' ' + fmt(b);
    var resultStr = fmt(r);
    pushHistory(expr, resultStr);
    display = resultStr;
    stored = null;
    pendingOp = null;
    justEvaluated = true;
    renderDisplay();
  };

  window.calcClear = function () {
    display = '0';
    stored = null;
    pendingOp = null;
    justEvaluated = false;
    renderDisplay();
  };

  window.calcBackspace = function () {
    if (justEvaluated) { window.calcClear(); return; }
    display = display.length > 1 ? display.slice(0, -1) : '0';
    renderDisplay();
  };

  window.calcClearHistory = function () {
    saveHistory([]);
    renderHistory();
  };

  window.openCalcDialog = function () {
    var ov = document.getElementById('calc-dialog-overlay');
    if (!ov) return;
    window.calcClear();
    renderHistory();
    ov.style.display = 'flex';
  };

  window.closeCalcDialog = function () {
    var ov = document.getElementById('calc-dialog-overlay');
    if (ov) ov.style.display = 'none';
  };

  // Keyboard support while the dialog is open -- digits, operators,
  // Enter/= to evaluate, Backspace, Escape to close.
  document.addEventListener('keydown', function (e) {
    var ov = document.getElementById('calc-dialog-overlay');
    if (!ov || ov.style.display === 'none' || !ov.style.display) return;
    if (e.key >= '0' && e.key <= '9') { window.calcDigit(e.key); return; }
    if (e.key === '.') { window.calcDigit('.'); return; }
    if (e.key === '+') { window.calcOp('+'); return; }
    if (e.key === '-') { window.calcOp('−'); return; }
    if (e.key === '*') { window.calcOp('×'); return; }
    if (e.key === '/') { e.preventDefault(); window.calcOp('÷'); return; }
    if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); window.calcEquals(); return; }
    if (e.key === 'Backspace') { window.calcBackspace(); return; }
    if (e.key === 'Escape') { window.closeCalcDialog(); return; }
  });
})();
