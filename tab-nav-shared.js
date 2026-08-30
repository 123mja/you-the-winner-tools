/**
 * tab-nav-shared.js — single source of truth for "which tools does this
 * person have, in what order, and how many fit before folding into More."
 *
 * Added 2026-07-25 because calm-corner.html's cross-page sidebar was a
 * hardcoded, always-the-same list of links -- completely independent of
 * the tab bar in my-daily-tools.html, which is personalized (a caregiver
 * can turn tools on/off and drag-reorder them in Settings) and capped at 5
 * visible icons with the rest folded into a "More" menu. Any page that only
 * needs a personalized, capped LIST of links (not full in-page pane
 * switching) should use this file instead of hardcoding its own copy.
 *
 * my-daily-tools.html remains the reference implementation for actually
 * SWITCHING panes (switchTab(), the More popover wired to onclick handlers,
 * etc.) -- it now sources its tab identity/order from here (TAB_META,
 * DEFAULT_TAB_ORDER) so the two can never drift apart on what the tools
 * ARE, but keeps its own (already correct, already fixed) enabled-flag
 * reading and applyTabOrder() cap/sort logic untouched, since that's
 * fragile, load-order-sensitive code that doesn't need touching to fix
 * this. This file's getActiveTabs()/splitVisibleOverflow() re-implement
 * that same algorithm for any OTHER page (like calm-corner.html) that just
 * wants a correct, personalized, capped link list without the rest of
 * my-daily-tools.html's machinery.
 *
 * Load this as a plain (non-module) script, same as theme.js.
 */
(function () {
  // Icon + label for every tab. Keep this the single place that defines
  // what a tab is called and which emoji represents it.
  var TAB_META = {
    welcome:  { icon: '🏠', label: 'Home' },
    home:     { icon: '💵', label: 'Money' },
    plans:    { icon: '🌱', label: 'Plans' },
    tasklists:{ icon: '⬆️', label: 'Level Up Board' }, // renamed 2026-08-30 from 'Task Lists', per Marcelo -- less demand-triggering for PDA/neurodivergent users
    myday:    { icon: '🌿', label: 'My Day' },
    calendar: { icon: '📅', label: 'Calendar' },
    calm:     { icon: '🌊', label: 'Calm' },
    cycle:    { icon: '🌸', label: 'Cycle' },
    roadmap:  { icon: '🗺️', label: 'Life Roadmap' },
    wishlist: { icon: '⭐', label: 'Wishes' },
    things:   { icon: '⚖️', label: 'Value of Things' },
    rewards:  { icon: '🏆', label: 'Rewards' },
    help:     { icon: '❓', label: 'Help' },
    settings: { icon: '⚙️', label: 'Settings' },
  };

  // Same default order my-daily-tools.html ships with for a brand-new visitor.
  var DEFAULT_TAB_ORDER = ['welcome','plans','tasklists','home','myday','calendar','cycle','roadmap','calm','wishlist','things','rewards','help','settings'];

  // Tabs that are always on (no Settings toggle exists for them).
  var ALWAYS_ON = ['welcome', 'plans'];

  // Every other tab's on/off state lives in localStorage under this key,
  // with this default when the key has never been set. Keys and defaults
  // match my-daily-tools.html's TAB_ENABLED/TAB_SETTER exactly.
  var FLAGS = {
    home:     { key: 'home-tab-enabled',     def: true  },
    tasklists:{ key: 'tasklists-tab-enabled', def: false },
    myday:    { key: 'myday-tab-enabled',    def: true  },
    calendar: { key: 'calendar-tab-enabled', def: false },
    cycle:    { key: 'cycle-tracker-enabled', def: false },
    calm:     { key: 'calm-tab-enabled',     def: false },
    roadmap:  { key: 'roadmap-tab-enabled',  def: false },
    wishlist: { key: 'wishlist-tab-enabled', def: false },
    things:   { key: 'things-tab-enabled',   def: false },
    rewards:  { key: 'rewards-tab-enabled',  def: false },
    help:     { key: 'help-tab-enabled',     def: true  },
    settings: { key: 'settings-tab-visible', def: true  },
  };

  // Default cap: at most 4 tabs shown directly plus a "More" entry (5
  // total), and Settings always folds into More so it never crowds out an
  // actual tool. Configurable (2026-07-25) via Settings -> Tabs Visibility
  // & Order, stored under this key so it's the same single source of truth
  // both pages read -- change it in one place, both bars respect it.
  var MAX_VISIBLE_KEY = 'tb-max-visible';
  var MAX_VISIBLE_DEFAULT = 5;
  var MAX_VISIBLE_MIN = 3;
  var MAX_VISIBLE_MAX = 7;
  var ALWAYS_OVERFLOW = ['settings'];

  function getMaxVisible() {
    try {
      var v = parseInt(localStorage.getItem(MAX_VISIBLE_KEY), 10);
      if (!isNaN(v) && v >= MAX_VISIBLE_MIN && v <= MAX_VISIBLE_MAX) return v;
    } catch (e) {}
    return MAX_VISIBLE_DEFAULT;
  }
  function setMaxVisible(n) {
    n = Math.max(MAX_VISIBLE_MIN, Math.min(MAX_VISIBLE_MAX, parseInt(n, 10) || MAX_VISIBLE_DEFAULT));
    try { localStorage.setItem(MAX_VISIBLE_KEY, String(n)); } catch (e) {}
    return n;
  }

  function isEnabled(key) {
    if (ALWAYS_ON.indexOf(key) !== -1) return true;
    var f = FLAGS[key];
    if (!f) return false;
    try {
      var v = localStorage.getItem(f.key);
      if (v === null) return f.def;
      return v === '1' || v === 'true';
    } catch (e) {
      return f.def;
    }
  }

  // Reads the visitor's saved drag-order (if any), merges in any tab keys
  // that didn't exist yet when it was saved, and always pins 'welcome'
  // first -- same rules my-daily-tools.html applies to its own _tabOrder.
  function loadOrder() {
    var order = DEFAULT_TAB_ORDER.slice();
    try {
      var saved = JSON.parse(localStorage.getItem('daily-tools-tab-order') || 'null');
      if (Array.isArray(saved) && saved.length >= 2) {
        DEFAULT_TAB_ORDER.forEach(function (t) { if (saved.indexOf(t) === -1) saved.push(t); });
        order = saved;
      }
    } catch (e) {}
    if (order.indexOf('welcome') !== -1) {
      order = ['welcome'].concat(order.filter(function (t) { return t !== 'welcome'; }));
    }
    return order;
  }

  function getActiveTabs() {
    var order = loadOrder();
    var seen = {};
    var fullOrder = [];
    order.concat(DEFAULT_TAB_ORDER).forEach(function (t) {
      if (!seen[t]) { seen[t] = true; fullOrder.push(t); }
    });
    return fullOrder.filter(function (t) { return TAB_META[t] && isEnabled(t); });
  }

  // Same split my-daily-tools.html's applyTabOrder() does: Settings always
  // overflows, everything else fills up to MAX_VISIBLE-1 slots (leaving one
  // slot for the More button itself), the rest overflows too.
  function splitVisibleOverflow(active) {
    var maxVisible = getMaxVisible();
    var alwaysOverflow = active.filter(function (k) { return ALWAYS_OVERFLOW.indexOf(k) !== -1; });
    var eligible = active.filter(function (k) { return ALWAYS_OVERFLOW.indexOf(k) === -1; });
    var visible = eligible.slice(0, maxVisible - 1);
    var overflow = eligible.slice(maxVisible - 1).concat(alwaysOverflow);
    return { visible: visible, overflow: overflow };
  }

  window.TAB_NAV = {
    TAB_META: TAB_META,
    DEFAULT_TAB_ORDER: DEFAULT_TAB_ORDER,
    ALWAYS_ON: ALWAYS_ON,
    FLAGS: FLAGS,
    MAX_VISIBLE_MIN: MAX_VISIBLE_MIN,
    MAX_VISIBLE_MAX: MAX_VISIBLE_MAX,
    MAX_VISIBLE_DEFAULT: MAX_VISIBLE_DEFAULT,
    ALWAYS_OVERFLOW: ALWAYS_OVERFLOW,
    isEnabled: isEnabled,
    loadOrder: loadOrder,
    getActiveTabs: getActiveTabs,
    splitVisibleOverflow: splitVisibleOverflow,
    getMaxVisible: getMaxVisible,
    setMaxVisible: setMaxVisible,
  };
})();
