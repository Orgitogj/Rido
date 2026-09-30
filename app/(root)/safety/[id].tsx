import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import { ApiRequestError, apiBaseUrl, useApi, useApiQuery } from "@/lib/fetch";
import {
  EMERGENCY_NOTICE,
  SAFETY_CATEGORY_LABEL,
  SAFETY_STATUS_LABEL,
  shareUrl,
} from "@/lib/safetyText";
import { formatDate } from "@/lib/utils";
import {
  SAFETY_RULES,
  safetyCategories,
  type SafetyCategory,
  type SafetyView,
  type TripShareCreated,
} from "@/shared/contracts";

const Row = ({ label, value }: { label: string; value: string }) => (
  <View className="flex flex-row justify-between py-2 border-b border-general-700">
    <Text className="text-sm text-general-200">{label}</Text>
    <Text
      className="text-sm font-JakartaSemiBold ml-4 flex-shrink text-right"
      selectable
    >
      {value}
    </Text>
  </View>
);

const errorText = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : "Something went wrong. Try again.";

const ReportForm = ({
  rideId,
  initialCategory,
  onSent,
  onCancel,
}: {
  rideId: string;
  initialCategory: SafetyCategory;
  onSent: () => void;
  onCancel: () => void;
}) => {
  const request = useApi();
  const [category, setCategory] = useState<SafetyCategory>(initialCategory);
  const [description, setDescription] = useState("");
  const [clientReportId] = useState(() => Crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = description.trim().length;

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      await request(`/api/rides/${rideId}/safety-reports`, {
        body: { category, description: description.trim(), clientReportId },
      });
      onSent();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <View className="bg-white rounded-2xl p-5 mt-4">
      <Text className="text-base font-JakartaBold">Report a safety issue</Text>
      <View
        className="flex flex-row flex-wrap mt-3"
        accessibilityRole="radiogroup"
      >
        {safetyCategories.map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            accessibilityRole="radio"
            accessibilityState={{ checked: category === c }}
            className={`px-3 py-2 rounded-full mr-2 mb-2 border ${category === c ? "bg-[#0286FF] border-[#0286FF]" : "border-neutral-300"}`}
          >
            <Text className={category === c ? "text-white text-sm" : "text-sm"}>
              {SAFETY_CATEGORY_LABEL[c]}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="What happened? Include the time and any details that help."
        multiline
        maxLength={SAFETY_RULES.descriptionMaxLength}
        accessibilityLabel="Describe what happened"
        className="border border-neutral-200 rounded-xl p-3 mt-2 min-h-[110px]"
      />
      <Text className="text-xs text-general-200 mt-1">
        {length}/{SAFETY_RULES.descriptionMaxLength} · at least{" "}
        {SAFETY_RULES.descriptionMinLength} characters. Our safety team reviews
        every report; the other person isn&apos;t told who reported.
      </Text>
      {error && (
        <Text
          className="text-sm text-red-500 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      <CustomButton
        title={sending ? "Sending…" : error ? "Try again" : "Send report"}
        disabled={sending || length < SAFETY_RULES.descriptionMinLength}
        className="mt-3"
        onPress={submit}
      />
      <CustomButton
        title="Cancel"
        bgVariant="outline"
        textVariant="primary"
        className="mt-2"
        disabled={sending}
        onPress={onCancel}
      />
    </View>
  );
};

const ShareSection = ({
  view,
  onChanged,
}: {
  view: SafetyView;
  onChanged: () => void;
}) => {
  const request = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const active = view.shares.filter((s) => s.active);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await request<TripShareCreated>(
        `/api/rides/${view.rideId}/shares`,
        { body: {} },
      );
      const url = shareUrl(apiBaseUrl(), created.path);
      setLatest(url);
      onChanged();
      await Share.share({
        message: `Follow my trip until I arrive: ${url}`,
      }).catch(() => undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/shares/${id}/revoke`, { method: "POST", body: {} });
      setLatest(null);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!view.canShare && active.length === 0) return null;
  return (
    <View className="bg-white rounded-2xl p-5 mt-4">
      <Text className="text-base font-JakartaBold">Share trip status</Text>
      <Text className="text-xs text-general-200 mt-1">
        Anyone with the link sees the trip status, your driver&apos;s first
        name, vehicle and plate, the destination and the driver&apos;s
        approximate position while the trip is active. They can&apos;t see
        payments, messages or your account. Links stop working when you stop
        sharing, after {SAFETY_RULES.shareTtlMinutes / 60} hours, or{" "}
        {SAFETY_RULES.shareAfterTripMinutes} minutes after the trip ends.
      </Text>
      {latest && (
        <Text className="text-xs mt-2" selectable>
          {latest}
        </Text>
      )}
      {active.map((s) => (
        <View
          key={s.id}
          className="flex flex-row items-center justify-between border-t border-general-700 mt-2 pt-2"
        >
          <Text className="text-sm flex-1">
            Link active until {formatDate(s.expiresAt)} · {s.views} view
            {s.views === 1 ? "" : "s"}
          </Text>
          <Pressable
            onPress={() => revoke(s.id)}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text className="text-sm text-red-500">Stop sharing</Text>
          </Pressable>
        </View>
      ))}
      {error && (
        <Text
          className="text-sm text-red-500 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      {view.canShare && (
        <CustomButton
          title={busy ? "Working…" : "Create a share link"}
          disabled={busy}
          className="mt-3"
          onPress={create}
        />
      )}
    </View>
  );
};

const SafetyScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rideId = String(id);
  const query = useApiQuery<SafetyView>(`/api/rides/${rideId}/safety`, {
    refetchOnFocus: true,
  });
  const [form, setForm] = useState<SafetyCategory | null>(null);
  const [sent, setSent] = useState(false);
  const v = query.data;

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: "/(root)/ride/[id]",
          params: { id: rideId },
        });

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        <View className="flex flex-row items-center justify-between my-5">
          <Text className="text-2xl font-JakartaExtraBold">Safety</Text>
          <CustomButton
            title="Back"
            bgVariant="outline"
            textVariant="primary"
            className="w-24"
            onPress={back}
          />
        </View>

        <View className="bg-red-50 rounded-2xl p-4" accessibilityRole="alert">
          <Text className="text-sm text-red-700 font-JakartaSemiBold">
            {EMERGENCY_NOTICE}
          </Text>
        </View>

        {!v && query.status === "loading" && (
          <ListState kind="loading" message="Loading…" />
        )}
        {!v && query.status === "error" && (
          <ListState
            kind="error"
            message={query.error}
            onRetry={query.refetch}
          />
        )}

        {v && (
          <>
            <View className="bg-white rounded-2xl px-5 py-3 mt-4">
              <Row label="Ride ID" value={v.rideId} />
              <Row label="Status" value={v.status.replace(/_/g, " ")} />
              {v.driver && (
                <>
                  <Row label="Driver" value={v.driver.name} />
                  <Row label="Vehicle" value={v.driver.vehicle} />
                  <Row label="Plate" value={v.driver.plate} />
                </>
              )}
              {v.passengerName && (
                <Row label="Passenger" value={v.passengerName} />
              )}
              {!v.currentParticipant && (
                <Text className="text-xs text-general-200 py-2">
                  You&apos;re no longer assigned to this ride, but you can still
                  report what happened while you were.
                </Text>
              )}
            </View>

            {sent && (
              <View className="bg-green-50 rounded-2xl p-4 mt-4">
                <Text className="text-sm text-green-700">
                  Thanks. Your report was sent to our safety team. You can
                  follow its status below.
                </Text>
              </View>
            )}

            {form ? (
              <ReportForm
                rideId={rideId}
                initialCategory={form}
                onCancel={() => setForm(null)}
                onSent={() => {
                  setForm(null);
                  setSent(true);
                  query.refetch();
                }}
              />
            ) : v.canReport ? (
              <View className="mt-4">
                <CustomButton
                  title="Report a safety issue"
                  bgVariant="danger"
                  onPress={() => {
                    setSent(false);
                    setForm("unsafe_driving");
                  }}
                />
                <CustomButton
                  title="Contact support"
                  bgVariant="outline"
                  textVariant="primary"
                  className="mt-3"
                  onPress={() => {
                    if (v.role === "passenger" && v.currentParticipant) {
                      router.push({
                        pathname: "/(root)/receipt/[id]",
                        params: { id: rideId },
                      });
                      return;
                    }
                    setSent(false);
                    setForm("other");
                  }}
                />
                {v.reportBy && (
                  <Text className="text-xs text-general-200 mt-2">
                    Reports for this ride can be sent until{" "}
                    {formatDate(v.reportBy)}.
                  </Text>
                )}
              </View>
            ) : (
              <Text className="text-sm text-general-200 mt-4">
                The reporting period for this ride has ended.
              </Text>
            )}

            {v.role === "passenger" && (
              <ShareSection view={v} onChanged={query.refetch} />
            )}

            <View className="bg-white rounded-2xl px-5 py-3 mt-4">
              <Text className="text-base font-JakartaBold py-2">
                Your reports
              </Text>
              {v.reports.length === 0 && (
                <Text className="text-sm text-general-200 pb-2">
                  You haven&apos;t reported anything for this ride.
                </Text>
              )}
              {v.reports.map((r) => (
                <View key={r.id} className="py-2 border-t border-general-700">
                  <View className="flex flex-row justify-between">
                    <Text className="text-sm font-JakartaSemiBold">
                      {SAFETY_CATEGORY_LABEL[r.category]}
                    </Text>
                    <Text className="text-sm text-general-200">
                      {SAFETY_STATUS_LABEL[r.status]}
                    </Text>
                  </View>
                  <Text className="text-xs text-general-200 mt-1">
                    Sent {formatDate(r.createdAt)}
                    {r.reportedMessages > 0
                      ? ` · ${r.reportedMessages} message${r.reportedMessages === 1 ? "" : "s"} attached`
                      : ""}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default SafetyScreen;
