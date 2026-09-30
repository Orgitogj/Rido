import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import {
  ActionButton,
  Chip,
  ListRow,
  Notice,
  Section,
  when,
} from "@/components/admin/ui";
import { useOperator, usePaged } from "@/lib/adminApi";
import { APPLICATION_STATUS } from "@/lib/driverVerification";
import {
  type AdminDriverItem,
  type DriverApplicationStatus,
  driverApplicationStatuses,
} from "@/shared/contracts";

type Filter = DriverApplicationStatus | "needs_review" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "needs_review", label: "Needs review" },
  ...driverApplicationStatuses.map((s) => ({
    value: s,
    label: APPLICATION_STATUS[s].title,
  })),
  { value: "all", label: "All" },
];

const DriverQueue = () => {
  const operator = useOperator();
  if (!(operator?.permissions.includes("verify") ?? false)) {
    return (
      <Section title="Driver applications">
        <Notice
          tone="info"
          text="Reviewing drivers needs the verify permission."
        />
      </Section>
    );
  }
  return <DriverList />;
};

const DriverList = () => {
  const [status, setStatus] = useState<Filter>("needs_review");
  const list = usePaged<AdminDriverItem>("/api/admin/drivers", { status });

  return (
    <Section title="Driver applications">
      <View className="flex flex-row flex-wrap">
        {FILTERS.map((f) => (
          <Chip
            key={f.value}
            label={f.label}
            active={status === f.value}
            onPress={() => setStatus(f.value)}
          />
        ))}
      </View>
      {list.status === "error" && list.error && (
        <Notice tone="error" text={list.error} />
      )}
      {list.status === "loading" && list.items.length === 0 && (
        <Text className="text-sm text-general-200">Loading…</Text>
      )}
      {list.status === "ready" && list.items.length === 0 && (
        <Notice tone="success" text="No applications match this filter." />
      )}
      {list.items.map((item) => (
        <ListRow
          key={item.id}
          onPress={() =>
            router.push({
              pathname: "/admin/drivers/[id]",
              params: { id: item.id },
            })
          }
        >
          <View className="flex flex-row justify-between">
            <Text className="text-sm font-JakartaSemiBold">
              {item.displayName} · {APPLICATION_STATUS[item.status].title}
              {item.status === "approved" && !item.eligible ? " (expired)" : ""}
              {item.documentsWaived ? " · documents waived" : ""}
            </Text>
            <Text className="text-xs text-general-200">
              {when(item.submittedAt ?? item.updatedAt)}
            </Text>
          </View>
          <Text className="text-xs text-neutral-600 mt-1">
            {item.vehicle} · {item.plate}
            {item.approvalExpiresAt
              ? ` · approval until ${when(item.approvalExpiresAt)}`
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

export default DriverQueue;
