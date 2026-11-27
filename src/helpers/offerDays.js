/**
 * An offer's dates are whole days in India.
 *
 * The panel saves a date as 9 AM on that day, so an offer "ending 27 Nov"
 * stopped at 9 in the morning of the 27th, and one "starting 27 Nov" did not
 * begin until 9 — live on the panel, missing on the website, refused at
 * checkout. These read a start date as the start of its day and an end date
 * as the very end of its day, whatever time is stored.
 */
const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000;

/** Midnight in India at the start of the day `d` falls on. */
const dayStart = (d) => new Date(Math.floor((new Date(d).getTime() + IST) / DAY) * DAY - IST);

/** Whether an offer's dates take in this moment. */
function inDates(offer, now = new Date()) {
  if (offer.startsOn && dayStart(offer.startsOn) > now) return 'not-started';
  if (offer.endsOn && dayStart(offer.endsOn).getTime() + DAY <= now.getTime()) return 'ended';
  return '';
}

/** The same rule as a MongoDB filter. */
function inDatesQuery(now = new Date()) {
  const todayStart = dayStart(now);
  const tomorrowStart = new Date(todayStart.getTime() + DAY);
  return {
    $and: [
      { $or: [{ startsOn: null }, { startsOn: { $lt: tomorrowStart } }] },
      { $or: [{ endsOn: null }, { endsOn: { $gte: todayStart } }] },
    ],
  };
}

module.exports = { dayStart, inDates, inDatesQuery };
