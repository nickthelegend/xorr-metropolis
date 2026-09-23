/**
 * Which Stock Token trading session applies now, and whether this asset can trade in it.
 *
 * Two sources, in this order of authority:
 *   1. Robinhood's per-asset `tradingCapabilities` (`/rhj/assets`) says, for each of `market`,
 *      `extended` and `overnight`, whether whole and fractional trading is TRADABLE. That is the
 *      answer; the clock never overrides a flag.
 *   2. The US equity clock in America/New_York only picks WHICH of those three sessions is live.
 *
 * Session hours (all America/New_York, DST handled by the IANA zone):
 *   - market     09:30–16:00 on NYSE trading days (13:00 close on NYSE early-close days).
 *   - extended   pre-market 04:00–09:30 and post-market 16:00–20:00 (13:00–17:00 on early-close
 *                days) — the US exchanges' extended-hours windows (Nasdaq/NYSE Arca 4:00–9:30 and
 *                16:00–20:00 ET).
 *   - overnight  20:00–04:00 on the nights before a trading day (Sun–Thu nights) — Robinhood's
 *                "24 Hour Market" window (Sun 20:00 ET → Fri 20:00 ET, 24/5), which is also the
 *                `us_equities_24/5` schedule Chainlink lists for these tokens' feeds.
 *   - closed     Fri 20:00 → Sun 20:00, NYSE holidays, and the night before a holiday.
 * Sources: Robinhood Chain docs "Stock Tokens" (docs.robinhood.com/chain/stock-tokens — the three
 * capability sessions), Robinhood support "Extended-hours trading" and "24 Hour Market"
 * (robinhood.com/us/en/support/articles/extendedhours-trading, …/24hour-market), Chainlink
 * "Robinhood Tokenized Equities" (docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood),
 * NYSE "Holidays & Trading Hours" (nyse.com/markets/hours-calendars) for the table below.
 * Note Robinhood's brokerage opens ITS pre-market at 07:00; 04:00–07:00 is modelled as `extended`
 * here and the asset's `extended` flag decides whether it is tradable.
 */
import { TRADABLE, type RobinhoodAsset } from './api.js';

export type Session = 'market' | 'extended' | 'overnight' | 'closed';
export type Phase = 'pre-market' | 'regular' | 'post-market' | 'overnight' | 'closed';

/** NYSE full-day closures, as local New York dates. */
export const NYSE_HOLIDAYS: Readonly<Record<string, string>> = {
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Washington's Birthday",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
  // 2027 — so the calendar does not go blind at the year boundary.
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': "Washington's Birthday",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving Day',
  '2027-12-24': 'Christmas Day (observed)',
};

/** NYSE 13:00 ET early closes. */
export const NYSE_EARLY_CLOSES: Readonly<Record<string, string>> = {
  '2026-11-27': 'Day after Thanksgiving',
  '2026-12-24': 'Christmas Eve',
  '2027-11-26': 'Day after Thanksgiving',
};

const CALENDAR_YEARS = new Set(Object.keys(NYSE_HOLIDAYS).map((d) => d.slice(0, 4)));

const nyFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

type NyParts = { date: string; weekday: number; minute: number; time: string };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function newYorkParts(now: Date): NyParts {
  const p = Object.fromEntries(nyFormat.formatToParts(now).map((x) => [x.type, x.value]));
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday ?? ''),
    minute: hour * 60 + minute,
    time: `${p.hour}:${p.minute}`,
  };
}

function addDays(date: string, days: number): { date: string; weekday: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay() };
}

function isTradingDay(date: string, weekday: number): boolean {
  return weekday >= 1 && weekday <= 5 && !(date in NYSE_HOLIDAYS);
}

export type ClockReading = {
  session: Session;
  phase: Phase;
  /** Local New York date and HH:MM the reading was taken at. */
  nyDate: string;
  nyTime: string;
  reason: string;
  /** True when the date falls outside the years the holiday table covers. */
  calendarUnknown: boolean;
};

const H = (h: number, m = 0) => h * 60 + m;

/** The session the US equity clock says is live at `now`, ignoring any asset's flags. */
export function marketClock(now: Date): ClockReading {
  const ny = newYorkParts(now);
  const at = `${ny.date} ${ny.time} ET`;
  const calendarUnknown = !CALENDAR_YEARS.has(ny.date.slice(0, 4));
  const base = { nyDate: ny.date, nyTime: ny.time, calendarUnknown };
  const next = addDays(ny.date, 1);
  const tonightOpen = isTradingDay(next.date, next.weekday);
  const overnightOrClosed = (why: string): ClockReading =>
    ny.minute >= H(20) && tonightOpen
      ? { ...base, session: 'overnight', phase: 'overnight', reason: `overnight session (20:00–04:00 ET) at ${at}` }
      : { ...base, session: 'closed', phase: 'closed', reason: `${why} at ${at}` };

  if (!isTradingDay(ny.date, ny.weekday)) {
    const holiday = NYSE_HOLIDAYS[ny.date];
    return overnightOrClosed(holiday ? `NYSE closed for ${holiday}` : 'weekend — US equity markets closed');
  }

  const early = NYSE_EARLY_CLOSES[ny.date];
  const close = early ? H(13) : H(16);
  const postEnd = close + H(4);
  const m = ny.minute;
  if (m < H(4)) return { ...base, session: 'overnight', phase: 'overnight', reason: `overnight session (20:00–04:00 ET) at ${at}` };
  if (m < H(9, 30)) return { ...base, session: 'extended', phase: 'pre-market', reason: `pre-market (04:00–09:30 ET) at ${at}` };
  if (m < close)
    return {
      ...base,
      session: 'market',
      phase: 'regular',
      reason: `regular market (09:30–${early ? '13:00, early close for ' + early : '16:00'} ET) at ${at}`,
    };
  if (m < postEnd)
    return {
      ...base,
      session: 'extended',
      phase: 'post-market',
      reason: `post-market (${early ? '13:00–17:00' : '16:00–20:00'} ET) at ${at}`,
    };
  if (next.weekday === 6) return { ...base, session: 'closed', phase: 'closed', reason: `weekend — closed from Friday 20:00 ET, at ${at}` };
  return overnightOrClosed(
    early && m < H(20)
      ? `between the early-close post-market and the overnight session`
      : `no overnight session tonight (${NYSE_HOLIDAYS[next.date] ?? 'next day is not a trading day'})`,
  );
}

export type Tradability = {
  session: Session;
  phase: Phase;
  whole: boolean;
  fractional: boolean;
  reason: string;
};

const short = (s: string) => s.replace(/^TRADING_STATUS_/, '').toLowerCase();

/**
 * Whether `asset` can be traded at `now`: the clock picks the session, the asset's own
 * `tradingCapabilities[session]` decides whole/fractional.
 */
export function tradability(
  asset: Pick<RobinhoodAsset, 'tokenSymbol' | 'tradingCapabilities'>,
  now: Date = new Date(),
): Tradability {
  const clock = marketClock(now);
  if (clock.session === 'closed') {
    return { session: 'closed', phase: 'closed', whole: false, fractional: false, reason: clock.reason };
  }
  const caps = asset.tradingCapabilities[clock.session];
  const whole = caps.whole === TRADABLE;
  const fractional = caps.fractional === TRADABLE;
  const flags = `whole ${short(caps.whole)}, fractional ${short(caps.fractional)}`;
  const verdict = whole && fractional ? 'tradable' : whole || fractional ? 'partly tradable' : 'not tradable';
  const warn = clock.calendarUnknown ? ' (no NYSE holiday table for this year — holidays not checked)' : '';
  return {
    session: clock.session,
    phase: clock.phase,
    whole,
    fractional,
    reason: `${asset.tokenSymbol} ${verdict} in the ${clock.session} session per Robinhood (${flags}); ${clock.reason}${warn}`,
  };
}
