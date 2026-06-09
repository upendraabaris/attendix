const formatDateUTC = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Returns the leave cycle for an employee based on joining date (DOJ).
 * Cycle runs from DOJ anniversary (inclusive) to the day before the next anniversary.
 *
 * Example: DOJ 15 Mar 2023, reference 20 Jan 2026 -> 15 Mar 2025 to 14 Mar 2026
 */
const getLeaveCycle = (joiningDate, referenceDate = new Date()) => {
  const reference = new Date(referenceDate);

  if (!joiningDate) {
    const year = reference.getUTCFullYear();
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    };
  }

  const join = new Date(joiningDate);
  if (Number.isNaN(join.getTime()) || Number.isNaN(reference.getTime())) {
    const year = reference.getUTCFullYear();
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
