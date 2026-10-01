import * as Crypto from "expo-crypto";
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

import type { SupportMessageView } from "@/shared/account";
import type { AdminSupportDetail } from "@/shared/contracts";

const SupportDetailPage = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const operator = useOperator();
  const request = useApi();
  const support = useApiQuery<AdminSupportDetail>(`/api/admin/support/${id}`);
  const thread = useApiQuery<SupportMessageView[]>(
    `/api/admin/support/${id}/messages`,
  );
  const [reply, setReply] = useState("");
  const [replyId, setReplyId] = useState(() => Crypto.randomUUID());
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const canAct = operator?.permissions.includes("support") ?? false;
  const s = support.data;

  const act = async (path: string, body: object, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await request(`/api/admin/support/${id}/${path}`, { body });
      setMessage({ tone: "success", text: success });
      setNote("");
    } catch (e) {
      setMessage({
        tone: "error",
        text:
          e instanceof ApiRequestError ? e.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
      support.refetch();
    }
  };

  const sendReply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await request(`/api/admin/support/${id}/messages`, {
        body: { body: reply.trim(), clientMessageId: replyId },
      });
      setReply("");
      setReplyId(Crypto.randomUUID());
      setMessage({ tone: "success", text: "Reply sent to the passenger." });
    } catch (e) {
      setMessage({
        tone: "error",
        text:
          e instanceof ApiRequestError ? e.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
      thread.refetch();
      support.refetch();
    }
  };

  if (!s) {
    return support.status === "error" ? (
      <Notice tone="error" text={support.error} />
    ) : (
      <Text className="text-sm text-general-200">Loading…</Text>
    );
  }

  return (
    <View>
      <Pressable onPress={() => router.push("/admin/support")}>
        <Text className="text-sm text-[#0286FF]">← Support requests</Text>
      </Pressable>
      <Section title={`Support request ${shortId(s.id)}`}>
        <KeyValue label="Status" value={s.status.replace("_", " ")} />
        <KeyValue label="Category" value={s.category.replace(/_/g, " ")} />
        <KeyValue
          label="Passenger"
          value={`${s.passenger.name ?? "No name"} (${s.passenger.account})`}
        />
        <KeyValue
          label="Assigned to"
          value={s.assignedToMe ? "You" : (s.assignedTo ?? "Nobody")}
        />
        <KeyValue label="Created" value={when(s.createdAt)} />
        <KeyValue label="Last updated" value={when(s.updatedAt)} />
        {s.resolvedAt && (
          <KeyValue
            label="Resolved"
            value={`${when(s.resolvedAt)} by ${s.resolvedBy ?? "—"}`}
          />
        )}
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/admin/rides/[id]",
              params: { id: s.rideId },
            })
          }
          className="mt-2"
        >
          <Text className="text-sm text-[#0286FF]">
            Open ride {shortId(s.rideId)} →
          </Text>
        </Pressable>
        <Text className="text-sm mt-4 font-JakartaSemiBold">
          Passenger&apos;s message
        </Text>
        <Text className="text-sm mt-1" selectable>
          {s.message}
        </Text>
        {s.resolutionMessage && (
          <>
            <Text className="text-sm mt-4 font-JakartaSemiBold">
              Closing message shown to the passenger
            </Text>
            <Text className="text-sm mt-1">{s.resolutionMessage}</Text>
          </>
        )}
        {message && <Notice tone={message.tone} text={message.text} />}
      </Section>

      <Section title="Conversation (visible to the passenger)">
        {thread.status === "error" && (
          <Notice tone="error" text={thread.error} />
        )}
        {(thread.data ?? []).length === 0 && thread.status !== "error" && (
          <Text className="text-sm text-general-200">
            No messages have been exchanged yet.
          </Text>
        )}
        {(thread.data ?? []).map((m) => (
          <View key={m.id} className="py-2 border-b border-neutral-100">
            <Text className="text-xs text-general-200">
              {m.author === "operator" ? "Support" : "Passenger"} ·{" "}
              {when(m.createdAt)}
            </Text>
            <Text className="text-sm mt-1" selectable>
              {m.body}
            </Text>
          </View>
        ))}
        {canAct && s.status !== "resolved" && s.assignedToMe && (
          <View className="mt-3">
            <Field
              label="Reply to the passenger (they will see this and be notified)"
              value={reply}
              onChangeText={setReply}
              multiline
            />
            <ActionButton
              title="Send reply"
              disabled={busy || reply.trim().length === 0}
              onPress={sendReply}
            />
          </View>
        )}
        {canAct && s.status !== "resolved" && !s.assignedToMe && (
          <Text className="text-xs text-general-200 mt-2">
            Assign this request to yourself to reply.
          </Text>
        )}
      </Section>

      {canAct ? (
        <Section title="Actions">
          {s.status !== "resolved" && !s.assignedToMe && (
            <ActionButton
              title={
                s.assignedTo ? `Assigned to ${s.assignedTo}` : "Assign to me"
              }
              disabled={busy || s.assignedTo !== null}
              onPress={() =>
                act(
                  "assign",
                  { expectedVersion: s.version },
                  "Assigned to you.",
                )
              }
            />
          )}
          {s.status !== "resolved" && s.assignedToMe && (
            <>
              <Field
                label="Closing message to the passenger (they will see this)"
                value={resolution}
                onChangeText={setResolution}
                multiline
              />
              <ActionButton
                title="Resolve"
                disabled={busy || resolution.trim().length < 3}
                onPress={() =>
                  act(
                    "resolve",
                    {
                      expectedVersion: s.version,
                      resolutionMessage: resolution.trim(),
                    },
                    "Resolved.",
                  )
                }
              />
            </>
          )}
          {s.status === "resolved" && (
            <>
              <Field
                label="Reason for reopening"
                value={reopenReason}
                onChangeText={setReopenReason}
                multiline
              />
              <ActionButton
                title="Reopen"
                tone="neutral"
                disabled={busy || reopenReason.trim().length < 3}
                onPress={() =>
                  act(
                    "reopen",
                    { expectedVersion: s.version, reason: reopenReason.trim() },
                    "Reopened.",
                  )
                }
              />
            </>
          )}
        </Section>
      ) : (
        <Notice
          tone="info"
          text="You have view-only access to support requests."
        />
      )}

      <Section title="Internal notes (never shown to the passenger)">
        {s.notes.length === 0 && (
          <Text className="text-sm text-general-200">No notes yet.</Text>
        )}
        {s.notes.map((n, i) => (
          <View key={i} className="py-2 border-b border-neutral-100">
            <Text className="text-xs text-general-200">
              {n.author} · {when(n.createdAt)}
            </Text>
            <Text className="text-sm mt-1" selectable>
              {n.note}
            </Text>
          </View>
        ))}
        {canAct && (
          <View className="mt-3">
            <Field
              label="Add a note"
              value={note}
              onChangeText={setNote}
              multiline
            />
            <ActionButton
              title="Add note"
              disabled={busy || note.trim().length === 0}
              onPress={() => act("notes", { note: note.trim() }, "Note added.")}
            />
          </View>
        )}
      </Section>

      <Section title="History">
        {s.history.map((h, i) => (
          <Text key={i} className="text-sm py-1">
            {when(h.createdAt)} · {h.action.replace("_", " ")}
            {h.toStatus ? ` → ${h.toStatus.replace("_", " ")}` : ""}
            {h.operator ? ` · ${h.operator}` : " · passenger"}
          </Text>
        ))}
      </Section>
    </View>
  );
};

export default SupportDetailPage;
