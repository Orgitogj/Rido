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

import type { AdminSupportItem, SupportStatus } from "@/shared/contracts";

const STATUSES: { value: SupportStatus | ""; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "", label: "All" },
];

const ASSIGNED = [
  { value: "any", label: "Anyone" },
  { value: "me", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
] as const;

const ROLES = [
  { value: "", label: "Passengers and drivers" },
  { value: "passenger", label: "Passengers" },
  { value: "driver", label: "Drivers" },
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SupportQueue = () => {
  const [status, setStatus] = useState<SupportStatus | "">("open");
  const [assigned, setAssigned] = useState<"any" | "me" | "unassigned">("any");
  const [role, setRole] = useState<"" | "passenger" | "driver">("");
  const [rideId, setRideId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = usePaged<AdminSupportItem>("/api/admin/support", {
    status: status || undefined,
    role: role || undefined,
    assigned,
    rideId: UUID.test(rideId.trim()) ? rideId.trim() : undefined,
    ...dayRange(from, to),
  });

  return (
    <Section title="Support requests">
      <View className="flex flex-row flex-wrap">
        {STATUSES.map((s) => (
          <Chip
            key={s.label}
            label={s.label}
            active={status === s.value}
            onPress={() => setStatus(s.value)}
          />
        ))}
      </View>
      <View className="flex flex-row flex-wrap">
        {ASSIGNED.map((a) => (
          <Chip
            key={a.value}
            label={a.label}
            active={assigned === a.value}
            onPress={() => setAssigned(a.value)}
          />
        ))}
      </View>
      <View className="flex flex-row flex-wrap">
        {ROLES.map((r) => (
          <Chip
            key={r.label}
            label={r.label}
            active={role === r.value}
            onPress={() => setRole(r.value)}
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
      {rideId.trim() !== "" && !UUID.test(rideId.trim()) && (
        <Notice tone="warning" text="Enter a full ride ID to filter by ride." />
      )}
      {list.status === "error" && list.error && (
        <Notice tone="error" text={list.error} />
      )}
      {list.status === "ready" && list.items.length === 0 && (
        <Notice tone="info" text="No support requests match these filters." />
      )}
      {list.items.map((item) => (
        <ListRow
          key={item.id}
          onPress={() =>
            router.push({
              pathname: "/admin/support/[id]",
              params: { id: item.id },
            })
          }
        >
          <View className="flex flex-row justify-between">
            <Text className="text-sm font-JakartaSemiBold">
              {item.role} · {item.category.replace(/_/g, " ")} ·{" "}
              {item.status.replace("_", " ")}
              {item.assignedTo
                ? ` · ${item.assignedToMe ? "you" : item.assignedTo}`
                : " · unassigned"}
            </Text>
            <Text className="text-xs text-general-200">
              {when(item.createdAt)}
            </Text>
          </View>
          <Text className="text-xs text-neutral-600 mt-1" numberOfLines={1}>
            {item.rideId ? `Ride ${shortId(item.rideId)}` : "Account"} ·{" "}
            {item.preview}
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

export default SupportQueue;
