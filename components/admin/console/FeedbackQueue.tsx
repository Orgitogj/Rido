import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  ActionButton,
  Chip,
  Field,
  Notice,
  Section,
  shortId,
  when,
} from "@/components/admin/ui";
import { useOperator, usePaged } from "@/lib/adminApi";
import { dayRange } from "@/lib/adminFormat";
import { ApiRequestError, useApi } from "@/lib/fetch";

import type { AdminFeedbackItem, FeedbackStatus } from "@/shared/contracts";

const STATUSES: { value: FeedbackStatus | "all"; label: string }[] = [
  { value: "pending", label: "Needs review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "removed", label: "Removed" },
  { value: "all", label: "All ratings" },
];

type Action = "reviewed" | "remove" | "restore";

const ACTIONS: Record<AdminFeedbackItem["status"], Action[]> = {
  none: ["remove"],
  pending: ["reviewed", "remove"],
  reviewed: ["remove"],
  removed: ["restore"],
};

const ACTION_LABEL: Record<Action, string> = {
  reviewed: "Mark reviewed",
  remove: "Remove from ratings",
  restore: "Restore",
};

const FeedbackRow = ({
  item,
  canAct,
  onChanged,
}: {
  item: AdminFeedbackItem;
  canAct: boolean;
  onChanged: () => void;
}) => {
  const request = useApi();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: Action) => {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/admin/feedback/${item.id}/moderate`, {
        body: { action, note: note.trim(), expectedVersion: item.version },
      });
      setNote("");
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Couldn't save.");
      if (e instanceof ApiRequestError && e.status === 409) onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="py-3 border-b border-neutral-100">
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
        <View className="flex flex-row justify-between">
          <Text className="text-sm font-JakartaSemiBold">
            {"★".repeat(item.stars)}
            {"☆".repeat(5 - item.stars)} · {item.raterRole} rated{" "}
            {item.raterRole === "passenger" ? "driver" : "passenger"} ·{" "}
            {item.status}
          </Text>
          <Text className="text-xs text-general-200">
            {when(item.createdAt)}
          </Text>
        </View>
        <Text className="text-sm mt-1" selectable>
          {item.comment ?? "No written feedback."}
        </Text>
        <Text className="text-xs text-neutral-600 mt-1">
          From {item.rater.name ?? "No name"} ({item.rater.account}) about{" "}
          {item.ratee.name ?? "No name"} ({item.ratee.account})
          {item.editCount > 0 ? ` · edited ${item.editCount}×` : ""}
          {item.moderatedBy
            ? ` · ${item.moderatedBy}, ${when(item.moderatedAt)}: ${item.moderationNote ?? ""}`
            : ""}
        </Text>
      </Pressable>
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/admin/rides/[id]",
            params: { id: item.rideId },
          })
        }
      >
        <Text className="text-xs text-[#0286FF] mt-1">
          Ride {shortId(item.rideId)} →
        </Text>
      </Pressable>
      {open && canAct && (
        <View className="mt-2">
          <Field
            label="Reason (kept in the audit log)"
            value={note}
            onChangeText={setNote}
            multiline
          />
          <View className="flex flex-row flex-wrap">
            {ACTIONS[item.status].map((a) => (
              <ActionButton
                key={a}
                title={ACTION_LABEL[a]}
                tone={a === "remove" ? "danger" : "primary"}
                disabled={busy || note.trim().length < 3}
                onPress={() => act(a)}
              />
            ))}
          </View>
          {error && <Notice tone="error" text={error} />}
        </View>
      )}
    </View>
  );
};

const FeedbackQueue = () => {
  const operator = useOperator();
  const canAct = operator?.permissions.includes("support") ?? false;
  const [status, setStatus] = useState<FeedbackStatus | "all">("pending");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = usePaged<AdminFeedbackItem>("/api/admin/feedback", {
    status,
    ...dayRange(from, to),
  });

  return (
    <Section title="Rating feedback">
      <Text className="text-xs text-general-200 mb-3">
        Ratings of 2 stars or less and all written feedback need review. Written
        feedback is never shown to the rated person. Removing a rating excludes
        it from their average.
      </Text>
      <View className="flex flex-row flex-wrap">
        {STATUSES.map((s) => (
          <Chip
            key={s.value}
            label={s.label}
            active={status === s.value}
            onPress={() => setStatus(s.value)}
          />
        ))}
      </View>
      <View className="flex flex-row flex-wrap mt-2">
        <Field
          label="Created from (YYYY-MM-DD)"
          value={from}
          onChangeText={setFrom}
        />
        <Field
          label="Created to (YYYY-MM-DD)"
          value={to}
          onChangeText={setTo}
        />
      </View>
      {!canAct && (
        <Notice
          tone="info"
          text="You have view-only access. Moderation needs the support permission."
        />
      )}
      {list.status === "error" && list.error && (
        <Notice tone="error" text={list.error} />
      )}
      {list.status === "ready" && list.items.length === 0 && (
        <Notice tone="success" text="Nothing to review." />
      )}
      {list.items.map((item) => (
        <FeedbackRow
          key={`${item.id}:${item.version}`}
          item={item}
          canAct={canAct}
          onChanged={list.reload}
        />
      ))}
      <View className="flex flex-row mt-3">
        {list.hasMore && (
          <ActionButton
            title={list.status === "loading" ? "Loading…" : "Load more"}
            onPress={list.loadMore}
            disabled={list.status === "loading"}
          />
        )}
        <ActionButton title="Refresh" tone="neutral" onPress={list.reload} />
      </View>
    </Section>
  );
};

export default FeedbackQueue;
