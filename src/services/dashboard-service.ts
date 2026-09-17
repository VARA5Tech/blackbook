import "server-only";
import { requireCapability } from "@/auth/session";
import {
  countIncompleteProfiles,
  countNeedingFollowUp,
  recentlyViewedClients,
  topInterestDestinations,
} from "@/repositories/customer-repository";
import { listRecentActivity } from "./activity-service";
import { countHouseholds } from "./household-service";
import { countUpcoming, getUpcomingMilestones } from "./milestone-service";

const FOLLOW_UP_DAYS = 60;
/** Long enough for a pattern, short enough that it still reads as "lately". */
const INTEREST_DAYS = 30;

/**
 * One authorized read for the operations home screen.
 *
 * Deliberately operational rather than analytical: every number here answers
 * "what should someone do today", not "how are we performing".
 */
export async function getOpsDashboard() {
  await requireCapability("client.read");

  const [
    upcoming,
    birthdaysThisWeek,
    anniversariesThisMonth,
    followUps,
    incomplete,
    households,
    recentClients,
    activity,
    wanted,
  ] = await Promise.all([
    getUpcomingMilestones(45, 12),
    countUpcoming(7, "birthday"),
    countUpcoming(30, "wedding_anniversary"),
    countNeedingFollowUp(FOLLOW_UP_DAYS),
    countIncompleteProfiles(),
    countHouseholds(),
    recentlyViewedClients(6),
    listRecentActivity(12),
    topInterestDestinations(
      new Date(Date.now() - INTEREST_DAYS * 24 * 60 * 60 * 1000),
      5,
    ),
  ]);

  return {
    upcoming,
    counts: {
      birthdaysThisWeek,
      anniversariesThisMonth,
      followUps,
      incomplete,
      households,
      followUpDays: FOLLOW_UP_DAYS,
    },
    recentClients,
    activity,
    /** What the client list has been reading on vara5.travel lately. */
    wanted,
    wantedDays: INTEREST_DAYS,
  };
}
