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
import { useOperator, usePaged } from "@/lib/adminApi";
import { dayRange } from "@/lib/adminFormat";
import { SAFETY_CATEGORY_LABEL, SAFETY_STATUS_LABEL } from "@/lib/safetyText";
import {
  type AdminSafetyItem,
  safetyCategories,
  type SafetyCategory,
  type SafetyReportStatus,
} from "@/shared/contracts";

const STATUSES: { value: SafetyReportStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SafetyQueue = () => {
  const operator = useOperator();
  if (!(operator?.permissions.includes("support") ?? false)) {
    return (
      <Section title="Safety reports">
        <Notice
          tone="info"
          text="Safety reports need the support permission."
        />
      </Section>
    );
  }
  return <SafetyList />;
};

const SafetyList = () => {
  const [status, setStatus] = useState<SafetyReportStatus | "all">("open");
  const [category, setCategory] = useState<SafetyCategory | "">("");
  const [rideId, setRideId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = usePaged<AdminSafetyItem>("/api/admin/safety", {
    status,
    category: category || undefined,
    rideId: UUID.test(rideId.trim()) ? rideId.trim() : undefined,
    ...dayRange(from, to),
  });

  return (
    <Section title="Safety reports">
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
      <View className="flex flex-row flex-wrap">
        <Chip
          label="Any category"
          active={category === ""}
          onPress={() => setCategory("")}
        />
        {safetyCategories.map((c) => (
          <Chip
            key={c}
            label={SAFETY_CATEGORY_LABEL[c]}
            active={category === c}
            onPress={() => setCategory(c)}
          />
        ))}
      </View>
      <View className="flex flex-row flex-wrap mt-2">
        <Field
          label="Ride ID"
          value={rideId}
          onChangeText={setRideId}
          width="w-80"
        />
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
      {list.status === "error" && list.error && (
        <Notice tone="error" text={list.error} />
      )}
      {list.status === "loading" && list.items.length === 0 && (
        <Text className="text-sm text-general-200">Loading…</Text>
      )}
      {list.status === "ready" && list.items.length === 0 && (
        <Notice tone="success" text="No safety reports match these filters." />
      )}
      {list.items.map((item) => (
        <ListRow
          key={item.id}
          onPress={() =>
            router.push({
              pathname: "/admin/safety/[id]",
              params: { id: item.id },
            })
          }
        >
          <View className="flex flex-row justify-between">
            <Text className="text-sm font-JakartaSemiBold">
              {SAFETY_CATEGORY_LABEL[item.category]} ·{" "}
              {SAFETY_STATUS_LABEL[item.status]} · from {item.reporterRole}
              {item.assignedTo
                ? ` · ${item.assignedToMe ? "you" : item.assignedTo}`
                : " · unassigned"}
            </Text>
            <Text className="text-xs text-general-200">
              {when(item.createdAt)}
            </Text>
          </View>
          <Text className="text-xs text-neutral-600 mt-1">
            Ride {shortId(item.rideId)}
            {item.reportedMessages > 0
              ? ` · ${item.reportedMessages} reported message${item.reportedMessages === 1 ? "" : "s"}`
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

export default SafetyQueue;
