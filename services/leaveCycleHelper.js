const formatDateUTC = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Returns the leave cycle start and end dates based on renewalType.
 *
 * @param {string|Date|null} joiningDate   - Employee's joining date (used when renewalType is 'date_of_joining')
 * @param {string|Date}      referenceDate - The date to calculate cycle for (default: today)
 * @param {string}           renewalType   - 'date_of_joining' (default) | 'calendar_year'
 *
 * renewalType = 'calendar_year':
 *   Always returns Jan 1 – Dec 31 of the reference year.
 *   Example: reference 20 Jan 2026 -> { start: "2026-01-01", end: "2026-12-31" }
 *
 * renewalType = 'date_of_joining' (default):
 *   Cycle runs from DOJ anniversary to the day before the next anniversary.
 *   Example: DOJ 15 Mar 2023, reference 20 Jan 2026 -> { start: "2025-03-15", end: "2026-03-14" }
 */
const getLeaveCycle = (joiningDate, referenceDate = new Date(), renewalType = "date_of_joining") => {
  const reference = new Date(referenceDate);
  const year = Number.isNaN(reference.getUTCFullYear()) ? new Date().getUTCFullYear() : reference.getUTCFullYear();

  // Calendar year mode — fixed Jan 1 to Dec 31
  if (renewalType === "calendar_year") {
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    };
  }

  // Date of joining mode — DOJ anniversary cycle
  if (!joiningDate) {
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    };
  }

  const join = new Date(joiningDate);
  if (Number.isNaN(join.getTime()) || Number.isNaN(reference.getTime())) {
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    };
  }

  const refYear = reference.getUTCFullYear();
  const joinMonth = join.getUTCMonth();
  const joinDay = join.getUTCDate();

  let cycleStart = new Date(Date.UTC(refYear, joinMonth, joinDay));
  if (reference < cycleStart) {
    cycleStart = new Date(Date.UTC(refYear - 1, joinMonth, joinDay));
  }

  const cycleEnd = new Date(cycleStart);
  cycleEnd.setUTCFullYear(cycleEnd.getUTCFullYear() + 1);
  cycleEnd.setUTCDate(cycleEnd.getUTCDate() - 1);

  return {
    start: formatDateUTC(cycleStart),
    end: formatDateUTC(cycleEnd),
  };
};

module.exports = {
  getLeaveCycle,
  formatDateUTC,
};
