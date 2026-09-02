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
// No longer used for DTSTART/DTEND (see wallClockToUTC below) — kept here
// since it's still handy for anything wanting the raw wall-clock string.
function toICSDateTime(dateStr, timeStr) {
  var parts = String(dateStr).split('-');
  var y = parts[0], mo = parts[1], d = parts[2];
  var t = String(timeStr || '00:00').split(':');
  var hh = (t[0] || '00').padStart(2, '0');
  var mm = (t[1] || '00').padStart(2, '0');
  return y + mo + d + 'T' + hh + mm + '00';
}

// Converts a wall-clock date/time meant to represent local time in
// `timeZone` into the true UTC instant, DST-aware, using only the
// platform's built-in Intl support (no external tz-database dependency
// needed in a Netlify function). Standard "double conversion" trick:
//   1. Read the wall-clock numbers as if they were already UTC (a
//      throwaway reference instant, asUTC).
//   2. Ask what time `timeZone`'s clock would show AT that instant — the
//      gap between that reading and asUTC IS timeZone's real UTC offset
//      at (approximately) the target moment.
//   3. Subtract that offset back off asUTC to land on the true instant at
//      which timeZone's clock actually reads the original wall-clock time.
// 2026-08-31 fix: replaces the previous DTSTART/DTEND;TZID=... approach.
// RFC 5545 requires a VTIMEZONE component be defined whenever a TZID is
// used unless it's one of a small set of well-known names every consuming
// app is guaranteed to already understand — Google Calendar in particular
// has a history of being inconsistent about this without one, which is
// almost certainly why "YTW Schedule and Google Calendar don't share the
// same timezone" was reported: the bare TZID could be silently
// mis-happens across the two. Emitting a plain UTC (Z-suffixed) instant
// instead sidesteps the whole VTIMEZONE question — there's no ambiguity
// left for any calendar app to get wrong, since every app already knows
// how to localize a UTC instant into whatever timezone IT is set to.
function wallClockToUTC(dateStr, timeStr, timeZone) {
  var parts = String(dateStr).split('-');
  var y = +parts[0], mo = +parts[1], d = +parts[2];
  var t = String(timeStr || '00:00').split(':');
  var hh = +(t[0] || 0), mm = +(t[1] || 0);
  var asUTC = Date.UTC(y, mo - 1, d, hh, mm, 0);
  var dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  var map = {};
  dtf.formatToParts(new Date(asUTC)).forEach(function(p) { map[p.type] = p.value; });
  var asIfTZ = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  var offset = asIfTZ - asUTC; // timeZone's real UTC offset at this instant, DST-correctly
  return new Date(asUTC - offset);
}
function toICSDateTimeUTC(dateStr, timeStr, timeZone) {
  var d = wallClockToUTC(dateStr, timeStr, timeZone);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
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


	var settingsSnap = await db.ref(up + '/schedule-settings').once('value');
	var settings = settingsSnap.val() || {};
	var timeZone = settings.timezone || 'America/Chicago';


    var lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//You-The-Winner Engine//My Schedule//EN');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:My Schedule');
	
	lines.push('X-WR-TIMEZONE:' + timeZone);
	
    // A hint some calendar apps honor for their own poll interval; Google
    // in practice uses its own ~12-24h cadence regardless.
    lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT12H');

    Object.keys(schedule).forEach(function(id) {
      var s = schedule[id] || {};
      if (!s.date || !s.start || !s.end) return; // skip malformed/partial entries
      lines.push('BEGIN:VEVENT');
      lines.push(foldLine('UID:' + id + '@you-the-winner.com'));
      lines.push('DTSTAMP:' + nowUTCStamp());
      // 2026-08-31 fix: see wallClockToUTC's comment above — replaced the
      // TZID-based lines (kept below, commented out, for reference) with
      // plain UTC (Z-suffixed) instants computed from the wall-clock time
      // + the account's configured timeZone. This is what actually
      // resolves "YTW Schedule and Google Calendar don't share the same
      // timezone".
      // lines.push('DTSTART;TZID=' + timeZone + ':' + toICSDateTime(s.date, s.start));
      // lines.push('DTEND;TZID=' + timeZone + ':' + toICSDateTime(s.date, s.end));
      lines.push('DTSTART:' + toICSDateTimeUTC(s.date, s.start, timeZone));
      lines.push('DTEND:' + toICSDateTimeUTC(s.date, s.end, timeZone));
	  
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
