import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  ActionButton,
  Chip,
  Field,
  KeyValue,
  Notice,
  Section,
  shortId,
  when,
} from "@/components/admin/ui";
import { useOperator } from "@/lib/adminApi";
import { dollarsToCents } from "@/lib/adminFormat";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import { formatCents } from "@/lib/utils";

import type {
  AdminRefund,
  AdminRideDetail,
  RefundableSummary,
} from "@/shared/contracts";

type Result = { tone: "error" | "success" | "info" | "warning"; text: string };

const errorText = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : "Something went wrong.";

const RefundPanel = ({
  title,
  summary,
  refunds,
  createPath,
  syncPath,
  support,
  onChanged,
}: {
  title: string;
  summary: RefundableSummary;
  refunds: AdminRefund[];
  createPath: string;
  syncPath: (refundId: string) => string;
  support: AdminRideDetail["support"];
  onChanged: () => void;
}) => {
  const operator = useOperator();
  const request = useApi();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [supportId, setSupportId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    key: string;
    cents: number;
    max: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const canRefund = operator?.permissions.includes("refund") ?? false;
  const testMode = operator?.stripeMode === "test";
  const cents = dollarsToCents(amount);
  const amountError =
    amount.trim() === ""
      ? null
      : cents === null
        ? "Enter a dollar amount such as 4.50."
        : cents > summary.maxRefundableCents
          ? `The most you can refund is ${formatCents(summary.maxRefundableCents)}.`
          : null;

  const submit = async () => {
    if (!confirm) return;
    setBusy(true);
    setResult(null);
    try {
      const data = await request<{
        refundId: string;
        status: string;
        amountCents: number;
        duplicate: boolean;
        stripeReachable: boolean;
      }>(createPath, {
        body: {
          amountCents: confirm.cents,
          reason: reason.trim(),
          expectedMaxRefundableCents: confirm.max,
          idempotencyKey: confirm.key,
          ...(supportId ? { supportRequestId: supportId } : {}),
        },
      });
      setResult(
        data.duplicate
          ? {
              tone: "info",
              text: `This refund was already submitted (status: ${data.status}).`,
            }
          : !data.stripeReachable
            ? {
                tone: "warning",
                text: "Stripe could not be reached. The refund is recorded and will be retried automatically; nothing was charged twice.",
              }
            : data.status === "succeeded"
              ? {
                  tone: "success",
                  text: `Refunded ${formatCents(data.amountCents)} in Stripe test mode.`,
                }
              : data.status === "failed"
                ? { tone: "error", text: "Stripe declined the refund." }
                : {
                    tone: "info",
                    text: `Stripe reports the refund as ${data.status}.`,
                  },
      );
      setConfirm(null);
      setAmount("");
      setReason("");
    } catch (e) {
      setResult({ tone: "error", text: errorText(e) });
      if (e instanceof ApiRequestError && e.status === 409) setConfirm(null);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const sync = async (refundId: string) => {
    setBusy(true);
    try {
      const data = await request<{ status: string }>(syncPath(refundId), {
        method: "POST",
        body: {},
      });
      setResult({ tone: "info", text: `Stripe status: ${data.status}.` });
    } catch (e) {
      setResult({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Section title={title}>
      <KeyValue label="Captured" value={formatCents(summary.capturedCents)} />
      <KeyValue
        label="Already refunded"
        value={formatCents(summary.refundedCents)}
      />
      <KeyValue
        label="Refunds in progress"
        value={formatCents(summary.inFlightCents)}
      />
      <KeyValue
        label="Maximum refundable"
        value={formatCents(summary.maxRefundableCents)}
      />

      {refunds.length > 0 && (
        <View className="mt-3">
          {refunds.map((r) => (
            <View key={r.id} className="py-2 border-b border-neutral-100">
              <Text className="text-sm font-JakartaSemiBold">
                {formatCents(r.amountCents)} · {r.status} · {when(r.createdAt)}
              </Text>
              <Text className="text-xs text-neutral-600 mt-0.5">
                {r.reason} · by {r.operatorName}
                {r.verifiedOperator || r.source === "stripe"
                  ? ""
                  : " (legacy, unverified)"}
                {r.lastError ? ` · ${r.lastError}` : ""}
              </Text>
              {canRefund &&
                r.status !== "succeeded" &&
                r.status !== "failed" &&
                r.status !== "canceled" && (
                  <Pressable
                    onPress={() => sync(r.id)}
                    disabled={busy}
                    className="mt-1"
                  >
                    <Text className="text-xs text-[#0286FF]">
                      Refresh from Stripe
                    </Text>
                  </Pressable>
                )}
            </View>
          ))}
        </View>
      )}

      {result && <Notice tone={result.tone} text={result.text} />}

      {!summary.refundable ? (
        <Notice
          tone="info"
          text={summary.reasonNotRefundable ?? "Nothing to refund."}
        />
      ) : !canRefund ? (
        <Notice tone="info" text="You don't have refund permission." />
      ) : !testMode ? (
        <Notice
          tone="warning"
          text="Refunds are disabled because the server is not using a Stripe test key."
        />
      ) : confirm ? (
        <View className="mt-3 p-4 rounded-xl bg-orange-50">
          <Text className="text-sm font-JakartaBold">
            Refund {formatCents(confirm.cents)} of{" "}
            {formatCents(summary.capturedCents)} captured?
          </Text>
          <Text className="text-xs text-neutral-700 mt-1">
            Reason: {reason.trim()}
            {supportId
              ? ` · linked to support request ${shortId(supportId)}`
              : ""}
          </Text>
          <Text className="text-xs text-neutral-700 mt-1">
            This sends a refund to Stripe in test mode. It can&apos;t be undone
            from the console.
          </Text>
          <View className="flex flex-row mt-3">
            <ActionButton
              title={busy ? "Submitting…" : "Confirm refund"}
              tone="danger"
              disabled={busy}
              onPress={submit}
            />
            <ActionButton
              title="Back"
              tone="neutral"
              disabled={busy}
              onPress={() => setConfirm(null)}
            />
          </View>
        </View>
      ) : (
        <View className="mt-3">
          <View className="flex flex-row flex-wrap">
            <Field
              label="Amount (USD)"
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
            />
            <Field
              label="Reason"
              value={reason}
              onChangeText={setReason}
              width="w-96"
            />
          </View>
          {amountError && <Notice tone="error" text={amountError} />}
          {support.length > 0 && (
            <View className="flex flex-row flex-wrap mt-2">
              <Chip
                label="No support request"
                active={supportId === null}
                onPress={() => setSupportId(null)}
              />
              {support.map((s) => (
                <Chip
                  key={s.id}
                  label={`Support ${shortId(s.id)} (${s.status.replace("_", " ")})`}
                  active={supportId === s.id}
                  onPress={() => setSupportId(s.id)}
                />
              ))}
            </View>
          )}
          <ActionButton
            title="Review refund"
            disabled={
              cents === null || amountError !== null || reason.trim().length < 3
            }
            onPress={() => {
              setResult(null);
              if (cents !== null)
                setConfirm({
                  key: Crypto.randomUUID(),
                  cents,
                  max: summary.maxRefundableCents,
                });
            }}
          />
        </View>
      )}
    </Section>
  );
};

const DisputesPanel = ({
  rideId,
  disputes,
  onChanged,
}: {
  rideId: string;
  disputes: AdminRideDetail["earnings"]["disputes"];
  onChanged: () => void;
}) => {
  const operator = useOperator();
  const request = useApi();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const canSync = operator?.permissions.includes("support") ?? false;

  const sync = async () => {
    setBusy(true);
    setResult(null);
    try {
      const data = await request<{
        fareRefunds: number;
        tipRefunds: number;
        disputes: number;
        reconciliation: { ok: boolean; issues: string[] };
      }>(`/api/admin/rides/${rideId}/stripe-sync`, {
        method: "POST",
        body: {},
      });
      setResult({
        tone: data.reconciliation.ok ? "success" : "warning",
        text: `Checked ${data.fareRefunds} fare refunds, ${data.tipRefunds} tip refunds and ${data.disputes} disputes in Stripe.${data.reconciliation.ok ? " Everything matches." : ` ${data.reconciliation.issues.join("; ")}`}`,
      });
    } catch (e) {
      setResult({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Section
      title="Payment disputes"
      right={
        canSync ? (
          <ActionButton
            title={busy ? "Checking…" : "Refresh from Stripe"}
            tone="neutral"
            disabled={busy}
            onPress={sync}
          />
        ) : undefined
      }
    >
      {disputes.length === 0 && (
        <Text className="text-sm text-general-200">
          No disputes recorded. Refresh from Stripe to pick up refunds or
          disputes made outside the app.
        </Text>
      )}
      {disputes.map((dp) => (
        <View
          key={dp.stripeDisputeId}
          className="py-2 border-b border-neutral-100"
        >
          <Text className="text-sm font-JakartaSemiBold">
            {dp.subject} · {dp.status.replace(/_/g, " ")} ·{" "}
            {formatCents(dp.amountCents)} · {dp.reason ?? "no reason"}
          </Text>
          <Text className="text-xs text-neutral-600 mt-0.5">
            {dp.stripeDisputeId} · withdrawn{" "}
            {formatCents(dp.fundsWithdrawnCents)} · reinstated{" "}
            {formatCents(dp.fundsReinstatedCents)} · opened {when(dp.createdAt)}
            {dp.closedAt ? ` · closed ${when(dp.closedAt)}` : ""}
          </Text>
          {dp.needsReview && (
            <Notice tone="warning" text={dp.reviewNote ?? "Needs review."} />
          )}
        </View>
      ))}
      <Text className="text-xs text-general-200 mt-2">
        Respond to disputes in the Stripe Dashboard. Funds withdrawn and
        reinstated by Stripe are reflected in the driver&apos;s earnings as
        separate entries.
      </Text>
      {result && <Notice tone={result.tone} text={result.text} />}
    </Section>
  );
};

const ReviewPanel = ({
  detail,
  onChanged,
}: {
  detail: AdminRideDetail;
  onChanged: () => void;
}) => {
  const operator = useOperator();
  const request = useApi();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const review = detail.review;
  const canResolve = operator?.permissions.includes("support") ?? false;

  const resolve = async () => {
    setBusy(true);
    try {
      await request(`/api/admin/rides/${detail.ride.id}/review`, {
        body: { note: note.trim() },
      });
      setResult({ tone: "success", text: "Marked as reviewed." });
      setNote("");
    } catch (e) {
      setResult({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Section title="Review">
      <KeyValue label="Needs review" value={review.open ? "Yes" : "No"} />
      {review.reason && <KeyValue label="Reason" value={review.reason} />}
      {review.resolvedAt && (
        <KeyValue
          label="Reviewed"
          value={`${when(review.resolvedAt)} by ${review.resolvedBy ?? "—"}`}
        />
      )}
      {review.note && <KeyValue label="Review note" value={review.note} />}
      {result && <Notice tone={result.tone} text={result.text} />}
      {review.open && canResolve && (
        <View className="mt-3">
          <Field
            label="What was done (kept in the audit log)"
            value={note}
            onChangeText={setNote}
            multiline
          />
          <ActionButton
            title="Mark as reviewed"
            disabled={busy || note.trim().length < 3}
            onPress={resolve}
          />
        </View>
      )}
    </Section>
  );
};

const COLLECTION_STATE = {
  pending: "Waiting for the driver to record the payment",
  collected: "Collected",
  unpaid: "Reported unpaid by the driver",
  waived: "Closed without a payment",
} as const;

const CollectionSection = ({
  detail,
  onChanged,
}: {
  detail: AdminRideDetail;
  onChanged: () => void;
}) => {
  const operator = useOperator();
  const request = useApi();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const ride = detail.ride;
  const collection = ride.collection;
  const canAct = operator?.permissions.includes("support") ?? false;

  if (ride.paymentMethod !== "in_vehicle") return null;

  const record = async (outcome: "pos" | "cash" | "waived") => {
    setBusy(true);
    try {
      await request(`/api/admin/rides/${ride.id}/collection`, {
        body: { outcome, note: note.trim() },
      });
      setResult({ tone: "success", text: "Payment record updated." });
      setNote("");
    } catch (e) {
      setResult({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Section title="Payment in the vehicle">
      <KeyValue
        label="State"
        value={
          collection
            ? `${COLLECTION_STATE[collection.status]}${
                collection.method
                  ? collection.method === "cash"
                    ? " · cash"
                    : " · card terminal"
                  : ""
              }`
            : "Nothing to collect yet"
        }
      />
      {collection?.collectedAt && (
        <KeyValue label="Collected" value={when(collection.collectedAt)} />
      )}
      {collection?.recordedBy && (
        <KeyValue label="Recorded by" value={collection.recordedBy} />
      )}
      {collection?.note && <KeyValue label="Note" value={collection.note} />}
      <Text className="text-xs text-general-200 mt-2">
        The passenger pays the driver on the card terminal or in cash. No card
        is charged by this system. While a trip is reported unpaid, the
        passenger can&apos;t request another ride.
      </Text>
      {result && <Notice tone={result.tone} text={result.text} />}
      {collection?.canRecord && canAct && (
        <View className="mt-3">
          <Field
            label="Note (required, kept in the audit log)"
            value={note}
            onChangeText={setNote}
            multiline
          />
          <View className="flex flex-row flex-wrap">
            <ActionButton
              title="Paid on terminal"
              disabled={busy || note.trim().length < 3}
              onPress={() => record("pos")}
            />
            <ActionButton
              title="Paid in cash"
              disabled={busy || note.trim().length < 3}
              onPress={() => record("cash")}
            />
            <ActionButton
              title="Close without payment"
              tone="danger"
              disabled={busy || note.trim().length < 3}
              onPress={() => record("waived")}
            />
          </View>
        </View>
      )}
    </Section>
  );
};

const PinPanel = ({
  detail,
  onChanged,
}: {
  detail: AdminRideDetail;
  onChanged: () => void;
}) => {
  const operator = useOperator();
  const request = useApi();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const pin = detail.pin;
  const canWaive = operator?.permissions.includes("support") ?? false;

  const waive = async () => {
    setBusy(true);
    try {
      await request(`/api/admin/rides/${detail.ride.id}/pin-waiver`, {
        body: { reason: reason.trim() },
      });
      setResult({
        tone: "success",
        text: "The driver can now start without the PIN. The passenger was told.",
      });
      setReason("");
    } catch (e) {
      setResult({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Section title="Trip PIN">
      <KeyValue
        label="State"
        value={
          pin.verifiedAt
            ? `Verified ${when(pin.verifiedAt)}`
            : pin.waivedAt
              ? `Waived ${when(pin.waivedAt)} by ${pin.waivedBy ?? "—"}`
              : pin.required
                ? pin.blocked
                  ? "Required · entry blocked after repeated wrong PINs"
                  : "Required · not entered yet"
                : "Not required for this assignment"
        }
      />
      <KeyValue
        label="Wrong attempts"
        value={`${pin.failedAttempts} since the last lock · ${pin.lockouts} lock${pin.lockouts === 1 ? "" : "s"}`}
      />
      <Text className="text-xs text-general-200 mt-2">
        The PIN itself is never shown here. Waive it only after confirming the
        passenger is with the driver, for example when their phone is
        unavailable. The waiver is audited, the passenger is notified, and it
        ends if the ride is re-matched.
      </Text>
      {result && <Notice tone={result.tone} text={result.text} />}
      {pin.canWaive && canWaive && (
        <View className="mt-3">
          <Field
            label="Why the PIN can't be used (at least 10 characters, kept in the audit log)"
            value={reason}
            onChangeText={setReason}
            multiline
          />
          <ActionButton
            title="Allow start without PIN"
            tone="danger"
            disabled={busy || reason.trim().length < 10}
            onPress={waive}
          />
        </View>
      )}
    </Section>
  );
};

const RideDetailPage = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useApiQuery<AdminRideDetail>(`/api/admin/rides/${id}`);
  const d = detail.data;

  if (!d) {
    return detail.status === "error" ? (
      <Notice tone="error" text={detail.error} />
    ) : (
      <Text className="text-sm text-general-200">Loading…</Text>
    );
  }

  const r = d.ride;
  return (
    <View>
      <Pressable onPress={() => router.push("/admin/rides")}>
        <Text className="text-sm text-[#0286FF]">← Rides</Text>
      </Pressable>
      {detail.status === "error" && <Notice tone="error" text={detail.error} />}
      <Section
        title={`Ride ${shortId(r.id)}`}
        right={
          <ActionButton
            title="Refresh"
            tone="neutral"
            onPress={detail.refetch}
          />
        }
      >
        <KeyValue label="Ride ID" value={r.id} />
        <KeyValue label="Status" value={r.status} />
        <KeyValue label="Payment" value={r.paymentStatus} />
        <KeyValue label="Fare" value={formatCents(r.fareCents)} />
        <KeyValue
          label="Captured"
          value={r.capturedCents === null ? "—" : formatCents(r.capturedCents)}
        />
        <KeyValue label="Refunded" value={formatCents(r.refundedCents)} />
        <KeyValue
          label="Passenger"
          value={`${d.passenger.name ?? "No name"} (${d.passenger.account})`}
        />
        <KeyValue
          label="Driver"
          value={
            d.driver
              ? `${d.driver.name} · ${d.driver.vehicle} · ${d.driver.plate}`
              : "—"
          }
        />
        <KeyValue
          label="Route"
          value={`${r.pickupAddress} → ${r.destinationAddress}`}
        />
        {r.stopAddresses.length > 0 && (
          <KeyValue
            label={`Stops (${r.stopsCompleted} of ${r.stopAddresses.length} reached)`}
            value={r.stopAddresses
              .map((address, index) => `${index + 1}. ${address}`)
              .join(" · ")}
          />
        )}
        <KeyValue
          label="Vehicle category"
          value={r.categoryName ?? "None (requested before categories)"}
        />
        <KeyValue label="Passengers" value={String(r.passengerCount)} />
        <KeyValue label="Created" value={when(r.createdAt)} />
        <KeyValue label="Completed" value={when(r.completedAt)} />
        <KeyValue label="Ended" value={when(r.endedAt)} />
        {r.cancelledBy && (
          <KeyValue
            label="Cancelled by"
            value={`${r.cancelledBy}${r.cancelReason ? ` · ${r.cancelReason}` : ""}`}
          />
        )}
        <KeyValue label="Re-matches" value={String(r.rematchCount)} />
        <KeyValue
          label="Stripe PaymentIntent"
          value={r.stripePaymentIntentId ?? "—"}
        />
        {r.isLegacyDemo && (
          <Notice
            tone="warning"
            text="Legacy demo ride without a real payment."
          />
        )}
      </Section>

      <ReviewPanel detail={d} onChanged={detail.refetch} />

      <PinPanel detail={d} onChanged={detail.refetch} />

      <CollectionSection detail={d} onChanged={detail.refetch} />

      <Section title="Settlement">
        <KeyValue label="State" value={d.settlement.state} />
        <KeyValue label="Attempts" value={String(d.settlement.attempts)} />
        <KeyValue label="Last error" value={d.settlement.lastError ?? "—"} />
        <KeyValue
          label="Next attempt"
          value={when(d.settlement.nextAttemptAt)}
        />
        <KeyValue label="Settled" value={when(d.settlement.settledAt)} />
        <KeyValue
          label="Authorization expires"
          value={when(d.settlement.authorizationExpiresAt)}
        />
      </Section>

      <RefundPanel
        title="Fare refunds (Stripe test mode only)"
        summary={d.refundable}
        refunds={d.refunds}
        createPath={`/api/admin/rides/${d.ride.id}/refunds`}
        syncPath={(id) => `/api/admin/refunds/${id}/sync`}
        support={d.support}
        onChanged={detail.refetch}
      />

      {d.earnings.tip && d.earnings.tipRefundable && (
        <RefundPanel
          title="Tip refunds (Stripe test mode only)"
          summary={d.earnings.tipRefundable}
          refunds={d.earnings.tipRefunds}
          createPath={`/api/admin/tips/${d.earnings.tip.id}/refunds`}
          syncPath={(id) => `/api/admin/tip-refunds/${id}/sync`}
          support={[]}
          onChanged={detail.refetch}
        />
      )}

      <DisputesPanel
        rideId={d.ride.id}
        disputes={d.earnings.disputes}
        onChanged={detail.refetch}
      />

      {d.support.length > 0 && (
        <Section title="Support requests">
          {d.support.map((s) => (
            <Pressable
              key={s.id}
              onPress={() =>
                router.push({
                  pathname: "/admin/support/[id]",
                  params: { id: s.id },
                })
              }
              className="py-1"
            >
              <Text className="text-sm text-[#0286FF]">
                {shortId(s.id)} · {s.category.replace(/_/g, " ")} ·{" "}
                {s.status.replace("_", " ")} · {when(s.createdAt)}
              </Text>
            </Pressable>
          ))}
        </Section>
      )}

      <Section title="Transition log">
        {d.events.map((e, i) => (
          <Text key={i} className="text-sm py-1">
            {when(e.createdAt)} · {e.fromStatus} → {e.toStatus} · {e.actor}
            {e.reason ? ` · ${e.reason}` : ""}
          </Text>
        ))}
      </Section>

      <Section title="Matching attempts">
        {d.offers.length === 0 && (
          <Text className="text-sm text-general-200">No offers were made.</Text>
        )}
        {d.offers.map((o, i) => (
          <Text key={i} className="text-sm py-1">
            {when(o.createdAt)} · {o.driverName} · {o.status} ·{" "}
            {(o.distanceMeters / 1000).toFixed(1)} km away
            {o.respondedAt
              ? ` · responded ${when(o.respondedAt)}`
              : ` · expires ${when(o.expiresAt)}`}
          </Text>
        ))}
      </Section>

      <Section title="Payment ledger">
        {d.ledger.length === 0 && (
          <Text className="text-sm text-general-200">No ledger entries.</Text>
        )}
        {d.ledger.map((l, i) => (
          <Text key={i} className="text-sm py-1">
            {when(l.createdAt)} · {l.kind}
            {l.amountCents !== null
              ? ` · ${formatCents(l.amountCents)}`
              : ""} · {l.actor}
            {l.detail ? ` · ${l.detail}` : ""}
          </Text>
        ))}
      </Section>

      <Section title="Notifications">
        {d.notifications.length === 0 && (
          <Text className="text-sm text-general-200">No notifications.</Text>
        )}
        {d.notifications.map((n, i) => (
          <Text key={i} className="text-sm py-1">
            {when(n.createdAt)} · {n.kind} → {n.recipient} · {n.status} (
            {n.attempts} attempts)
            {n.lastError ? ` · ${n.lastError}` : ""}
          </Text>
        ))}
      </Section>

      <Section title="Driver earnings (no payouts)">
        <Notice
          tone={d.earnings.reconciliation.ok ? "success" : "warning"}
          text={
            d.earnings.reconciliation.ok
              ? "Earnings ledger matches the payment ledger."
              : `Reconciliation issues: ${d.earnings.reconciliation.issues.join("; ")}`
          }
        />
        {d.earnings.record ? (
          <>
            <KeyValue label="Driver" value={d.earnings.record.driverName} />
            <KeyValue
              label="Fare captured"
              value={formatCents(d.earnings.record.fareCents)}
            />
            <KeyValue
              label="Commission"
              value={`${formatCents(d.earnings.record.commissionCents)} (${d.earnings.record.commissionRateBps / 100}%, policy ${d.earnings.record.policyVersion})`}
            />
            <KeyValue
              label="Driver share"
              value={formatCents(d.earnings.record.driverShareCents)}
            />
            <KeyValue label="Earned" value={when(d.earnings.record.earnedAt)} />
          </>
        ) : (
          <Text className="text-sm text-general-200">
            No earning recorded: the fare hasn&apos;t been captured.
          </Text>
        )}
        {d.earnings.tip && (
          <KeyValue
            label="Tip"
            value={`${formatCents(d.earnings.tip.amountCents)} · ${d.earnings.tip.status}${d.earnings.tip.refundedCents ? ` · ${formatCents(d.earnings.tip.refundedCents)} refunded` : ""}${d.earnings.tip.stripePaymentIntentId ? ` · ${d.earnings.tip.stripePaymentIntentId}` : ""}`}
          />
        )}
        {d.earnings.entries.map((e, i) => (
          <Text key={i} className="text-sm py-1">
            {when(e.occurredAt)} · {e.kind} · gross {formatCents(e.grossCents)}{" "}
            · commission {formatCents(e.commissionCents)} · driver{" "}
            {formatCents(e.driverAmountCents)} · {e.policyVersion}
          </Text>
        ))}
      </Section>

      <Section title="Ratings">
        {d.ratings.length === 0 && (
          <Text className="text-sm text-general-200">No ratings yet.</Text>
        )}
        {d.ratings.map((g) => (
          <View key={g.id} className="py-1">
            <Text className="text-sm">
              {g.raterRole} gave {g.stars}/5 · {g.status} · {when(g.createdAt)}
            </Text>
            {g.comment && (
              <Text className="text-xs text-neutral-600" selectable>
                {g.comment}
              </Text>
            )}
          </View>
        ))}
      </Section>

      <Section title="Operator audit">
        {d.audit.length === 0 && (
          <Text className="text-sm text-general-200">
            No operator actions yet.
          </Text>
        )}
        {d.audit.map((a, i) => (
          <Text key={i} className="text-sm py-1">
            {when(a.createdAt)} · {a.actor} · {a.action} · {a.result}
            {a.reason ? ` · ${a.reason}` : ""}
          </Text>
        ))}
      </Section>
    </View>
  );
};

export default RideDetailPage;
