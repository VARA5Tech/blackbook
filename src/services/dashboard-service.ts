import "server-only";
import { requireCapability } from "@/auth/session";
import { memberAnalytics, posthogIsConfigured } from "@/lib/posthog";
import { testers } from "@/repositories/customer-repository";
import { EMPTY_ANALYTICS } from "@/domain/engagement";
import type { AnalyticsRange, MemberAnalytics } from "@/domain/engagement";
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
    waiting,
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
    (await import("./lead-service")).openLeads(8),
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
    /** What the client list has been reading on vara5.com lately. */
    wanted,
    wantedDays: INTEREST_DAYS,
    /** Clients who asked and have had no logged reply since. */
    waiting,
  };
}


/**
 * How the members' site is performing, for whoever runs the desk.
 *
 * Separate from the screen above and from a client's own Interest panel. That
 * one answers "what has this client been reading"; this one answers "which
 * journeys earn an ask, which are turned over and abandoned, and who is warm
 * this week" — a commercial question, which is why it needs `analytics.read`
 * rather than `client.read`.
 *
 * Reads PostHog only. Nothing here touches the database, so a slow or
 * unconfigured PostHog costs this screen and nothing else.
 */
export async function getMemberAnalytics(
  days: AnalyticsRange,
  includeTesters = false,
): Promise<{
  configured: boolean;
  days: AnalyticsRange;
  analytics: MemberAnalytics;
  testers: number;
}> {
  await requireCapability("analytics.read");

  const configured = posthogIsConfigured();
  if (!configured) {
    return { configured, days, analytics: EMPTY_ANALYTICS, testers: 0 };
  }

  // The desk's own browsing is testing, not demand. Left out unless asked for,
  // because it is heavier than every client put together.
  const ours = await testers();
  const excluded = includeTesters ? [] : ours.map((tester) => tester.ref);

  return {
    configured,
    days,
    analytics: await memberAnalytics(days, excluded),
    testers: ours.length,
  };
}
