export type ParsedDateTime = {
  occurredAt: string;
  explicitDateOrTime: boolean;
};

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function localParts(date: Date, offsetMinutes: number): LocalParts {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function localDateToIso(parts: LocalParts, offsetMinutes: number): string {
  return new Date(
    Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute) -
      offsetMinutes * 60_000,
  ).toISOString();
}

function addLocalDays(parts: LocalParts, days: number): LocalParts {
  const date = new Date(
    Date.UTC(
      parts.year,
      parts.month,
      parts.day + days,
      parts.hour,
      parts.minute,
    ),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

export function parseDateTime(
  text: string,
  referenceDate: Date,
  timezoneOffsetMinutes = -referenceDate.getTimezoneOffset(),
): ParsedDateTime {
  let parts = localParts(referenceDate, timezoneOffsetMinutes);
  let explicitDateOrTime = false;

  const absoluteDate = /(20\d{2})年(\d{1,2})月(\d{1,2})(?:日|号)?/u.exec(text);
  const monthDay =
    absoluteDate === null ? /(\d{1,2})月(\d{1,2})(?:日|号)/u.exec(text) : null;

  if (absoluteDate !== null) {
    parts = {
      ...parts,
      year: Number(absoluteDate[1]),
      month: Number(absoluteDate[2]) - 1,
      day: Number(absoluteDate[3]),
    };
    explicitDateOrTime = true;
  } else if (monthDay !== null) {
    parts = {
      ...parts,
      month: Number(monthDay[1]) - 1,
      day: Number(monthDay[2]),
    };
    explicitDateOrTime = true;
  } else {
    const relativeDays = /大前天/u.test(text)
      ? -3
      : /前天/u.test(text)
        ? -2
        : /昨天|昨晚/u.test(text)
          ? -1
          : /明天/u.test(text)
            ? 1
            : /今天|今日/u.test(text)
              ? 0
              : undefined;
    if (relativeDays !== undefined) {
      parts = addLocalDays(parts, relativeDays);
      explicitDateOrTime = true;
    } else {
      const weekday = /(?:(上|本|这)周|周|星期)([一二三四五六日天])/u.exec(
        text,
      );
      if (weekday !== null) {
        const wanted = WEEKDAY_INDEX[weekday[2]];
        const current = new Date(
          Date.UTC(parts.year, parts.month, parts.day),
        ).getUTCDay();
        const mondayBasedCurrent = current === 0 ? 7 : current;
        const mondayBasedWanted = wanted === 0 ? 7 : wanted;
        const startOfThisWeekDelta = 1 - mondayBasedCurrent;
        const weekDelta = weekday[1] === '上' ? -7 : 0;
        parts = addLocalDays(
          parts,
          startOfThisWeekDelta + weekDelta + mondayBasedWanted - 1,
        );
        explicitDateOrTime = true;
      }
    }
  }

  const colonTime = /(?:^|[^\d])(\d{1,2}):([0-5]\d)(?!\d)/u.exec(text);
  const chineseTime = /(?:^|[^\d])(\d{1,2})点(?:(半)|([0-5]?\d)分?)?/u.exec(
    text,
  );
  if (colonTime !== null) {
    parts = {
      ...parts,
      hour: Number(colonTime[1]),
      minute: Number(colonTime[2]),
    };
    explicitDateOrTime = true;
  } else if (chineseTime !== null) {
    parts = {
      ...parts,
      hour: Number(chineseTime[1]),
      minute: chineseTime[2] === '半' ? 30 : Number(chineseTime[3] ?? 0),
    };
    explicitDateOrTime = true;
  } else {
    const sceneTime = /夜宵|宵夜/u.test(text)
      ? [22, 0]
      : /晚上|晚饭|晚餐|昨晚/u.test(text)
        ? [19, 0]
        : /中午|午饭|午餐/u.test(text)
          ? [12, 0]
          : /下午/u.test(text)
            ? [15, 0]
            : /早上|早晨|早餐|早饭/u.test(text)
              ? [8, 0]
              : /上午/u.test(text)
                ? [9, 0]
                : undefined;
    if (sceneTime !== undefined) {
      parts = { ...parts, hour: sceneTime[0], minute: sceneTime[1] };
      explicitDateOrTime = true;
    }
  }

  return {
    occurredAt: localDateToIso(parts, timezoneOffsetMinutes),
    explicitDateOrTime,
  };
}
