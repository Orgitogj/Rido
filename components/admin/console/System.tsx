import { Text, View } from "react-native";

import {
  ActionButton,
  KeyValue,
  Notice,
  Section,
  when,
} from "@/components/admin/ui";
import { useApiQuery } from "@/lib/fetch";

import type { SystemStatus } from "@/shared/adminSystem";

const QUEUE_LABELS: Record<keyof SystemStatus["queues"], string> = {
  notificationsPending: "Notifications waiting to send",
  notificationsFailed: "Notifications that failed permanently",
  storageDeletionsDue: "Document deletions due",
  storageDeletionsFailing: "Document deletions failing",
  accountDeletionsPending: "Account deletions in progress",
  accountDeletionsFailing: "Account deletions failing",
  settlementsRetrying: "Payments being retried",
  ridesNeedingReview: "Rides flagged for review",
  routesThisMinute: "Route requests this minute",
  matrixElementsThisMinute: "Matching route elements this minute",
};

const ATTENTION: (keyof SystemStatus["queues"])[] = [
  "notificationsFailed",
  "storageDeletionsFailing",
  "accountDeletionsFailing",
];

const SystemPage = () => {
  const status = useApiQuery<SystemStatus>("/api/admin/system");
  const s = status.data;

  if (!s) {
    return status.status === "error" ? (
      <Notice tone="error" text={status.error} />
    ) : (
      <Text className="text-sm text-general-200">Loading…</Text>
    );
  }

  const missing = s.config.filter((c) => c.level === "required" && !c.ok);

  return (
    <View>
      <Section
        title="Environment"
        right={<ActionButton title="Refresh" onPress={status.refetch} />}
      >
        <KeyValue label="Environment" value={s.environment} />
        <KeyValue label="Stripe mode" value={s.stripeMode} />
        {s.environment === "development" && (
          <Notice
            tone="info"
            text="Development settings are in use. Development-only fallbacks are listed below and must be replaced before real passengers use the service."
          />
        )}
        {missing.length > 0 && (
          <Notice
            tone="error"
            text={`${missing.length} required setting${missing.length === 1 ? " is" : "s are"} missing. The readiness endpoint reports the service as not ready.`}
          />
        )}
      </Section>

      <Section title="Configuration checklist">
        <Text className="text-xs text-general-200 mb-2">
          Only whether each setting is present is shown. Secret values are never
          sent to the console.
        </Text>
        {s.config.map((c) => (
          <View
            key={`${c.area}-${c.name}`}
            className="flex flex-row py-2 border-b border-neutral-100"
          >
            <Text
              className={`w-24 text-sm font-JakartaSemiBold ${c.ok ? "text-green-700" : c.level === "required" ? "text-red-700" : "text-orange-700"}`}
            >
              {c.ok ? "Set" : c.level === "required" ? "Missing" : "Not set"}
            </Text>
            <View className="flex-1">
              <Text className="text-sm font-JakartaMedium">
                {c.area} · {c.name} · {c.level}
              </Text>
              <Text className="text-xs text-general-200 mt-0.5">{c.note}</Text>
            </View>
          </View>
        ))}
      </Section>

      <Section title="Background jobs">
        {s.jobs.length === 0 && (
          <Notice
            tone="warning"
            text="No background job has run yet. Schedule the maintenance sweep endpoint; see the deployment notes."
          />
        )}
        {s.jobs.map((job) => (
          <View key={job.name} className="py-2 border-b border-neutral-100">
            <Text className="text-sm font-JakartaSemiBold">{job.name}</Text>
            <Text className="text-xs text-general-200 mt-0.5">
              Last started {when(job.lastStartedAt)} · last succeeded{" "}
              {when(job.lastOkAt)} · {job.runs} runs · {job.failures} failures
            </Text>
            {job.lastError && (
              <Text className="text-xs text-red-700 mt-0.5" selectable>
                Last error: {job.lastError}
              </Text>
            )}
          </View>
        ))}
      </Section>

      <Section title="Queues and usage">
        {(Object.keys(QUEUE_LABELS) as (keyof SystemStatus["queues"])[]).map(
          (key) => (
            <View
              key={key}
              className="flex flex-row py-1.5 border-b border-neutral-100"
            >
              <Text className="flex-1 text-sm text-general-200">
                {QUEUE_LABELS[key]}
              </Text>
              <Text
                className={`text-sm font-JakartaSemiBold ${ATTENTION.includes(key) && s.queues[key] > 0 ? "text-red-700" : ""}`}
              >
                {s.queues[key]}
              </Text>
            </View>
          ),
        )}
      </Section>
    </View>
  );
};

export default SystemPage;
