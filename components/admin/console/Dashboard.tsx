import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  ActionButton,
  Chip,
  Field,
  Notice,
  Section,
} from "@/components/admin/ui";
import { buildQuery, dayRange } from "@/lib/adminFormat";
import { useApiQuery } from "@/lib/fetch";
import { formatCents } from "@/lib/utils";
import {
  type ActiveRideStatus,
  activeRideStatuses,
  DASHBOARD_RULES,
  type DashboardView,
} from "@/shared/adminDashboard";

type Href =
  | "/admin"
  | "/admin/support"
  | "/admin/safety"
  | "/admin/drivers"
  | "/admin/rides";

const STATUS_LABEL: Record<ActiveRideStatus, string> = {
  awaiting_payment: "Awaiting payment",
  requested: "Searching, no offer out",
  offered: "Searching, offer out",
  accepted: "Driver assigned",
  arriving: "Driver on the way",
  arrived: "Driver at pickup",
  in_progress: "On trip",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const utcDay = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const seconds = (value: number | null) =>
  value === null
    ? "—"
    : value < 90
      ? `${value}s`
      : `${Math.floor(value / 60)}m ${value % 60}s`;

const percent = (rate: number | null) =>
  rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;

const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

const Metric = ({
  label,
  value,
  note,
  href,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  href?: Href;
  tone?: "attention";
}) => {
  const body = (
    <>
      <Text className="text-xs text-general-200">{label}</Text>
      <Text
        className={`text-2xl font-JakartaBold mt-1 ${tone === "attention" ? "text-red-700" : ""}`}
      >
        {value}
      </Text>
      {note && <Text className="text-xs text-general-200 mt-1">{note}</Text>}
      {href && <Text className="text-xs text-[#0066CC] mt-1">Open list</Text>}
    </>
  );
  const box = "w-56 mr-3 mb-3 p-3 rounded-xl border border-neutral-200";
  return href ? (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${value}. Open list.`}
      className={`${box} hover:bg-neutral-50`}
    >
      {body}
    </Pressable>
  ) : (
    <View className={box} accessible accessibilityLabel={`${label}: ${value}`}>
      {body}
    </View>
  );
};

const Grid = ({ children }: { children: React.ReactNode }) => (
  <View className="flex flex-row flex-wrap">{children}</View>
);

const Dashboard = () => {
  const [from, setFrom] = useState(utcDay(0));
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: utcDay(0), to: "" });
  const badFrom = from !== "" && !DAY.test(from);
  const badTo = to !== "" && !DAY.test(to);
  const query = useApiQuery<DashboardView>(
    `/api/admin/dashboard${buildQuery(dayRange(applied.from, applied.to))}`,
  );
  const d = query.data;
  const preset = (days: number) => {
    const next = { from: utcDay(-days), to: "" };
    setFrom(next.from);
    setTo("");
    setApplied(next);
  };
  const live = d?.live ?? null;
  const period = d?.period ?? null;
  const hidden = "Not shown for your role";

  return (
    <View>
      <Section
        title="Dashboard"
        right={
          <ActionButton
            title={query.status === "loading" ? "Loading…" : "Refresh"}
            onPress={query.refetch}
            disabled={query.status === "loading"}
          />
        }
      >
        <Text className="text-xs text-general-200 mb-3">
          All dates and day boundaries are in {DASHBOARD_RULES.timezone}, not
          the service area&apos;s local time. Counts only: no passenger or
          driver details are shown here.
        </Text>
        <View className="flex flex-row flex-wrap items-end">
          <Field
            label="From (YYYY-MM-DD, UTC)"
            value={from}
            onChangeText={setFrom}
          />
          <Field
            label="To, inclusive (blank = now)"
            value={to}
            onChangeText={setTo}
          />
          <ActionButton
            title="Apply"
            disabled={badFrom || badTo || from === ""}
            onPress={() => setApplied({ from, to })}
          />
        </View>
        <View className="flex flex-row flex-wrap">
          <Chip
            label="Today"
            active={applied.from === utcDay(0) && applied.to === ""}
            onPress={() => preset(0)}
          />
          <Chip
            label="Last 7 days"
            active={applied.from === utcDay(-6) && applied.to === ""}
            onPress={() => preset(6)}
          />
          <Chip
            label="Last 30 days"
            active={applied.from === utcDay(-29) && applied.to === ""}
            onPress={() => preset(29)}
          />
        </View>
        {(badFrom || badTo) && (
          <Notice tone="warning" text="Enter dates as YYYY-MM-DD." />
        )}
        <Text className="text-xs text-general-200 mt-1">
          Ranges can cover at most {DASHBOARD_RULES.maxRangeDays} days.
        </Text>
        {query.status === "error" && (
          <Notice
            tone="error"
            text={
              d
                ? `Couldn't refresh: ${query.error} Showing figures from ${utc(d.generatedAt)}.`
                : query.error
            }
          />
        )}
        {!d && query.status === "loading" && (
          <Text className="text-sm text-general-200 mt-2">Loading…</Text>
        )}
        {d && (
          <Text
            className="text-xs text-general-200 mt-2"
            accessibilityLiveRegion="polite"
          >
            Figures generated {utc(d.generatedAt)} for {utc(d.from)} to{" "}
            {utc(d.to)}. Results may be up to {d.cacheSeconds} seconds old.
          </Text>
        )}
      </Section>

      {d && (
        <>
          <Section title="Right now">
            {!live ? (
              <Notice
                tone="error"
                text="Live figures are unavailable right now. Nothing is shown rather than showing zeros. Try Refresh."
              />
            ) : (
              <>
                <Text className="text-sm font-JakartaSemiBold mb-2">
                  Active rides by status
                </Text>
                <Grid>
                  {activeRideStatuses.map((status) => (
                    <Metric
                      key={status}
                      label={STATUS_LABEL[status]}
                      value={String(live.activeByStatus[status])}
                      href="/admin/rides"
                    />
                  ))}
                </Grid>
                <Text className="text-sm font-JakartaSemiBold mb-2">
                  Matching
                </Text>
                <Grid>
                  <Metric
                    label="Requests searching"
                    value={String(live.searching.count)}
                    note={`Oldest ${seconds(live.searching.oldestSeconds)} · average ${seconds(live.searching.averageSeconds)}`}
                  />
                  <Metric
                    label="Approved drivers online"
                    value={String(live.drivers.approvedOnline)}
                  />
                  <Metric
                    label="Available to match"
                    value={String(live.drivers.eligibleAvailable)}
                    note="Online, eligible, recent location, in a category, not on a ride"
                  />
                </Grid>
                <Text className="text-sm font-JakartaSemiBold mb-2">
                  Payments in flight
                </Text>
                <Grid>
                  <Metric
                    label="Captures awaiting"
                    value={String(live.settlement.capturesAwaiting)}
                    note="Completed rides not yet charged"
                  />
                  <Metric
                    label="Releases awaiting"
                    value={String(live.settlement.releasesAwaiting)}
                    note="Ended rides whose hold is not yet released"
                  />
                  <Metric
                    label="Being retried"
                    value={String(live.settlement.retrying)}
                    tone={
                      live.settlement.retrying > 0 ? "attention" : undefined
                    }
                  />
                </Grid>
                <Text className="text-sm font-JakartaSemiBold mb-2">
                  Queues
                </Text>
                <Grid>
                  <Metric
                    label="Support requests open"
                    value={String(live.queues.supportOpen)}
                    note={`${live.queues.supportAwaitingReply} waiting for an operator reply`}
                    href="/admin/support"
                  />
                  <Metric
                    label="Safety reports open"
                    value={
                      live.queues.safetyOpen === null
                        ? "—"
                        : String(live.queues.safetyOpen)
                    }
                    note={live.queues.safetyOpen === null ? hidden : undefined}
                    href={
                      live.queues.safetyOpen === null
                        ? undefined
                        : "/admin/safety"
                    }
                  />
                  <Metric
                    label="Driver applications"
                    value={
                      live.queues.driverApplications === null
                        ? "—"
                        : String(live.queues.driverApplications)
                    }
                    note={
                      live.queues.driverApplications === null
                        ? hidden
                        : "Submitted, or with documents to review"
                    }
                    href={
                      live.queues.driverApplications === null
                        ? undefined
                        : "/admin/drivers"
                    }
                  />
                  <Metric
                    label="Rides needing review"
                    value={String(live.queues.reviewOpen)}
                    note={`${live.queues.financialIssues} with a payment problem`}
                    href="/admin"
                    tone={
                      live.queues.financialIssues > 0 ? "attention" : undefined
                    }
                  />
                  <Metric
                    label="Trips reported unpaid"
                    value={String(live.queues.unpaidRides)}
                    note="The passenger can't request again until support settles it"
                    href="/admin"
                    tone={live.queues.unpaidRides > 0 ? "attention" : undefined}
                  />
                  <Metric
                    label="Payments not recorded yet"
                    value={String(live.queues.collectionsPending)}
                    note="Completed trips where the driver hasn't recorded the payment"
                  />
                  <Metric
                    label="Card disputes open"
                    value={String(live.queues.disputesOpen)}
                    href="/admin"
                    tone={
                      live.queues.disputesOpen > 0 ? "attention" : undefined
                    }
                  />
                </Grid>
                <Text className="text-sm font-JakartaSemiBold mb-2">
                  Scheduled requests
                </Text>
                <Grid>
                  <Metric
                    label="Upcoming"
                    value={String(live.scheduled.upcoming)}
                    note="Saved requests; no driver is reserved"
                  />
                  <Metric
                    label="Awaiting passenger confirmation"
                    value={String(live.scheduled.awaitingConfirmation)}
                  />
                </Grid>
              </>
            )}
          </Section>

          <Section title="Selected period">
            {!period ? (
              <Notice
                tone="error"
                text="Period figures are unavailable right now. Nothing is shown rather than showing zeros. Try Refresh."
              />
            ) : (
              <>
                <Text className="text-sm font-JakartaSemiBold mb-2">
                  Ride requests placed in the period
                </Text>
                <Grid>
                  <Metric
                    label="Requests"
                    value={String(period.requests.total)}
                    note="Rides whose payment was authorized and matching began"
                    href="/admin/rides"
                  />
                  <Metric
                    label="Completed"
                    value={String(period.requests.completed)}
                  />
                  <Metric
                    label="Still active"
                    value={String(period.requests.stillActive)}
                  />
                  <Metric
                    label="Cancelled by passenger"
                    value={String(period.requests.cancelledByPassenger)}
                  />
                  <Metric
                    label="Cancelled by driver"
                    value={String(period.requests.cancelledByDriver)}
                  />
                  <Metric
                    label="Cancelled by system"
                    value={String(period.requests.cancelledBySystem)}
                  />
                  <Metric
                    label="No driver found"
                    value={String(period.requests.noDriver)}
                  />
                  <Metric
                    label="Ended early by driver"
                    value={String(period.requests.interrupted)}
                  />
                  <Metric
                    label="Cancellation rate"
                    value={percent(period.requests.cancellationRate)}
                    note={`${
                      period.requests.cancelledByPassenger +
                      period.requests.cancelledByDriver +
                      period.requests.cancelledBySystem
                    } cancelled of ${period.requests.total} requests`}
                  />
                  <Metric
                    label="No-driver rate"
                    value={percent(period.requests.noDriverRate)}
                    note={`${period.requests.noDriver} of ${period.requests.total} requests`}
                  />
                  <Metric
                    label="Average time to accept"
                    value={seconds(period.search.averageSecondsToAccept)}
                    note={`Over ${period.search.accepted} accepted requests`}
                  />
                </Grid>
                <Text className="text-sm font-JakartaSemiBold mb-2">
                  Money ({period.money.currency.toUpperCase()})
                </Text>
                <Text className="text-xs text-general-200 mb-2">
                  These are separate measures and are not added together. Fares
                  and tips are counted when captured, refunds when they succeed,
                  and ledger figures when the ledger entry was recorded, so one
                  ride can fall in different periods.
                </Text>
                <Grid>
                  <Metric
                    label="Fares captured"
                    value={formatCents(period.money.faresCapturedCents)}
                    note="Gross passenger charges, before refunds"
                  />
                  <Metric
                    label="Tips captured"
                    value={formatCents(period.money.tipsCapturedCents)}
                  />
                  <Metric
                    label="Refunded"
                    value={formatCents(period.money.refundedCents)}
                    note="Fare and tip refunds that succeeded"
                  />
                  <Metric
                    label="Driver earnings (ledger)"
                    value={formatCents(period.money.ledgerDriverEarningsCents)}
                    note="Net of refund adjustments; not money paid out"
                  />
                  <Metric
                    label="Commission (ledger)"
                    value={formatCents(period.money.ledgerCommissionCents)}
                  />
                  <Metric
                    label="Collected on terminals"
                    value={formatCents(period.money.collectedPosCents)}
                    note="Card payments in the vehicle, as recorded by drivers or support"
                  />
                  <Metric
                    label="Collected in cash"
                    value={formatCents(period.money.collectedCashCents)}
                    note="Kept by drivers"
                  />
                  <Metric
                    label="Transfers to drivers (recorded)"
                    value={formatCents(period.money.transfersToDriversCents)}
                    note="Bank or cash transfers entered by operators; this system moves no money"
                  />
                  <Metric
                    label="Received from drivers (recorded)"
                    value={formatCents(period.money.transfersFromDriversCents)}
                  />
                  <Metric
                    label="Automatic payouts"
                    value="Not available"
                    note="No payout provider is connected, so nothing is paid out by this system"
                  />
                </Grid>
                <Text className="text-sm font-JakartaSemiBold mb-2">
                  Scheduled requests
                </Text>
                <Grid>
                  <Metric
                    label="Created"
                    value={String(period.scheduled.created)}
                  />
                  <Metric
                    label="Expired without a ride"
                    value={String(period.scheduled.expired)}
                    note="Not confirmed in time, or no longer serviceable"
                  />
                </Grid>
              </>
            )}
          </Section>
        </>
      )}
    </View>
  );
};

export default Dashboard;
