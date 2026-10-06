import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import {
  ActionButton,
  Chip,
  Field,
  ListRow,
  Notice,
  Section,
  shortId,
  when,
} from "@/components/admin/ui";
import { usePaged } from "@/lib/adminApi";
import { dayRange } from "@/lib/adminFormat";
import { formatCents } from "@/lib/utils";

import type { ReviewCategory, ReviewItem } from "@/shared/contracts";

const CATEGORIES: { value: ReviewCategory | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "interrupted_trip", label: "Interrupted trips" },
  { value: "settlement_retrying", label: "Settlement retrying" },
  { value: "settlement_failing", label: "Settlement failing" },
  {
    value: "authorization_expired_before_capture",
    label: "Authorization expired",
  },
  {
    value: "authorization_expiring_during_trip",
    label: "Authorization expiring",
  },
  { value: "passenger_unpaid", label: "Reported unpaid" },
  { value: "collection_not_recorded", label: "Payment not recorded" },
];

const ReviewQueue = () => {
  const [category, setCategory] = useState<ReviewCategory | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = usePaged<ReviewItem>("/api/admin/review", {
    category: category || undefined,
    ...dayRange(from, to),
  });

  return (
    <Section title="Review queue">
      <View className="flex flex-row flex-wrap">
        {CATEGORIES.map((c) => (
          <Chip
            key={c.label}
            label={c.label}
            active={category === c.value}
            onPress={() => setCategory(c.value)}
          />
        ))}
      </View>
      <View className="flex flex-row flex-wrap mt-2">
        <Field
          label="Updated from (YYYY-MM-DD)"
          value={from}
          onChangeText={setFrom}
        />
        <Field
          label="Updated to (YYYY-MM-DD)"
          value={to}
          onChangeText={setTo}
        />
      </View>
      {list.status === "error" && list.error && (
        <Notice tone="error" text={list.error} />
      )}
      {list.status === "ready" && list.items.length === 0 && (
        <Notice tone="success" text="Nothing needs review." />
      )}
      {list.items.map((item) => (
        <ListRow
          key={item.rideId}
          onPress={() =>
            router.push({
              pathname: "/admin/rides/[id]",
              params: { id: item.rideId },
            })
          }
        >
          <View className="flex flex-row justify-between">
            <Text className="text-sm font-JakartaSemiBold">
              {shortId(item.rideId)} · {item.category.replace(/_/g, " ")}
            </Text>
            <Text className="text-xs text-general-200">
              {when(item.updatedAt)}
            </Text>
          </View>
          <Text className="text-xs text-neutral-600 mt-1">
            Ride {item.status} · payment {item.paymentStatus} · fare{" "}
            {formatCents(item.fareCents)}
            {item.settlementAttempts > 0
              ? ` · ${item.settlementAttempts} settlement attempts (${item.settlementError ?? "no error recorded"})`
              : ""}
          </Text>
        </ListRow>
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

export default ReviewQueue;
