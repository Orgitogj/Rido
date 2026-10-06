import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
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
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import {
  DROPOFF_RULE_LABEL,
  parseEffectiveFrom,
  parseRate,
  POLICY_STATE_LABEL,
} from "@/lib/pricingAdmin";
import {
  type DropoffRule,
  dropoffRules,
  type ServiceAreaDetail,
} from "@/shared/adminPricing";
import { formatCents } from "@/shared/contracts";
import { isValidTimeZone } from "@/shared/quietHours";
import {
  BOUNDARY_PROBLEM_TEXT,
  boundaryProblem,
  formatBoundary,
  parseBoundary,
} from "@/shared/serviceArea";
import {
  DEFAULT_VEHICLE_CATEGORY_ID,
  type VehicleCategoryAdmin,
} from "@/shared/vehicleCategory";

type Tone = "error" | "success" | "info" | "warning";

const ServiceArea = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const operator = useOperator();
  const allowed = operator?.permissions.includes("configure") ?? false;
  const request = useApi();
  const query = useApiQuery<ServiceAreaDetail>(
    allowed ? `/api/admin/service-areas/${id}` : null,
  );
  const d = query.data;
  const categories = useApiQuery<VehicleCategoryAdmin[]>(
    allowed ? "/api/admin/vehicle-categories" : null,
  );
  const [categoryId, setCategoryId] = useState(DEFAULT_VEHICLE_CATEGORY_ID);
  const [timezone, setTimezone] = useState("");
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [boundaryText, setBoundaryText] = useState("");
  const [dropoffRule, setDropoffRule] = useState<DropoffRule>("inside_area");
  const [reason, setReason] = useState("");

  const [label, setLabel] = useState("Development policy (placeholder rates)");
  const [isDevelopment, setIsDevelopment] = useState(true);
  const [base, setBase] = useState("");
  const [perKm, setPerKm] = useState("");
  const [perMinute, setPerMinute] = useState("");
  const [minimum, setMinimum] = useState("");
  const [effective, setEffective] = useState("");
  const [policyReason, setPolicyReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    if (!d) return;
    setName(d.name);
    setBoundaryText(formatBoundary(d.boundary));
    setDropoffRule(d.dropoffRule);
    setTimezone(d.timezone);
  }, [d]);

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
        text: e instanceof ApiRequestError ? e.message : "Couldn't save.",
      });
      return false;
    } finally {
      setBusy(false);
      query.refetch();
    }
  };

  if (!allowed) {
    return (
      <Notice
        tone="info"
        text="Service areas and fare policies need the configure permission."
      />
    );
  }
  if (!d) {
    return query.status === "error" ? (
      <View>
        <Notice tone="error" text={query.error} />
        <ActionButton title="Retry" tone="neutral" onPress={query.refetch} />
      </View>
    ) : (
      <Text className="text-sm text-general-200">Loading…</Text>
    );
  }

  const boundary = parseBoundary(boundaryText);
  const problem = boundary ? boundaryProblem(boundary) : "PARSE";
  const boundaryChanged =
    boundary !== null &&
    formatBoundary(boundary) !== formatBoundary(d.boundary);
  const update = (patch: Record<string, unknown>, success: string) =>
    run(
      () =>
        request(`/api/admin/service-areas/${id}`, {
          method: "PATCH",
          body: { ...patch, expectedVersion: d.version, reason: reason.trim() },
        }),
      success,
    ).then((ok) => ok && setReason(""));

  const rates = {
    baseCents: parseRate(base),
    perKmCents: parseRate(perKm),
    perMinuteCents: parseRate(perMinute),
    minimumFareCents: parseRate(minimum),
  };
  const effectiveFrom = parseEffectiveFrom(effective);
  const ratesValid = Object.values(rates).every((v) => v !== null);
  const inEffect = d.policies.find((p) => p.state === "in_effect");
  const zone = timezone.trim();
  const zoneValid = isValidTimeZone(zone);
  const pricedCategories = new Set(
    d.policies
      .filter((p) => p.state === "in_effect")
      .map((p) => p.vehicleCategoryId),
  );

  return (
    <View>
      <Pressable onPress={() => router.push("/admin/areas")}>
        <Text className="text-sm text-[#0286FF]">← Service areas</Text>
      </Pressable>

      <Section title={`${d.name} (${d.code})`}>
        {d.isDevelopment && (
          <Notice
            tone="warning"
            text="Development area. It exists for testing and is not a launch decision."
          />
        )}
        {inEffect?.isDevelopment && (
          <Notice
            tone="warning"
            text="The fare policy in effect uses development placeholder rates, not commercial prices."
          />
        )}
        <KeyValue
          label="Status"
          value={d.status === "active" ? "Active" : "Inactive"}
        />
        <KeyValue
          label="Drop-off rule"
          value={DROPOFF_RULE_LABEL[d.dropoffRule]}
        />
        <KeyValue label="Time zone" value={d.timezone} />
        <KeyValue label="Points" value={String(d.boundary.length)} />
        <KeyValue
          label="Bounds"
          value={`${d.bounds.minLatitude}…${d.bounds.maxLatitude}, ${d.bounds.minLongitude}…${d.bounds.maxLongitude}`}
        />
        <KeyValue label="Version" value={String(d.version)} />
        <KeyValue label="Updated" value={when(d.updatedAt)} />
        {message && <Notice tone={message.tone} text={message.text} />}
      </Section>

      <Section title="Change area">
        <View className="flex flex-row flex-wrap">
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            width="w-80"
          />
          <Field
            label="Time zone (IANA name, e.g. Europe/Tirane)"
            value={timezone}
            onChangeText={setTimezone}
            width="w-80"
          />
        </View>
        {!zoneValid && (
          <Notice
            tone="warning"
            text="Enter a valid IANA time zone name. Scheduled requests use the area's time zone."
          />
        )}
        <Field
          label="Boundary: one 'latitude, longitude' per line"
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
        <Field
          label="Reason (required, recorded in the history)"
          value={reason}
          onChangeText={setReason}
          multiline
        />
        <View className="flex flex-row flex-wrap">
          <ActionButton
            title="Save changes"
            disabled={
              busy ||
              reason.trim().length < 3 ||
              Boolean(problem) ||
              !zoneValid ||
              (name.trim() === d.name &&
                zone === d.timezone &&
                !boundaryChanged &&
                dropoffRule === d.dropoffRule)
            }
            onPress={() =>
              update(
                {
                  ...(name.trim() !== d.name ? { name: name.trim() } : {}),
                  ...(zone !== d.timezone ? { timezone: zone } : {}),
                  ...(boundaryChanged ? { boundary } : {}),
                  ...(dropoffRule !== d.dropoffRule ? { dropoffRule } : {}),
                },
                "Area updated.",
              )
            }
          />
          <ActionButton
            title={d.status === "active" ? "Deactivate" : "Activate"}
            tone={d.status === "active" ? "danger" : "primary"}
            disabled={busy || reason.trim().length < 3}
            onPress={() =>
              update(
                { status: d.status === "active" ? "inactive" : "active" },
                d.status === "active"
                  ? "Area deactivated. New quotes and bookings here are refused; rides already under way continue."
                  : "Area activated.",
              )
            }
          />
        </View>
      </Section>

      <Section title="Fare policies">
        <Text className="text-xs text-general-200 mb-2">
          Policies are never edited. Schedule a new version with an effective
          date; quotes and rides keep the price they were given. New policies
          are in Albanian lek, and fares are rounded up to a whole lek. Each
          vehicle category has its own sequence of policies; a category is
          offered here only while one of its policies is in effect.
        </Text>
        {d.policies.length === 0 && (
          <Notice
            tone="warning"
            text="No fare policy. The area can't be activated yet."
          />
        )}
        {d.policies.map((p) => (
          <View key={p.id} className="py-3 border-b border-neutral-100">
            <View className="flex flex-row justify-between">
              <Text className="text-sm font-JakartaSemiBold">
                {p.vehicleCategoryName ?? "Unknown category"} · v{p.version} ·{" "}
                {p.label} · {POLICY_STATE_LABEL[p.state]}
                {p.isDevelopment ? " · development rates" : ""}
              </Text>
              <Text className="text-xs text-general-200">
                from {when(p.effectiveFrom)}
              </Text>
            </View>
            <Text className="text-xs text-neutral-600 mt-1">
              base {formatCents(p.baseCents)} · {formatCents(p.perKmCents)}/km ·{" "}
              {formatCents(p.perMinuteCents)}/min · minimum{" "}
              {formatCents(p.minimumFareCents)} · {p.quotesUsing} quotes
            </Text>
            <Text className="text-xs text-neutral-600">
              Examples:{" "}
              {p.examples
                .map(
                  (e) =>
                    `${e.distanceMeters / 1000} km / ${Math.round(e.durationSeconds / 60)} min → ${formatCents(e.fareCents)}`,
                )
                .join(" · ")}
            </Text>
            <Text className="text-xs text-neutral-600">
              {p.createdBy ?? "system"}: {p.reason}
              {p.cancelReason
                ? ` · cancelled by ${p.cancelledBy}: ${p.cancelReason}`
                : ""}
            </Text>
            {p.state === "scheduled" && (
              <View className="flex flex-row flex-wrap items-end mt-1">
                <Field
                  label="Reason to cancel"
                  value={cancelReason}
                  onChangeText={setCancelReason}
                  width="w-80"
                />
                <ActionButton
                  title="Cancel scheduled version"
                  tone="danger"
                  disabled={busy || cancelReason.trim().length < 3}
                  onPress={() =>
                    run(
                      () =>
                        request(
                          `/api/admin/service-areas/${id}/policies/${p.id}/cancel`,
                          { body: { reason: cancelReason.trim() } },
                        ),
                      "Scheduled version cancelled.",
                    ).then((ok) => ok && setCancelReason(""))
                  }
                />
              </View>
            )}
          </View>
        ))}
      </Section>

      <Section title="Schedule a new fare policy">
        <Text className="text-xs text-general-200 mb-1">Vehicle category</Text>
        {categories.status === "error" && (
          <Notice tone="error" text={categories.error} />
        )}
        <View className="flex flex-row flex-wrap">
          {(categories.data ?? [])
            .filter((c) => c.status === "active" || c.id === categoryId)
            .map((c) => (
              <Chip
                key={c.id}
                label={`${c.name}${pricedCategories.has(c.id) ? "" : " · not priced here"}${c.isDevelopment ? " · development example" : ""}`}
                active={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
              />
            ))}
        </View>
        <Field
          label="Label"
          value={label}
          onChangeText={setLabel}
          width="w-80"
        />
        <View className="flex flex-row flex-wrap">
          <Chip
            label="Development placeholder rates"
            active={isDevelopment}
            onPress={() => setIsDevelopment(true)}
          />
          <Chip
            label="Rates approved by the business"
            active={!isDevelopment}
            onPress={() => setIsDevelopment(false)}
          />
        </View>
        <View className="flex flex-row flex-wrap">
          <Field label="Base (lek)" value={base} onChangeText={setBase} />
          <Field label="Per km (lek)" value={perKm} onChangeText={setPerKm} />
          <Field
            label="Per minute (lek)"
            value={perMinute}
            onChangeText={setPerMinute}
          />
          <Field
            label="Minimum fare (lek)"
            value={minimum}
            onChangeText={setMinimum}
          />
        </View>
        <Field
          label="Effective from: 'now' or 'YYYY-MM-DD HH:MM' in your local time"
          value={effective}
          onChangeText={setEffective}
          width="w-80"
        />
        {effective.trim() && !effectiveFrom && (
          <Notice
            tone="warning"
            text="Use 'now' or a date like 2027-01-31 08:00."
          />
        )}
        {effectiveFrom && (
          <Text className="text-xs text-general-200">
            Takes effect {when(effectiveFrom)}. Quotes issued before then keep
            the previous price.
          </Text>
        )}
        <Field
          label="Reason (required, recorded in the history)"
          value={policyReason}
          onChangeText={setPolicyReason}
          multiline
        />
        <View className="flex flex-row">
          <ActionButton
            title="Schedule policy"
            disabled={
              busy ||
              !ratesValid ||
              !effectiveFrom ||
              (rates.minimumFareCents ?? 0) < 50 ||
              label.trim().length < 3 ||
              policyReason.trim().length < 3
            }
            onPress={() =>
              run(
                () =>
                  request(`/api/admin/service-areas/${id}/policies`, {
                    body: {
                      label: label.trim(),
                      isDevelopment,
                      ...rates,
                      effectiveFrom,
                      vehicleCategoryId: categoryId,
                      reason: policyReason.trim(),
                    },
                  }),
                "Fare policy scheduled.",
              ).then((ok) => ok && setPolicyReason(""))
            }
          />
        </View>
      </Section>

      <Section title="History">
        {d.history.map((h, i) => (
          <Text key={i} className="text-sm py-0.5">
            {when(h.createdAt)} · {h.action.replace(/_/g, " ")} ·{" "}
            {h.operator ?? h.actor}
            {h.reason ? ` · ${h.reason}` : ""}
          </Text>
        ))}
      </Section>
    </View>
  );
};

export default ServiceArea;
