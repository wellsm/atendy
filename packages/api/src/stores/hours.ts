export type HourRange = {
  weekday: number;
  opens_at: string;
  closes_at: string;
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const toMinutes = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);

  return hours * 60 + minutes;
};

const getLocalTime = (timeZone: string, now: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);

  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';

  return {
    weekday: WEEKDAYS[part('weekday')] ?? 0,
    minutes: Number(part('hour')) * 60 + Number(part('minute'))
  };
};

/**
 * Whether `now` falls in any range, evaluated in the store timezone.
 * A range with `closes_at <= opens_at` continues into the next weekday.
 */
export const isStoreOpen = (hours: HourRange[], timeZone: string, now: Date) => {
  const { weekday, minutes } = getLocalTime(timeZone, now);

  const previousWeekday = (weekday + 6) % 7;

  return hours.some((range) => {
    const opens = toMinutes(range.opens_at);
    const closes = toMinutes(range.closes_at);

    if (closes > opens) {
      return range.weekday === weekday && minutes >= opens && minutes < closes;
    }

    return (range.weekday === weekday && minutes >= opens) || (range.weekday === previousWeekday && minutes < closes);
  });
};

/**
 * Open now but closed `minutes` from now: the store stops taking orders before it closes.
 */
export const isClosingSoon = (hours: HourRange[], timeZone: string, now: Date, minutes: number) => {
  return isStoreOpen(hours, timeZone, now) && !isStoreOpen(hours, timeZone, new Date(now.getTime() + minutes * 60_000));
};

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * One line per weekday (Sunday first), e.g. `Sex 11:00–14:00, 18:00–23:00` or `Seg fechado`.
 */
export const formatHours = (hours: HourRange[]) => {
  return WEEKDAY_LABELS.map((label, weekday) => {
    const ranges = hours
      .filter((range) => range.weekday === weekday)
      .sort((a, b) => a.opens_at.localeCompare(b.opens_at))
      .map(({ opens_at, closes_at }) => `${opens_at}–${closes_at}`);

    return `${label} ${ranges.length ? ranges.join(', ') : 'fechado'}`;
  }).join('\n');
};
