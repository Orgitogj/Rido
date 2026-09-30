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
import { APPLICATION_STATUS } from "@/lib/driverVerification";
import { ApiRequestError, useApi } from "@/lib/fetch";
import { usePushStatus } from "@/lib/notifications";
import { formatRating } from "@/lib/ratingText";
import {
  currentFix,
  foregroundPermission,
  useDriverTracking,
} from "@/lib/tracking";

import type { DriverApplication, DriverDashboard } from "@/shared/contracts";

const DriverScreen = () => {
  const { user } = useUser();
  const { getToken } = useAuth();
  const request = useApi();
  const { data, error, receivedAt, refresh, replace } = useDriverDashboard();
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
      setMessage(
        e instanceof ApiRequestError ? e.message : "Something went wrong.",
      );
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
        throw new ApiRequestError(
          0,
          "LOCATION",
          "Turn on location services to go online.",
        );
      }
      if (permission === "unknown") {
        setExplaining(true);
        return;
      }
      if (permission === "denied") {
        throw new ApiRequestError(
          0,
          "LOCATION",
          "Location permission is off. Enable it in Settings to go online.",
        );
      }
      const fix = await currentFix();
      if (!fix) {
        throw new ApiRequestError(
          0,
          "LOCATION",
          "Couldn't get your position. Check that GPS is on and try again.",
        );
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

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex flex-row items-center justify-between my-5">
          <Text className="text-2xl font-JakartaExtraBold">Drive</Text>
          <CustomButton
            title="Rider mode"
            bgVariant="outline"
            textVariant="primary"
            className="w-36"
            onPress={() => router.replace("/(root)/(tabs)/home")}
          />
        </View>

        {!data && !error && (
          <ListState kind="loading" message="Loading your driver account…" />
        )}
        {!data && error && (
          <ListState kind="error" message={error} onRetry={refresh} />
        )}
        {data && error && (
          <Text className="text-xs text-orange-700 mb-3">
            Reconnecting… {error}
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
            <Text className="text-lg font-JakartaBold">
              {profile.status === "approved" && !profile.eligible
                ? "Approval expired"
                : APPLICATION_STATUS[profile.status].title}
            </Text>
            <Text className="text-base text-general-200 mt-2">
              {profile.status === "approved" && !profile.eligible
                ? "One of your documents has expired. Start an update and upload a current document."
                : APPLICATION_STATUS[profile.status].body}
            </Text>
            {profile.applicantMessage && (
              <View className="bg-general-500 rounded-xl p-3 mt-3">
                <Text className="text-sm font-JakartaSemiBold">
                  Message from the review team
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
            {profile.ineligibleReasons.length > 0 &&
              profile.status !== "draft" &&
              profile.status !== "changes_requested" && (
                <Text className="text-sm text-general-200 mt-2">
                  {profile.ineligibleReasons.join(" ")}
                </Text>
              )}
            {(profile.canEdit || profile.status === "submitted") && (
              <View className="mt-3">
                {profile.requirements.map((r) => (
                  <Text
                    key={r.key}
                    className={`text-sm ${r.met ? "text-green-700" : "text-general-200"}`}
                  >
                    {r.met ? "✓" : "○"} {r.label}
                  </Text>
                ))}
              </View>
            )}
            {profile.canEdit && !editing && (
              <CustomButton
                title="Edit details"
                bgVariant="outline"
                textVariant="primary"
                className="mt-4"
                onPress={() => setEditing(true)}
              />
            )}
            {profile.canEdit && (
              <CustomButton
                title={busy ? "…" : "Submit for review"}
                disabled={busy || !profile.canSubmit}
                className="mt-3"
                onPress={submitApplication}
              />
            )}
            {profile.canEdit && !profile.canSubmit && (
              <Text className="text-xs text-general-200 mt-2">
                Complete every item above to submit.
              </Text>
            )}
            {profile.canReopen && (
              <CustomButton
                title={busy ? "…" : "Start an update"}
                bgVariant="outline"
                textVariant="primary"
                disabled={busy}
                className="mt-4"
                onPress={reopenApplication}
              />
            )}
            {profile.status === "approved" && profile.canReopen && (
              <Text className="text-xs text-general-200 mt-2">
                Starting an update takes you off the road until an operator
                approves it again.
              </Text>
            )}
            <Text className="text-xs text-general-200 mt-4">
              Your account ID:
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
              title="Update vehicle or documents"
              bgVariant="outline"
              textVariant="primary"
              className="mb-5"
              onPress={reopenApplication}
            />
          )}

        {profile && ((profile.eligible && !editing) || activeRide) && (
          <>
            <View className="bg-white rounded-2xl p-5">
              <Text className="text-lg font-JakartaBold">
                {profile.online ? "You're online" : "You're offline"}
              </Text>
              <Text className="text-sm text-general-200 mt-1">
                {profile.online
                  ? "You'll receive ride requests near you. Your location is shared while you're online."
                  : "Go online to start receiving ride requests near you."}
              </Text>
              <Text className="text-sm text-general-200 mt-1">
                Your rating: {formatRating(profile.rating)}
              </Text>
              <CustomButton
                title="View earnings"
                bgVariant="outline"
                textVariant="primary"
                className="mt-3"
                onPress={() => router.push("/(root)/earnings")}
              />
              {(profile.eligible || profile.online) && (
                <CustomButton
                  title={
                    busy ? "…" : profile.online ? "Go offline" : "Go online"
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
                  You can finish your current trip. You won't receive new
                  requests.
                </Text>
              )}
            </View>

            {explaining && (
              <View className="bg-white rounded-2xl p-5 mt-5">
                <Text className="text-lg font-JakartaBold">
                  Share your location to drive
                </Text>
                <Text className="text-sm text-general-200 mt-2">
                  While you are online or on a ride, we use your location to
                  offer you nearby requests and to show your approximate
                  position and arrival time to your passenger. Sharing stops
                  when you go offline.
                </Text>
                <CustomButton
                  title="Allow location"
                  className="mt-4"
                  onPress={async () => {
                    setExplaining(false);
                    const result = await foregroundPermission(true);
                    if (result === "granted") setOnline(true);
                    else
                      setMessage(
                        "Location permission is needed to go online. You can enable it in Settings.",
                      );
                  }}
                />
                <CustomButton
                  title="Not now"
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
                  ? "Ride request notifications need a development build on Android. Keep this screen open."
                  : pushStatus === "denied"
                    ? "Notifications are off, so you'll only see requests while this screen is open."
                    : "Notifications aren't set up on this device. Keep this screen open."}
              </Text>
            )}

            {activeRide && (
              <View className="bg-white rounded-2xl p-5 mt-5">
                <View className="flex flex-row items-center justify-between">
                  <Text className="text-lg font-JakartaBold">Current ride</Text>
                  <StatusBadge status={activeRide.status} />
                </View>
                <Text
                  className="text-base text-general-200 mt-2"
                  numberOfLines={2}
                >
                  {activeRide.pickup.address} → {activeRide.destination.address}
                </Text>
                <CustomButton
                  title="Open ride"
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
              <ListState kind="loading" message="Waiting for ride requests…" />
            )}

            <DriverTrips />
          </>
        )}

        {message && (
          <Text
            className="text-sm text-red-500 mt-4"
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
