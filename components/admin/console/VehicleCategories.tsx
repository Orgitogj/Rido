import { useState } from "react";
import { Text, View } from "react-native";

import {
  ActionButton,
  Chip,
  Field,
  Notice,
  Section,
  when,
} from "@/components/admin/ui";
import { useOperator } from "@/lib/adminApi";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import {
  CATEGORY_RULES,
  type VehicleCategoryAdmin,
} from "@/shared/vehicleCategory";

type Tone = "error" | "success";

const parseCapacity = (text: string) => {
  const value = Number(text.trim());
  return /^\d+$/.test(text.trim()) &&
    value >= 1 &&
    value <= CATEGORY_RULES.maxPassengers
    ? value
    : null;
};

const CategoryCard = ({
  category,
  canEdit,
  busy,
  onSave,
}: {
  category: VehicleCategoryAdmin;
  canEdit: boolean;
  busy: boolean;
  onSave: (
    category: VehicleCategoryAdmin,
    patch: Record<string, unknown>,
    reason: string,
    success: string,
  ) => Promise<boolean>;
}) => {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description);
  const [capacity, setCapacity] = useState(String(category.capacity));
  const [reason, setReason] = useState("");
  const seats = parseCapacity(capacity);
  const patch = {
    ...(name.trim() !== category.name ? { name: name.trim() } : {}),
    ...(description.trim() !== category.description
      ? { description: description.trim() }
      : {}),
    ...(seats !== null && seats !== category.capacity
      ? { capacity: seats }
      : {}),
  };
  const changed = Object.keys(patch).length > 0;
  const reasonOk = reason.trim().length >= 3;
  const active = category.status === "active";

  return (
    <View className="py-4 border-b border-neutral-100">
      <View className="flex flex-row justify-between">
        <Text className="text-sm font-JakartaSemiBold">
          {category.name} · {active ? "Active" : "Inactive"}
          {category.isDefault ? " · default" : ""}
          {category.isDevelopment ? " · development example" : ""}
        </Text>
        <Text className="text-xs text-general-200">
          {when(category.updatedAt)}
        </Text>
      </View>
      <Text className="text-xs text-neutral-600 mt-1">
        {category.code} · up to {category.capacity} passengers ·{" "}
        {category.authorizedDrivers} authorized drivers · priced in{" "}
        {category.areasPriced} areas · version {category.version}
      </Text>
      {category.description !== "" && (
        <Text className="text-xs text-neutral-600 mt-1">
          {category.description}
        </Text>
      )}
      {active && category.areasPriced === 0 && (
        <Notice
          tone="warning"
          text="No service area has a fare policy in effect for this category, so passengers can't choose it yet."
        />
      )}
      {canEdit && (
        <View className="mt-2">
          <View className="flex flex-row flex-wrap">
            <Field label="Name" value={name} onChangeText={setName} />
            <Field
              label={`Passenger capacity (1–${CATEGORY_RULES.maxPassengers})`}
              value={capacity}
              onChangeText={setCapacity}
            />
            <Field
              label="Description shown to passengers"
              value={description}
              onChangeText={setDescription}
              width="w-96"
            />
          </View>
          {seats === null && (
            <Notice
              tone="warning"
              text={`Capacity must be a whole number from 1 to ${CATEGORY_RULES.maxPassengers}.`}
            />
          )}
          <Field
            label="Reason (required, recorded in the history)"
            value={reason}
            onChangeText={setReason}
            width="w-96"
          />
          <View className="flex flex-row flex-wrap">
            <ActionButton
              title="Save changes"
              disabled={busy || !changed || !reasonOk || seats === null}
              onPress={() =>
                onSave(
                  category,
                  patch,
                  reason.trim(),
                  "Category updated.",
                ).then((ok) => ok && setReason(""))
              }
            />
            <ActionButton
              title={active ? "Deactivate" : "Activate"}
              tone={active ? "danger" : "primary"}
              disabled={busy || !reasonOk}
              onPress={() =>
                onSave(
                  category,
                  { status: active ? "inactive" : "active" },
                  reason.trim(),
                  active
                    ? "Category deactivated. New quotes and requests for it are refused; rides already requested continue."
                    : "Category activated.",
                ).then((ok) => ok && setReason(""))
              }
            />
          </View>
        </View>
      )}
      {category.history.length > 0 && (
        <View className="mt-2">
          {category.history.map((h, i) => (
            <Text key={i} className="text-xs text-neutral-600 py-0.5">
              {when(h.createdAt)} · {h.action.replace(/_/g, " ")} ·{" "}
              {h.operator ?? h.actor}
              {h.reason ? ` · ${h.reason}` : ""}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

const VehicleCategories = () => {
  const operator = useOperator();
  const permissions = operator?.permissions ?? [];
  const canEdit = permissions.includes("configure");
  const canView = canEdit || permissions.includes("verify");
  const request = useApi();
  const list = useApiQuery<VehicleCategoryAdmin[]>(
    canView ? "/api/admin/vehicle-categories" : null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [isDevelopment, setIsDevelopment] = useState(true);
  const [reason, setReason] = useState("");

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "success", text: success });
      return true;
    } catch (e) {
      setMessage({
        tone: "error",
        text:
          e instanceof ApiRequestError && e.code === "VERSION_CONFLICT"
            ? "Someone else changed this category. The list was reloaded; check it and try again."
            : e instanceof ApiRequestError
              ? e.message
              : "Couldn't save.",
      });
      return false;
    } finally {
      setBusy(false);
      list.refetch();
    }
  };

  if (!canView) {
    return (
      <Section title="Vehicle categories">
        <Notice
          tone="info"
          text="Vehicle categories need the configure or verify permission."
        />
      </Section>
    );
  }

  const seats = parseCapacity(capacity);
  const codeOk = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(code.trim());

  return (
    <View>
      <Section
        title="Vehicle categories"
        right={
          <ActionButton title="Refresh" tone="neutral" onPress={list.refetch} />
        }
      >
        <Text className="text-xs text-general-200 mb-2">
          A passenger can choose a category only where an active service area
          has a fare policy in effect for it. Drivers are linked to categories
          when their vehicle is verified, on the driver&apos;s page; drivers
          can&apos;t add themselves. Prices are set per area under Service
          areas.
        </Text>
        {message && <Notice tone={message.tone} text={message.text} />}
        {list.status === "error" && <Notice tone="error" text={list.error} />}
        {list.status === "loading" && !list.data && (
          <Text className="text-sm text-general-200">Loading…</Text>
        )}
        {list.data?.length === 0 && (
          <Notice tone="warning" text="No vehicle categories exist." />
        )}
        {list.data?.map((category) => (
          <CategoryCard
            key={`${category.id}-${category.version}`}
            category={category}
            canEdit={canEdit}
            busy={busy}
            onSave={(c, patch, why, success) =>
              run(
                () =>
                  request(`/api/admin/vehicle-categories/${c.id}`, {
                    method: "PATCH",
                    body: { ...patch, expectedVersion: c.version, reason: why },
                  }),
                success,
              )
            }
          />
        ))}
      </Section>

      {canEdit && (
        <Section title="New vehicle category">
          <Text className="text-xs text-general-200 mb-2">
            A new category has no fare policy and no drivers, so passengers
            won&apos;t see it until both are added.
          </Text>
          <View className="flex flex-row flex-wrap">
            <Field
              label="Code (lowercase, dashes)"
              value={code}
              onChangeText={setCode}
            />
            <Field label="Name" value={name} onChangeText={setName} />
            <Field
              label={`Passenger capacity (1–${CATEGORY_RULES.maxPassengers})`}
              value={capacity}
              onChangeText={setCapacity}
            />
          </View>
          <Field
            label="Description shown to passengers"
            value={description}
            onChangeText={setDescription}
            width="w-96"
          />
          <View className="flex flex-row flex-wrap mt-2">
            <Chip
              label="Development example"
              active={isDevelopment}
              onPress={() => setIsDevelopment(true)}
            />
            <Chip
              label="Category approved by the business"
              active={!isDevelopment}
              onPress={() => setIsDevelopment(false)}
            />
          </View>
          <Field
            label="Reason (required, recorded in the history)"
            value={reason}
            onChangeText={setReason}
            multiline
          />
          <View className="flex flex-row mt-2">
            <ActionButton
              title={busy ? "Saving…" : "Create category"}
              disabled={
                busy ||
                !codeOk ||
                name.trim().length < 2 ||
                seats === null ||
                reason.trim().length < 3
              }
              onPress={() =>
                run(
                  () =>
                    request("/api/admin/vehicle-categories", {
                      body: {
                        code: code.trim(),
                        name: name.trim(),
                        description: description.trim(),
                        capacity: seats,
                        isDevelopment,
                        reason: reason.trim(),
                      },
                    }),
                  "Category created.",
                ).then((ok) => {
                  if (!ok) return;
                  setCode("");
                  setName("");
                  setDescription("");
                  setReason("");
                })
              }
            />
          </View>
        </Section>
      )}
    </View>
  );
};

export default VehicleCategories;
