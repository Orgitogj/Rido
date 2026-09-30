import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  ActionButton,
  Field,
  KeyValue,
  Notice,
  Section,
  shortId,
  when,
} from "@/components/admin/ui";
import { useOperator } from "@/lib/adminApi";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import { SAFETY_CATEGORY_LABEL, SAFETY_STATUS_LABEL } from "@/lib/safetyText";

import type { AdminSafetyDetail } from "@/shared/contracts";

type Action =
  "assign" | "in_review" | "resolve" | "dismiss" | "reopen" | "note";

const SafetyCase = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const operator = useOperator();
  const allowed = operator?.permissions.includes("support") ?? false;
  const request = useApi();
  const query = useApiQuery<AdminSafetyDetail>(
    allowed ? `/api/admin/safety/${id}` : null,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const d = query.data;

  const act = async (action: Action) => {
    if (!d) return;
    setBusy(true);
    setMessage(null);
    try {
      await request(`/api/admin/safety/${id}/triage`, {
        body: {
          action,
          expectedVersion: d.version,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setNote("");
      setMessage({ tone: "success", text: "Saved." });
    } catch (e) {
      setMessage({
        tone: "error",
        text: e instanceof ApiRequestError ? e.message : "Couldn't save.",
      });
    } finally {
      setBusy(false);
      query.refetch();
    }
  };

  if (!allowed) {
    return (
      <Notice tone="info" text="Safety reports need the support permission." />
    );
  }
  if (!d) {
    return query.status === "error" ? (
      <View>
        <Notice tone="error" text={query.error} />
        <ActionButton title="Retry" tone="neutral" onPress={query.refetch} />
      </View>
    ) : (
      <Text className="text-sm text-general-200">Loading…</Text>
    );
  }

  const closed = d.status === "resolved" || d.status === "dismissed";
  const needsNote = (a: Action) => a !== "assign" && a !== "in_review";
  const button = (
    a: Action,
    title: string,
    tone: "primary" | "danger" | "neutral" = "primary",
  ) => (
    <ActionButton
      key={a}
      title={title}
      tone={tone}
      disabled={busy || (needsNote(a) && note.trim().length < 3)}
      onPress={() => act(a)}
    />
  );

  return (
    <View>
      <Pressable onPress={() => router.push("/admin/safety")}>
        <Text className="text-sm text-[#0286FF]">← Safety reports</Text>
      </Pressable>

      <Section title={`Safety report ${shortId(d.id)}`}>
        <KeyValue label="Category" value={SAFETY_CATEGORY_LABEL[d.category]} />
        <KeyValue label="Status" value={SAFETY_STATUS_LABEL[d.status]} />
        <KeyValue
          label="Reported by"
          value={`${d.reporterRole} · ${d.reporter.name ?? "No name"} (${d.reporter.account})`}
        />
        <KeyValue
          label="Assigned to"
          value={d.assignedToMe ? "You" : (d.assignedTo ?? "Nobody")}
        />
        <KeyValue label="Created" value={when(d.createdAt)} />
        <KeyValue label="Closed" value={when(d.closedAt)} />
        <KeyValue
          label="Evidence kept until"
          value={
            d.evidenceRetainedUntil
              ? when(d.evidenceRetainedUntil)
              : "While the report is open"
          }
        />
        <Text className="text-sm mt-4 font-JakartaSemiBold">Description</Text>
        <Text className="text-sm mt-1" selectable>
          {d.description}
        </Text>
        {d.resolutionNote && (
          <>
            <Text className="text-sm mt-4 font-JakartaSemiBold">
              Resolution
            </Text>
            <Text className="text-sm mt-1">{d.resolutionNote}</Text>
          </>
        )}
        {message && <Notice tone={message.tone} text={message.text} />}
      </Section>

      <Section title="Triage">
        <Field
          label="Note (required to resolve, dismiss, reopen or add a note)"
          value={note}
          onChangeText={setNote}
          multiline
        />
        <View className="flex flex-row flex-wrap">
          {!closed &&
            !d.assignedToMe &&
            button(
              "assign",
              d.assignedTo ? `Assigned to ${d.assignedTo}` : "Assign to me",
            )}
          {d.status === "open" &&
            button("in_review", "Mark in review", "neutral")}
          {!closed && d.assignedToMe && button("resolve", "Resolve")}
          {!closed && d.assignedToMe && button("dismiss", "Dismiss", "danger")}
          {closed && button("reopen", "Reopen", "neutral")}
          {button("note", "Add note", "neutral")}
        </View>
      </Section>

      <Section title={`Ride ${shortId(d.rideId)}`}>
        <KeyValue label="Status" value={d.ride.status} />
        <KeyValue
          label="Passenger"
          value={`${d.ride.passenger.name ?? "No name"} (${d.ride.passenger.account})`}
        />
        <KeyValue
          label="Current driver"
          value={
            d.ride.driver
              ? `${d.ride.driver.name} · ${d.ride.driver.vehicle} · ${d.ride.driver.plate}`
              : "—"
          }
        />
        <KeyValue label="Re-matches" value={String(d.ride.rematchCount)} />
        <KeyValue label="Created" value={when(d.ride.createdAt)} />
        <KeyValue label="Ended" value={when(d.ride.endedAt)} />
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/admin/rides/[id]",
              params: { id: d.rideId },
            })
          }
          className="mt-2"
        >
          <Text className="text-sm text-[#0286FF]">Open ride →</Text>
        </Pressable>
        <Text className="text-sm mt-4 font-JakartaSemiBold">Ride events</Text>
        {d.rideEvents.map((e, i) => (
          <Text key={i} className="text-sm py-0.5">
            {when(e.createdAt)} · {e.fromStatus} → {e.toStatus} · {e.actor}
            {e.reason ? ` · ${e.reason}` : ""}
          </Text>
        ))}
      </Section>

      <Section title="Reported messages">
        <Text className="text-xs text-general-200 mb-2">
          Only messages a participant reported are shown. The rest of the
          conversation stays private.
        </Text>
        {d.messages.length === 0 && (
          <Text className="text-sm text-general-200">
            No messages were reported.
          </Text>
        )}
        {d.messages.map((m) => (
          <View key={m.messageId} className="py-2 border-b border-neutral-100">
            <Text className="text-xs text-general-200">
              #{m.seq} · from {m.senderRole} · {when(m.sentAt)}
            </Text>
            <Text className="text-sm mt-1" selectable>
              {m.redacted ? "Removed after the retention period." : m.body}
            </Text>
          </View>
        ))}
      </Section>

      <Section title="History">
        {d.history.map((h, i) => (
          <Text key={i} className="text-sm py-0.5">
            {when(h.createdAt)} · {h.action.replace(/_/g, " ")}
            {h.toStatus && h.fromStatus !== h.toStatus
              ? ` → ${h.toStatus}`
              : ""}
            {h.operator ? ` · ${h.operator}` : ` · ${h.actor}`}
            {h.note ? ` · ${h.note}` : ""}
          </Text>
        ))}
      </Section>
    </View>
  );
};

export default SafetyCase;
