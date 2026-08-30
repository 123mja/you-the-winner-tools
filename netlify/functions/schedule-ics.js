// netlify/functions/schedule-ics.js
//
// Publishes a read-only iCalendar (.ics) feed of a YTW-Engine account's
// My Schedule shifts, for subscribing in Google/Apple/Outlook calendars.
// Delivered 2026-08-25, regenerated 2026-08-27 after confirming it had
// never actually been added to the live netlify/functions/ folder (only
// _packs.js, create-checkout-session.js, and stripe-webhook.js were
// showing as deployed).
//
// AUTH MODEL: a calendar app polling a URL has no way to attach a Firebase
// ID token, so this does NOT use normal Firebase Auth. Instead, the
// front-end (my-daily-tools.html, window.generateScheduleFeedLink) writes
// a long random per-account token to `${up}/schedule-feed-token`, and this
// function checks the `token` query param against that value using the
// Firebase Admin SDK — which bypasses Realtime Database security rules
// entirely, which is WHY this has to run server-side rather than as a
// client-side fetch.
//
// REQUIRES these Netlify environment variables (already live for the
// Stripe functions per 2026-08-18(2)/2026-08-21 — nothing new to add):
//   FIREBASE_SERVICE_ACCOUNT_KEY  — full service-account JSON, as a string
//   FIREBASE_DATABASE_URL         — e.g. https://mel-the-winner-default-rtdb.firebaseio.com
//
// URL shape (built by _schedFeedUrl() in my-daily-tools.html):
//   /.netlify/functions/schedule-ics?up=users%2F{uid}&token={token}
//
// STILL NEEDED before this works end-to-end (see FIREBASE-RULES-ADDITIONS.md,
// delivered alongside this file): the `schedule-feed-token` and
// `schedule-settings` nodes need read/write rules added to the live
// database.rules.json, matching the same pattern as the existing
// `schedule` node's rule. The Admin SDK used *here* bypasses rules either
// way, but the app's own client-side UI (the "Publish My Schedule" card
// itself — generating/revoking the token, reading/writing the payroll
// rate settings) needs those rules in place to work at all.

var admin = null;
var _initError = null;
try {
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
} catch (e) {
  _initError = e;
}

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Simple RFC 5545 line folding (continuation lines start with a space) —
// most calendar apps tolerate long unfolded lines fine, but Google in
// particular can be picky, so this keeps every line under ~75 octets.
function foldLine(line) {
  if (line.length <= 73) return line;
  var out = line.slice(0, 73);
  var rest = line.slice(73);
  while (rest.length > 0) {
    out += '\r\n ' + rest.slice(0, 72);
    rest = rest.slice(72);
  }
  return out;
}

// Floating local time (no Z suffix, no TZID) — the app stores plain
// wall-clock dates/times with no timezone concept attached, so a shift
// shows at the same clock time in whatever timezone the subscribing
// calendar app itself is set to, matching how it was actually entered.
function toICSDateTime(dateStr, timeStr) {
  var parts = String(dateStr).split('-');
  var y = parts[0], mo = parts[1], d = parts[2];
  var t = String(timeStr || '00:00').split(':');
  var hh = (t[0] || '00').padStart(2, '0');
  var mm = (t[1] || '00').padStart(2, '0');
  return y + mo + d + 'T' + hh + mm + '00';
}

function nowUTCStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

exports.handler = async function(event) {
  try {
    if (_initError) {
      console.error('schedule-ics init error:', _initError);
      return { statusCode: 500, body: 'Internal error: calendar service unavailable.' };
    }
    var params = event.queryStringParameters || {};
    var up = params.up;
    var token = params.token;
    if (!up || !token) {
      return { statusCode: 400, body: 'Missing up or token parameter.' };
    }
    // up is expected to look like "users/UID" — a Realtime Database path,
    // not a full URL. Defensively restrict its character set before ever
    // using it to build a DB path.
    if (!/^[A-Za-z0-9_\-\/]+$/.test(up)) {
      return { statusCode: 400, body: 'Invalid up parameter.' };
    }

    var db = admin.database();
    var tokenSnap = await db.ref(up + '/schedule-feed-token').once('value');
    var realToken = tokenSnap.val();
    if (!realToken || realToken !== token) {
      return { statusCode: 403, body: 'Invalid or revoked feed token.' };
    }

    var schedSnap = await db.ref(up + '/schedule').once('value');
    var schedule = schedSnap.val() || {};

    var lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//You-The-Winner Engine//My Schedule//EN');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:My Schedule');
    // A hint some calendar apps honor for their own poll interval; Google
    // in practice uses its own ~12-24h cadence regardless.
    lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT12H');

    Object.keys(schedule).forEach(function(id) {
      var s = schedule[id] || {};
      if (!s.date || !s.start || !s.end) return; // skip malformed/partial entries
      lines.push('BEGIN:VEVENT');
      lines.push(foldLine('UID:' + id + '@you-the-winner.com'));
      lines.push('DTSTAMP:' + nowUTCStamp());
      lines.push('DTSTART:' + toICSDateTime(s.date, s.start));
      lines.push('DTEND:' + toICSDateTime(s.date, s.end));
      lines.push(foldLine('SUMMARY:' + icsEscape(s.label || 'Shift')));
      if (s.notes) lines.push(foldLine('DESCRIPTION:' + icsEscape(s.notes)));
      lines.push('STATUS:' + (s.confirmed ? 'CONFIRMED' : 'TENTATIVE'));
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="my-schedule.ics"',
        'Cache-Control': 'no-cache',
      },
      body: lines.join('\r\n'),
    };
  } catch (err) {
    console.error('schedule-ics error:', err);
    return { statusCode: 500, body: 'Internal error generating feed.' };
  }
};
