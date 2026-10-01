import { useAuth, useUser } from "@clerk/expo";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import DriverApplicationForm from "@/components/DriverApplicationForm";
import DriverDocuments from "@/components/DriverDocuments";
import DriverTrips from "@/components/DriverTrips";
import ListState from "@/components/ListState";
import OfferCard from "@/components/OfferCard";
import StatusBadge from "@/components/StatusBadge";
import TrackingStatus from "@/components/TrackingStatus";
import { useDriverDashboard } from "@/lib/driver";
import { useApi } from "@/lib/fetch";
import { type TKey, useI18n } from "@/lib/i18n";
import { usePushStatus } from "@/lib/notifications";
import { formatRating } from "@/lib/ratingText";
import {
  currentFix,
  foregroundPermission,
  useDriverTracking,
} from "@/lib/tracking";
import {
  type DriverApplication,
  type DriverDashboard,
  documentKinds,
} from "@/shared/contracts";

class LocalProblem extends Error {
  constructor(public key: TKey) {
    super(key);
  }
}

const DriverScreen = () => {
  const { t, language, error: errorText, queryError } = useI18n();
  const { user } = useUser();
  const { getToken } = useAuth();
  const request = useApi();
  const { data, error, errorCode, receivedAt, refresh, replace } =
    useDriverDashboard();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [wantBackground, setWantBackground] = useState(false);
  const [editing, setEditing] = useState(false);
  const pushStatus = usePushStatus((s) => s.status);
  const sharing = Boolean(data?.profile?.online || data?.activeRide);
  const tracking = useDriverTracking(sharing, wantBackground, getToken);

  const act = async (fn: () => Promise<DriverDashboard | void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await fn();
      if (next) replace(next);
    } catch (e) {
      setMessage(e instanceof LocalProblem ? t(e.key) : errorText(e));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const apply = (application: DriverApplication) =>
    act(async () => {
      await request("/api/driver/profile", { body: application });
      setEditing(false);
      await refresh();
    });

  const submitApplication = () =>
    act(async () => {
      await request("/api/driver/profile/submit", { method: "POST" });
      await refresh();
    });

  const reopenApplication = () =>
    act(async () => {
      await request("/api/driver/profile/reopen", { method: "POST" });
      await refresh();
    });

  const setOnline = (online: boolean) =>
    act(async () => {
      if (!online) {
        return request<DriverDashboard>("/api/driver/availability", {
          body: { online: false },
        });
      }
      const permission = await foregroundPermission(false);
      if (permission === "services_off") {
        throw new LocalProblem("driver.locationServicesOff");
      }
      if (permission === "unknown") {
        setExplaining(true);
        return;
      }
      if (permission === "denied") {
        throw new LocalProblem("driver.locationDenied");
      }
      const fix = await currentFix();
      if (!fix) {
        throw new LocalProblem("driver.noFix");
      }
      return request<DriverDashboard>("/api/driver/availability", {
        body: {
          online: true,
          location: {
            latitude: fix.latitude,
            longitude: fix.longitude,
            accuracy: fix.accuracy,
            recordedAt: fix.recordedAt,
          },
        },
      });
    });

  const respond = (offerId: string, accept: boolean) =>
    act(async () => {
      const next = await request<DriverDashboard>(
        `/api/driver/offers/${offerId}/${accept ? "accept" : "decline"}`,
        { method: "POST" },
      );
      if (accept && next.activeRide) {
        router.push({
          pathname: "/(root)/ride/[id]",
          params: { id: next.activeRide.id },
        });
      }
      return next;
    });

  const profile = data?.profile;
  const activeRide = data?.activeRide;
  const offer = data?.offer;
  const expired = profile?.status === "approved" && !profile.eligible;
  const requirementLabel = (key: string, fallback: string) =>
    key === "vehicle"
      ? t("driver.requirementVehicle")
      : documentKinds.find((kind) => kind === key)
        ? t(`driver.documents.kind.${key as (typeof documentKinds)[number]}`)
        : fallback;

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex flex-row items-center justify-between my-5">
          <Text
            className="text-2xl font-JakartaExtraBold flex-1"
            accessibilityRole="header"
          >
            {t("driver.title")}
          </Text>
          <CustomButton
            title={t("driver.riderMode")}
            bgVariant="outline"
            textVariant="primary"
            className="w-40"
            onPress={() => router.replace("/(root)/(tabs)/home")}
          />
        </View>

        {!data && !error && (
          <ListState kind="loading" message={t("driver.loading")} />
        )}
        {!data && error && (
          <ListState
            kind="error"
            message={queryError({ error, errorCode })}
            onRetry={refresh}
          />
        )}
        {data && error && (
          <Text
            className="text-xs text-orange-800 mb-3"
            accessibilityLiveRegion="polite"
          >
            {t("driver.reconnecting")}
          </Text>
        )}

        {data && !profile && (
          <DriverApplicationForm
            defaultName={user?.fullName ?? user?.firstName ?? ""}
            onSubmit={apply}
          />
        )}

        {profile && (editing || !profile.eligible) && (
          <View className="bg-white rounded-2xl p-5">
            {!profile.eligible && (
              <Text className="text-xs font-JakartaSemiBold text-general-200 mb-1">
                {t("driver.whyOffline")}
              </Text>
            )}
            <Text
              className="text-lg font-JakartaBold"
              accessibilityRole="header"
            >
              {expired
                ? t("driver.status.expired_title")
                : t(`driver.status.${profile.status}_title`)}
            </Text>
            <Text className="text-base text-general-200 mt-2">
              {expired
                ? t("driver.status.expired_body")
                : t(`driver.status.${profile.status}_body`)}
            </Text>
            {profile.applicantMessage && (
              <View className="bg-general-500 rounded-xl p-3 mt-3">
                <Text className="text-sm font-JakartaSemiBold">
                  {t("driver.reviewMessage")}
                </Text>
                <Text className="text-sm mt-1">{profile.applicantMessage}</Text>
              </View>
            )}
            <Text className="text-base mt-3">
              {profile.displayName} · {profile.vehicleColor ?? ""}{" "}
              {profile.vehicleMake} {profile.vehicleModel}
              {profile.vehicleYear ? ` (${profile.vehicleYear})` : ""} ·{" "}
              {profile.vehiclePlate}
            </Text>
            {(profile.canEdit || profile.status === "submitted") && (
              <View className="mt-3">
                {profile.requirements.map((r) => (
                  <Text
                    key={r.key}
                    className={`text-sm ${r.met ? "text-green-700" : "text-general-200"}`}
                  >
                    {r.met ? "✓" : "○"} {requirementLabel(r.key, r.label)}
                  </Text>
                ))}
              </View>
            )}
            {profile.canEdit && !editing && (
              <CustomButton
                title={t("driver.editDetails")}
                bgVariant="outline"
                textVariant="primary"
                className="mt-4"
                onPress={() => setEditing(true)}
              />
            )}
            {profile.canEdit && (
              <CustomButton
                title={busy ? "…" : t("driver.submit")}
                disabled={busy || !profile.canSubmit}
                className="mt-3"
                onPress={submitApplication}
              />
            )}
            {profile.canEdit && !profile.canSubmit && (
              <Text className="text-xs text-general-200 mt-2">
                {t("driver.completeAll")}
              </Text>
            )}
            {profile.canReopen && (
              <CustomButton
                title={busy ? "…" : t("driver.startUpdate")}
                bgVariant="outline"
                textVariant="primary"
                disabled={busy}
                className="mt-4"
                onPress={reopenApplication}
              />
            )}
            {profile.status === "approved" && profile.canReopen && (
              <Text className="text-xs text-general-200 mt-2">
                {t("driver.updateNote")}
              </Text>
            )}
            <Text className="text-xs text-general-200 mt-4">
              {t("driver.accountId")}
            </Text>
            <Text selectable className="text-xs font-JakartaSemiBold">
              {user?.id}
            </Text>
          </View>
        )}

        {profile && editing && profile.canEdit && (
          <View className="mt-5">
            <DriverApplicationForm
              defaultName={profile.displayName}
              initial={profile}
              onSubmit={apply}
              onCancel={() => setEditing(false)}
            />
          </View>
        )}

        {profile && profile.canEdit && !editing && (
          <DriverDocuments
            documents={profile.documents}
            editable={profile.canEdit}
            onChanged={refresh}
          />
        )}

        {profile &&
          profile.status === "approved" &&
          profile.eligible &&
          profile.canReopen &&
          !profile.online &&
          !activeRide && (
            <CustomButton
              title={t("driver.updateVehicle")}
              bgVariant="outline"
              textVariant="primary"
              className="mb-5"
              onPress={reopenApplication}
            />
          )}

        {profile && ((profile.eligible && !editing) || activeRide) && (
          <>
            <View className="bg-white rounded-2xl p-5">
              <Text
                className="text-lg font-JakartaBold"
                accessibilityRole="header"
                accessibilityLiveRegion="polite"
              >
                {profile.online ? t("driver.online") : t("driver.offline")}
              </Text>
              <Text className="text-sm text-general-200 mt-1">
                {profile.online
                  ? t("driver.onlineBody")
                  : t("driver.offlineBody")}
              </Text>
              <Text className="text-sm text-general-200 mt-1">
                {t("driver.yourRating", {
                  rating: formatRating(profile.rating, language),
                })}
              </Text>
              <CustomButton
                title={t("driver.viewEarnings")}
                bgVariant="outline"
                textVariant="primary"
                className="mt-3"
                onPress={() => router.push("/(root)/earnings")}
              />
              {(profile.eligible || profile.online) && (
                <CustomButton
                  title={
                    busy
                      ? "…"
                      : profile.online
                        ? t("driver.goOffline")
                        : t("driver.goOnline")
                  }
                  bgVariant={profile.online ? "outline" : "success"}
                  textVariant={profile.online ? "primary" : "default"}
                  disabled={busy}
                  className="mt-4"
                  onPress={() => setOnline(!profile.online)}
                />
              )}
              {!profile.eligible && activeRide && (
                <Text className="text-sm text-general-200 mt-3">
                  {t("driver.finishOnly")}
                </Text>
              )}
            </View>

            {explaining && (
              <View className="bg-white rounded-2xl p-5 mt-5">
                <Text className="text-lg font-JakartaBold">
                  {t("driver.locationTitle")}
                </Text>
                <Text className="text-sm text-general-200 mt-2">
                  {t("driver.locationBody")}
                </Text>
                <CustomButton
                  title={t("driver.allowLocation")}
                  className="mt-4"
                  onPress={async () => {
                    setExplaining(false);
                    const result = await foregroundPermission(true);
                    if (result === "granted") setOnline(true);
                    else setMessage(t("driver.locationNeeded"));
                  }}
                />
                <CustomButton
                  title={t("driver.notNow")}
                  bgVariant="outline"
                  textVariant="primary"
                  className="mt-3"
                  onPress={() => setExplaining(false)}
                />
              </View>
            )}

            {sharing && (
              <TrackingStatus
                status={tracking}
                wantBackground={wantBackground}
                onToggleBackground={setWantBackground}
              />
            )}

            {pushStatus !== "registered" && pushStatus !== "idle" && (
              <Text className="text-xs text-general-200 mt-3">
                {pushStatus === "needs_dev_build"
                  ? t("driver.pushDevBuild")
                  : pushStatus === "denied"
                    ? t("driver.pushDenied")
                    : t("driver.pushUnavailable")}
              </Text>
            )}

            {activeRide && (
              <View className="bg-white rounded-2xl p-5 mt-5">
                <View className="flex flex-row items-center justify-between">
                  <Text className="text-lg font-JakartaBold">
                    {t("driver.currentRide")}
                  </Text>
                  <StatusBadge status={activeRide.status} />
                </View>
                <Text
                  className="text-base text-general-200 mt-2"
                  numberOfLines={2}
                >
                  {activeRide.pickup.address} → {activeRide.destination.address}
                </Text>
                <CustomButton
                  title={t("driver.openRide")}
                  className="mt-4"
                  onPress={() =>
                    router.push({
                      pathname: "/(root)/ride/[id]",
                      params: { id: activeRide.id },
                    })
                  }
                />
              </View>
            )}

            {offer && !activeRide && (
              <OfferCard
                offer={offer}
                receivedAt={receivedAt}
                busy={busy}
                onAccept={() => respond(offer.id, true)}
                onDecline={() => respond(offer.id, false)}
              />
            )}

            {profile.online && !offer && !activeRide && (
              <ListState kind="loading" message={t("driver.waiting")} />
            )}

            <DriverTrips />
          </>
        )}

        {message && (
          <Text
            className="text-sm text-red-600 mt-4"
            accessibilityLiveRegion="polite"
          >
            {message}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default DriverScreen;
