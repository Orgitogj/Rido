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

import type { AdminRideListItem, PaymentStatus } from "@/shared/contracts";

const PAYMENT: (PaymentStatus | "")[] = [
  "",
  "authorized",
  "paid",
  "cancelled",
  "expired",
  "failed",
  "pending",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RideSearch = () => {
  const [rideId, setRideId] = useState("");
  const [payment, setPayment] = useState<PaymentStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const id = rideId.trim();
  const list = usePaged<AdminRideListItem>("/api/admin/rides", {
    rideId: UUID.test(id) ? id : undefined,
    paymentStatus: payment || undefined,
    ...dayRange(from, to),
  });

  return (
    <Section title="Rides">
      <View className="flex flex-row flex-wrap">
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
      <View className="flex flex-row flex-wrap">
        {PAYMENT.map((p) => (
          <Chip
            key={p || "all"}
            label={p || "Any payment state"}
            active={payment === p}
            onPress={() => setPayment(p)}
          />
        ))}
      </View>
      {id !== "" && !UUID.test(id) && (
        <Notice
          tone="warning"
          text="Enter a full ride ID (UUID) to search by ID."
        />
      )}
      {list.status === "error" && list.error && (
        <Notice tone="error" text={list.error} />
      )}
      {list.status === "ready" && list.items.length === 0 && (
        <Notice tone="info" text="No rides match these filters." />
      )}
      {list.items.map((r) => (
        <ListRow
          key={r.rideId}
          onPress={() =>
            router.push({
              pathname: "/admin/rides/[id]",
              params: { id: r.rideId },
            })
          }
        >
          <View className="flex flex-row justify-between">
            <Text className="text-sm font-JakartaSemiBold">
              {shortId(r.rideId)} · {r.status} · {r.paymentStatus}
              {r.needsReview ? " · needs review" : ""}
            </Text>
            <Text className="text-xs text-general-200">
              {when(r.createdAt)}
            </Text>
          </View>
          <Text className="text-xs text-neutral-600 mt-1" numberOfLines={1}>
            {formatCents(r.fareCents)} fare
            {r.capturedCents !== null
              ? ` · ${formatCents(r.capturedCents)} captured`
              : ""}
            {r.refundedCents > 0
              ? ` · ${formatCents(r.refundedCents)} refunded`
              : ""}{" "}
            · {r.pickupAddress} → {r.destinationAddress}
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

export default RideSearch;
