import { DateTime } from "luxon";
import areaCodes from "./areaCodes.json";
import { stateTimezones } from "./timezoneMap";

export function detectState({ state, areaCode, phone }) {
  if (state) return state;
  if (areaCode && areaCodes[areaCode]) return areaCodes[areaCode];
  if (phone) {
    const ac = phone.replace(/\D/g, "").slice(0, 3);
    if (areaCodes[ac]) return areaCodes[ac];
  }
  return null;
}

export function getLocalTime(state, is12Hour = true) {
  const zone = stateTimezones[state];
  if (!zone) return null;
  const now = DateTime.now().setZone(zone);
  return now.toFormat(is12Hour ? "hh:mm a" : "HH:mm");
}

export function getCallAdvice(hour) {
  if (hour >= 9 && hour <= 11)
    return { cold: true, b2b: true, tip: "Morning is best for outreach." };
  if (hour >= 12 && hour <= 13)
    return { cold: false, b2b: false, tip: "Lunch time – avoid calls." };
  if (hour >= 14 && hour <= 17)
    return { cold: true, b2b: true, tip: "Afternoon follow-ups work well." };
  return { cold: false, b2b: false, tip: "Too early or too late." };
}
export function getNextBestTime(hour) {
  if (hour < 9)
    return { nextTime: "09:00 AM", note: "Start your outreach after 9 AM local time." };
  if (hour >= 11 && hour < 14)
    return { nextTime: "02:00 PM", note: "Next best window opens at 2 PM." };
  if (hour >= 17 && hour < 24)
    return { nextTime: "Tomorrow 09:00 AM", note: "It’s after hours — best to try tomorrow morning." };
  return { nextTime: null, note: "" };
}
