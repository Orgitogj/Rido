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
  when,
} from "@/components/admin/ui";
import { useOperator } from "@/lib/adminApi";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import { DROPOFF_RULE_LABEL } from "@/lib/pricingAdmin";
import {
  type DropoffRule,
  dropoffRules,
  type ServiceAreaDetail,
  type ServiceAreaItem,
} from "@/shared/adminPricing";
import {
  BOUNDARY_PROBLEM_TEXT,
  boundaryProblem,
  parseBoundary,
} from "@/shared/serviceArea";

const ServiceAreas = () => {
  const operator = useOperator();
  if (!(operator?.permissions.includes("configure") ?? false)) {
    return (
      <Section title="Service areas">
        <Notice
          tone="info"
          text="Service areas and fare policies need the configure permission."
        />
      </Section>
    );
  }
  return <AreaList />;
};

const AreaList = () => {
  const request = useApi();
  const list = useApiQuery<ServiceAreaItem[]>("/api/admin/service-areas");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [boundaryText, setBoundaryText] = useState("");
  const [dropoffRule, setDropoffRule] = useState<DropoffRule>("inside_area");
  const [isDevelopment, setIsDevelopment] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const boundary = parseBoundary(boundaryText);
  const problem = boundary
    ? boundaryProblem(boundary)
    : boundaryText.trim()
      ? "PARSE"
      : null;

  const create = async () => {
    if (!boundary || problem) return;
    setBusy(true);
    setMessage(null);
    try {
      const area = await request<ServiceAreaDetail>(
        "/api/admin/service-areas",
        {
          body: {
            code: code.trim(),
            name: name.trim(),
            boundary,
            dropoffRule,
            isDevelopment,
            reason: reason.trim(),
          },
        },
      );
      router.push({ pathname: "/admin/areas/[id]", params: { id: area.id } });
    } catch (e) {
      setMessage(
        e instanceof ApiRequestError ? e.message : "Couldn't create the area.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Section title="Service areas">
        <Text className="text-xs text-general-200 mb-2">
          Rides can only be quoted when the pickup is inside an active area.
          Nothing is enabled until an operator creates an area, adds a fare
          policy and activates it.
        </Text>
        {list.status === "error" && <Notice tone="error" text={list.error} />}
        {list.status === "loading" && !list.data && (
          <Text className="text-sm text-general-200">Loading…</Text>
        )}
        {list.data?.length === 0 && (
          <Notice
            tone="warning"
            text="No service areas yet. Quotes are refused everywhere."
          />
        )}
        {list.data?.map((a) => (
          <ListRow
            key={a.id}
            onPress={() =>
              router.push({
                pathname: "/admin/areas/[id]",
                params: { id: a.id },
              })
            }
          >
            <View className="flex flex-row justify-between">
              <Text className="text-sm font-JakartaSemiBold">
                {a.name} · {a.status === "active" ? "Active" : "Inactive"}
                {a.isDevelopment ? " · development" : ""}
              </Text>
              <Text className="text-xs text-general-200">
                {when(a.updatedAt)}
              </Text>
            </View>
            <Text className="text-xs text-neutral-600 mt-1">
              {a.code} · {a.vertexCount} points ·{" "}
              {a.currentPolicy
                ? `policy v${a.currentPolicy.version} (${a.currentPolicy.label})${a.currentPolicy.isDevelopment ? " · development rates" : ""}`
                : "no policy in effect"}
            </Text>
          </ListRow>
        ))}
        <View className="flex flex-row mt-3">
          <ActionButton title="Refresh" tone="neutral" onPress={list.refetch} />
        </View>
      </Section>

      <Section title="New service area">
        <View className="flex flex-row flex-wrap">
          <Field
            label="Code (lowercase, dashes)"
            value={code}
            onChangeText={setCode}
          />
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            width="w-80"
          />
        </View>
        <Field
          label="Boundary: one 'latitude, longitude' per line, in order around the edge"
          value={boundaryText}
          onChangeText={setBoundaryText}
          multiline
        />
        {problem && (
          <Notice
            tone="warning"
            text={
              problem === "PARSE"
                ? "Each line must be 'latitude, longitude'."
                : BOUNDARY_PROBLEM_TEXT[problem]
            }
          />
        )}
        <View className="flex flex-row flex-wrap mt-2">
          {dropoffRules.map((r) => (
            <Chip
              key={r}
              label={DROPOFF_RULE_LABEL[r]}
              active={dropoffRule === r}
              onPress={() => setDropoffRule(r)}
            />
          ))}
        </View>
        <View className="flex flex-row flex-wrap">
          <Chip
            label="Development area"
            active={isDevelopment}
            onPress={() => setIsDevelopment(true)}
          />
          <Chip
            label="Not a development area"
            active={!isDevelopment}
            onPress={() => setIsDevelopment(false)}
          />
        </View>
        <Field
          label="Reason (recorded in the history)"
          value={reason}
          onChangeText={setReason}
          multiline
        />
        {message && <Notice tone="error" text={message} />}
        <View className="flex flex-row mt-2">
          <ActionButton
            title={busy ? "Creating…" : "Create (inactive)"}
            disabled={
              busy ||
              !boundary ||
              Boolean(problem) ||
              code.trim().length < 3 ||
              name.trim().length < 2 ||
              reason.trim().length < 3
            }
            onPress={create}
          />
        </View>
      </Section>
    </View>
  );
};

export default ServiceAreas;
