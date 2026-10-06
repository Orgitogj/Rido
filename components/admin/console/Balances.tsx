import * as Crypto from "expo-crypto";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  ActionButton,
  Chip,
  Field,
  KeyValue,
  Notice,
  Section,
  when,
} from "@/components/admin/ui";
import { useOperator } from "@/lib/adminApi";
import { dollarsToCents } from "@/lib/adminFormat";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import { formatCents } from "@/shared/contracts";

import type {
  DriverBalanceDetail,
  DriverBalanceItem,
} from "@/shared/contracts";

type Direction = "to_driver" | "from_driver";
type Method = "bank_transfer" | "cash";

const netText = (cents: number) =>
  cents > 0
    ? `Business owes the driver ${formatCents(cents)}`
    : cents < 0
      ? `Driver owes the business ${formatCents(-cents)}`
      : "Settled";

const DriverPanel = ({
  profileId,
  onChanged,
}: {
  profileId: string;
  onChanged: () => void;
}) => {
  const request = useApi();
  const detail = useApiQuery<DriverBalanceDetail>(
    `/api/admin/balances/${profileId}`,
  );
  const [direction, setDirection] = useState<Direction>("to_driver");
  const [method, setMethod] = useState<Method>("bank_transfer");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const key = useRef(Crypto.randomUUID());
  const d = detail.data;
  const cents = dollarsToCents(amount);
  const whole = cents !== null && cents % 100 === 0;

  const submit = async () => {
    if (cents === null || !whole || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await request(`/api/admin/balances/${profileId}`, {
        body: {
          direction,
          amountCents: cents,
          method,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          idempotencyKey: key.current,
        },
      });
      key.current = Crypto.randomUUID();
      setAmount("");
      setReference("");
      setNote("");
      setMessage({ tone: "success", text: "Transfer recorded." });
    } catch (e) {
      setMessage({
        tone: "error",
        text: e instanceof ApiRequestError ? e.message : "Couldn't save.",
      });
    } finally {
      setBusy(false);
      detail.refetch();
      onChanged();
    }
  };

  if (!d) {
    return detail.status === "error" ? (
      <Notice tone="error" text={detail.error} />
    ) : (
      <Text className="text-sm text-general-200">Loading…</Text>
    );
  }

  return (
    <Section
      title={`${d.displayName} · ${netText(d.balance.netOwedToDriverCents)}`}
    >
      <KeyValue
        label="Driver's share of terminal payments"
        value={formatCents(d.balance.earnedHeldByPlatformCents)}
      />
      <KeyValue
        label="Commission on cash trips"
        value={formatCents(d.balance.commissionOnCashCents)}
      />
      <KeyValue
        label="Transferred to the driver"
        value={formatCents(d.balance.paidToDriverCents)}
      />
      <KeyValue
        label="Received from the driver"
        value={formatCents(d.balance.receivedFromDriverCents)}
      />
      <Text className="text-xs text-general-200 mt-2">
        This records a transfer you have already made or received outside this
        system. It does not move money. Entries can&apos;t be edited; record a
        transfer in the other direction to correct a mistake.
      </Text>
      <View className="flex flex-row flex-wrap mt-3">
        <Chip
          label="Paid to the driver"
          active={direction === "to_driver"}
          onPress={() => setDirection("to_driver")}
        />
        <Chip
          label="Received from the driver"
          active={direction === "from_driver"}
          onPress={() => setDirection("from_driver")}
        />
      </View>
      <View className="flex flex-row flex-wrap">
        <Chip
          label="Bank transfer"
          active={method === "bank_transfer"}
          onPress={() => setMethod("bank_transfer")}
        />
        <Chip
          label="Cash"
          active={method === "cash"}
          onPress={() => setMethod("cash")}
        />
      </View>
      <View className="flex flex-row flex-wrap">
        <Field
          label="Amount (whole lek)"
          value={amount}
          onChangeText={setAmount}
        />
        <Field
          label="Bank reference (optional)"
          value={reference}
          onChangeText={setReference}
        />
        <Field
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          width="w-96"
        />
      </View>
      {amount.trim() !== "" && (cents === null || !whole) && (
        <Notice
          tone="warning"
          text="Enter a whole amount in lek, for example 1500."
        />
      )}
      {message && <Notice tone={message.tone} text={message.text} />}
      <View className="flex flex-row mt-2">
        <ActionButton
          title={busy ? "Saving…" : "Record transfer"}
          disabled={busy || cents === null || !whole}
          onPress={submit}
        />
      </View>
      <Text className="text-sm font-JakartaSemiBold mt-4">
        Recorded transfers
      </Text>
      {d.settlements.length === 0 && (
        <Text className="text-sm text-general-200">None yet.</Text>
      )}
      {d.settlements.map((s) => (
        <Text key={s.id} className="text-sm py-0.5">
          {when(s.createdAt)} ·{" "}
          {s.direction === "to_driver" ? "to driver" : "from driver"} ·{" "}
          {formatCents(s.amountCents, s.currency)} ·{" "}
          {s.method === "bank_transfer" ? "bank transfer" : "cash"}
          {s.reference ? ` · ${s.reference}` : ""}
          {s.operator ? ` · ${s.operator}` : ""}
          {s.note ? ` · ${s.note}` : ""}
        </Text>
      ))}
    </Section>
  );
};

const Balances = () => {
  const operator = useOperator();
  const allowed = operator?.permissions.includes("refund") ?? false;
  const list = useApiQuery<DriverBalanceItem[]>(
    allowed ? "/api/admin/balances" : null,
  );
  const [selected, setSelected] = useState<string | null>(null);

  if (!allowed) {
    return (
      <Section title="Driver balances">
        <Notice
          tone="info"
          text="Driver balances and transfers need the refund permission."
        />
      </Section>
    );
  }

  return (
    <View>
      <Section
        title="Driver balances"
        right={
          <ActionButton title="Refresh" tone="neutral" onPress={list.refetch} />
        }
      >
        <Text className="text-xs text-general-200 mb-2">
          Terminal payments go to the business, which owes each driver their
          share. Cash stays with the driver, who owes the business its
          commission. A positive balance is owed to the driver.
        </Text>
        {list.status === "error" && <Notice tone="error" text={list.error} />}
        {list.status === "loading" && !list.data && (
          <Text className="text-sm text-general-200">Loading…</Text>
        )}
        {list.data?.length === 0 && (
          <Notice tone="info" text="No drivers with earnings yet." />
        )}
        {list.data?.map((item) => (
          <Pressable
            key={item.driverProfileId}
            onPress={() => setSelected(item.driverProfileId)}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === item.driverProfileId }}
            className={`py-3 border-b border-neutral-100 hover:bg-neutral-50 ${selected === item.driverProfileId ? "bg-blue-50" : ""}`}
          >
            <View className="flex flex-row justify-between">
              <Text className="text-sm font-JakartaSemiBold">
                {item.displayName}
              </Text>
              <Text
                className={`text-sm ${item.balance.netOwedToDriverCents !== 0 ? "font-JakartaBold" : "text-general-200"}`}
              >
                {netText(item.balance.netOwedToDriverCents)}
              </Text>
            </View>
            <Text className="text-xs text-general-200 mt-1">
              Last transfer {when(item.balance.lastSettlementAt)}
            </Text>
          </Pressable>
        ))}
      </Section>
      {selected && (
        <DriverPanel
          key={selected}
          profileId={selected}
          onChanged={list.refetch}
        />
      )}
    </View>
  );
};

export default Balances;
