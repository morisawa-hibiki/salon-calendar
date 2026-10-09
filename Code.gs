/**
 * 貸しサロン 空き状況API（Google Apps Script）
 *
 * Googleカレンダー（小部屋・大部屋）の「埋まっている時間」だけをJSONで返します。
 * 予定のタイトル・説明・参加者などは一切返しません。カレンダー自体も公開不要です。
 *
 * 返す形式:
 * {
 *   "updatedAt": "2026-10-09T04:00:00.000Z",
 *   "publishedUntil": "2026-12-31",
 *   "rooms": {
 *     "small": { "busy": { "2026-10-12": [["10:00","12:00"]] } },
 *     "large": { "busy": { "2026-10-12": [["09:00","24:00"]] } }
 *   }
 * }
 */

const SETTINGS = {
  // ★ 各カレンダーのID（Googleカレンダー > 設定 > カレンダーの統合 > カレンダーID）
  CALENDARS: {
    small: 'ここに小部屋カレンダーのID@group.calendar.google.com',
    large: 'ここに大部屋カレンダーのID@group.calendar.google.com'
  },
  // 当月を含めて何か月先まで公開するか。これより先の日付は「－（情報準備中）」になります。
  MONTHS_PUBLISHED: 3,
  CACHE_SECONDS: 300
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function doGet() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('availability');
  if (hit) return json_(hit);

  const body = JSON.stringify(buildPayload_());
  if (body.length < 90000) cache.put('availability', body, SETTINGS.CACHE_SECONDS);
  return json_(body);
}

function json_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

function buildPayload_() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();                       // 0始まり

  // 取得範囲: 当月1日 0:00(JST) 〜 公開最終月の末日の翌日 0:00(JST)
  const rangeStart = new Date(Date.UTC(y, m, 1) - JST_OFFSET_MS);
  const lastDay = new Date(Date.UTC(y, m + SETTINGS.MONTHS_PUBLISHED, 0)); // 公開最終月の末日
  const rangeEnd = new Date(lastDay.getTime() + DAY_MS - JST_OFFSET_MS);
  const publishedUntil = lastDay.toISOString().slice(0, 10);

  const rooms = {};
  Object.keys(SETTINGS.CALENDARS).forEach(function (key) {
    const cal = CalendarApp.getCalendarById(SETTINGS.CALENDARS[key]);
    if (!cal) throw new Error('カレンダーが見つかりません: ' + key);
    const busy = {};
    // getEvents は繰り返し予定（月額入居など）を1件ずつに展開して返します
    cal.getEvents(rangeStart, rangeEnd).forEach(function (ev) {
      addBusy_(busy, ev.getStartTime().getTime(), ev.getEndTime().getTime());
    });
    rooms[key] = { busy: busy };
  });

  return { updatedAt: now.toISOString(), publishedUntil: publishedUntil, rooms: rooms };
}

// 予定を日付ごと(JST)に分割して busy に追加する。複数日・終日の予定にも対応。
function addBusy_(busy, startMs, endMs) {
  let dayIndex = Math.floor((startMs + JST_OFFSET_MS) / DAY_MS);
  while (true) {
    const dayStartMs = dayIndex * DAY_MS - JST_OFFSET_MS;
    if (dayStartMs >= endMs) break;
    const s = Math.max(startMs, dayStartMs);
    const e = Math.min(endMs, dayStartMs + DAY_MS);
    if (e > s) {
      const key = new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
      (busy[key] = busy[key] || []).push([
        hhmm_(Math.round((s - dayStartMs) / 60000)),
        hhmm_(Math.round((e - dayStartMs) / 60000))
      ]);
    }
    dayIndex++;
  }
}

function hhmm_(min) {
  return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2);
}

/** 動作確認用: スクリプトエディタで実行し、ログに出力されるJSONを確認します。 */
function testRun() {
  Logger.log(JSON.stringify(buildPayload_(), null, 2));
}
