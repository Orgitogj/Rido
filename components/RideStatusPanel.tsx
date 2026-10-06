import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Text,
  View,
} from "react-native";

import CustomButton from "@/components/CustomButton";
import EtaCard from "@/components/EtaCard";
import InterruptReasonSheet from "@/components/InterruptReasonSheet";
import RatingCard from "@/components/RatingCard";
import StatusBadge from "@/components/StatusBadge";
import { icons } from "@/constants";
import { ApiRequestError } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { formatRating } from "@/lib/ratingText";
import {
  actionLabel,
  cancellationText,
  isTerminal,
  paymentNote,
  rideHeadline,
} from "@/lib/rideText";

import type {
  LiveTripView,
  Place,
  RideAction,
  RideView,
} from "@/shared/contracts";

function useSecondsLeft(deadline: string | null, serverTime: string) {
  const [now, setNow] = useState(Date.now());
  const [offset] = useState(() => new Date(serverTime).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!deadline) return null;
  return Math.max(
    0,
    Math.round((new Date(deadline).getTime() - (now + offset)) / 1000),
  );
}

const openInMaps = (place: Place) => {
  const q = `${place.latitude},${place.longitude}`;
  const url =
    Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${q}`
      : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  Linking.openURL(url).catch(() => {});
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <View className="flex flex-row items-center justify-between w-full border-b border-white py-3">
    <Text className="text-base font-Jakarta">{label}</Text>
    <Text className="text-base font-JakartaSemiBold ml-3 flex-shrink text-right">
      {value}
    </Text>
  </View>
);

const Route = ({ ride }: { ride: RideView }) => (
  <View className="flex flex-col w-full mt-4">
    <View className="flex flex-row items-center border-t border-b border-general-700 w-full py-3">
      <Image source={icons.to} className="w-6 h-6" />
      <Text className="text-base font-Jakarta ml-2 flex-1">
        {ride.pickup.address}
      </Text>
    </View>
    <View className="flex flex-row items-center border-b border-general-700 w-full py-3">
      <Image source={icons.point} className="w-6 h-6" />
      <Text className="text-base font-Jakarta ml-2 flex-1">
        {ride.destination.address}
      </Text>
    </View>
  </View>
);

const RideStatusPanel = ({
  ride,
  live,
  connection,
  perform,
}: {
  ride: RideView;
  live: LiveTripView | null;
  connection: "connecting" | "live" | "reconnecting";
  perform: (action: RideAction, reason?: string) => Promise<"ok" | "left">;
}) => {
  const {
    t,
    language,
    error: errorText,
    money,
    dateTime,
    duration,
  } = useI18n();
  const [busy, setBusy] = useState<RideAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"cancel" | "interrupt" | null>(
    null,
  );
  const [choosingReason, setChoosingReason] = useState(false);
  const searching = ride.status === "requested" || ride.status === "offered";
  const secondsLeft = useSecondsLeft(
    searching ? ride.searchDeadline : null,
    ride.serverTime,
  );
  const isDriver = ride.viewer === "driver";
  const preview = ride.cancellation
    ? cancellationText(ride.cancellation, money(ride.fareCents), language)
    : null;

  useEffect(() => {
    if (!ride.cancellation) setConfirming(null);
  }, [ride.cancellation]);

  const run = async (action: RideAction, reason?: string) => {
    if (busy) return;
    setBusy(action);
    setError(null);
    setConfirming(null);
    try {
      const result = await perform(action, reason);
      if (result === "left") router.replace("/(root)/driver");
    } catch (e) {
      if (
        ride.viewer === "driver" &&
        action === "cancel" &&
        e instanceof ApiRequestError &&
        e.status === 404
      ) {
        router.replace("/(root)/driver");
        return;
      }
      setError(
        e instanceof ApiRequestError && e.code === "INVALID_TRANSITION"
          ? t("ride.panel.changed")
          : errorText(e),
      );
    } finally {
      setBusy(null);
    }
  };

  const busyLabel = (action: RideAction) =>
    action === "cancel"
      ? t("ride.busy.cancelling")
      : action === "interrupt"
        ? t("ride.busy.ending")
        : t("ride.busy.updating");

  const navigateTo =
    ride.status === "in_progress" ? ride.destination : ride.pickup;

  return (
    <View className="pb-10">
      {connection === "reconnecting" && (
        <View
          className="bg-orange-100 rounded-lg px-3 py-2 mb-3"
          accessibilityLiveRegion="polite"
        >
          <Text className="text-xs text-orange-800">
            {t("ride.panel.reconnecting")}
          </Text>
        </View>
      )}

      <View className="flex flex-row items-center justify-between mb-2">
        <StatusBadge status={ride.status} />
        <Text className="text-lg font-JakartaBold">
          {money(ride.fareCents, ride.currency)}
        </Text>
      </View>
      <Text
        className="text-2xl font-JakartaBold mt-2"
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
      >
        {rideHeadline(ride, language)}
      </Text>

      {searching && !isDriver && (
        <View className="flex flex-row items-center mt-4">
          <ActivityIndicator size="small" color="#0286FF" />
          <Text className="text-sm text-general-200 ml-3 flex-1">
            {ride.status === "offered"
              ? t("ride.panel.offerReview")
              : t("ride.panel.lookingNearby")}
            {secondsLeft !== null
              ? ` ${t("ride.panel.searchEnds", { seconds: secondsLeft })}`
              : ""}
          </Text>
        </View>
      )}

      {live && !isTerminal(ride.status) && (
        <EtaCard live={live} viewer={ride.viewer} />
      )}

      {ride.driver && !isDriver && (
        <View className="bg-general-600 rounded-2xl px-4 py-2 mt-4">
          <Row label={t("ride.panel.driver")} value={ride.driver.name} />
          <Row
            label={t("ride.panel.vehicle")}
            value={[ride.driver.color, ride.driver.vehicle]
              .filter(Boolean)
              .join(" ")}
          />
          <Row label={t("ride.panel.plate")} value={ride.driver.plate} />
          <Row
            label={t("ride.panel.seats")}
            value={String(ride.driver.seats)}
          />
          <Row
            label={t("ride.panel.rating")}
            value={formatRating(ride.counterpartRating, language)}
          />
        </View>
      )}

      {isDriver && (
        <View className="bg-general-600 rounded-2xl px-4 py-2 mt-4">
          <Row
            label={t("ride.panel.passenger")}
            value={ride.passengerName ?? t("ride.panel.passengerFallback")}
          />
          <Row
            label={t("ride.panel.rating")}
            value={formatRating(ride.counterpartRating, language)}
          />
          <Row
            label={t("ride.panel.tripTime")}
            value={duration(ride.durationSeconds / 60)}
          />
        </View>
      )}

      {isDriver && !isTerminal(ride.status) && (
        <CustomButton
          title={
            ride.status === "in_progress"
              ? t("ride.panel.navigateDestination")
              : t("ride.panel.navigatePickup")
          }
          bgVariant="outline"
          textVariant="primary"
          className="mt-4"
          accessibilityHint={t("ride.panel.navigateHint")}
          onPress={() => openInMaps(navigateTo)}
        />
      )}

      {ride.status !== "legacy" && (
        <CustomButton
          title={t("ride.panel.safety")}
          bgVariant="outline"
          textVariant="primary"
          className="mt-4"
          accessibilityHint={t("ride.panel.safetyHint")}
          onPress={() =>
            router.push({
              pathname: "/(root)/safety/[id]",
              params: { id: ride.id },
            })
          }
        />
      )}

      {(ride.chat.state === "open" ||
        (ride.chat.state === "closed" && ride.chat.latestSeq > 0)) && (
        <View className="mt-4">
          <CustomButton
            title={
              ride.chat.state === "open"
                ? `${t(isDriver ? "ride.panel.messagePassenger" : "ride.panel.messageDriver")}${ride.chat.unread > 0 ? ` (${t("ride.panel.newMessages", { count: ride.chat.unread })})` : ""}`
                : t("ride.panel.viewMessages")
            }
            bgVariant={ride.chat.unread > 0 ? "primary" : "outline"}
            textVariant={ride.chat.unread > 0 ? "default" : "primary"}
            accessibilityHint={t("ride.panel.chatHint")}
            onPress={() =>
              router.push({
                pathname: "/(root)/chat/[id]",
                params: { id: ride.id },
              })
            }
          />
        </View>
      )}

      {ride.status === "legacy" && ride.legacyDemoDriver && (
        <Text className="text-sm text-general-200 mt-3">
          {t("ride.panel.legacyNote", { driver: ride.legacyDemoDriver })}
        </Text>
      )}

      <Route ride={ride} />

      {ride.status === "completed" && (
        <View className="bg-general-600 rounded-2xl px-4 py-2 mt-4">
          <Row
            label={t("ride.panel.requested")}
            value={dateTime(ride.requestedAt ?? ride.createdAt)}
          />
          {ride.startedAt && (
            <Row
              label={t("ride.panel.pickedUp")}
              value={dateTime(ride.startedAt)}
            />
          )}
          {ride.completedAt && (
            <Row
              label={t("ride.panel.droppedOff")}
              value={dateTime(ride.completedAt)}
            />
          )}
          <Row
            label={
              ride.paymentStatus === "paid"
                ? t("ride.panel.charged")
                : t("ride.panel.fare")
            }
            value={money(ride.fareCents, ride.currency)}
          />
        </View>
      )}

      {ride.status === "completed" && (
        <RatingCard
          rideId={ride.id}
          rating={ride.rating}
          counterpart={isDriver ? "passenger" : "driver"}
        />
      )}

      {!isDriver && ride.status !== "legacy" && (
        <Text className="text-sm text-general-200 mt-4">
          {paymentNote(
            ride.paymentStatus,
            ride.status,
            ride.settlement,
            language,
          )}
        </Text>
      )}

      {error && (
        <Text
          className="text-sm text-red-600 mt-4"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}

      {ride.allowedActions
        .filter((a) => a !== "cancel" && a !== "interrupt")
        .map((action) => (
          <CustomButton
            key={action}
            title={
              busy === action
                ? busyLabel(action)
                : actionLabel(action, language)
            }
            disabled={busy !== null}
            className="mt-5"
            onPress={() => run(action)}
          />
        ))}

      {confirming && preview && (
        <View
          className="bg-red-50 rounded-2xl p-4 mt-5"
          accessibilityRole="alert"
        >
          <Text className="text-base font-JakartaBold">{preview.title}</Text>
          <Text className="text-sm text-neutral-700 mt-2">{preview.body}</Text>
          <CustomButton
            title={
              confirming === "interrupt"
                ? t("ride.cancel.chooseReason")
                : t("ride.cancel.confirmCancel")
            }
            bgVariant="danger"
            disabled={busy !== null}
            className="mt-4"
            onPress={() => {
              if (confirming === "interrupt") {
                setConfirming(null);
                setChoosingReason(true);
              } else {
                run("cancel");
              }
            }}
          />
          <CustomButton
            title={
              confirming === "interrupt"
                ? t("ride.cancel.keepDriving")
                : t("ride.cancel.keepRide")
            }
            bgVariant="outline"
            textVariant="primary"
            className="mt-3"
            onPress={() => setConfirming(null)}
          />
        </View>
      )}

      {!confirming && ride.allowedActions.includes("cancel") && (
        <CustomButton
          title={
            busy === "cancel"
              ? busyLabel("cancel")
              : actionLabel("cancel", language)
          }
          bgVariant="danger"
          disabled={busy !== null || !preview}
          className="mt-5"
          onPress={() => setConfirming("cancel")}
        />
      )}

      {!confirming && ride.allowedActions.includes("interrupt") && (
        <CustomButton
          title={
            busy === "interrupt"
              ? busyLabel("interrupt")
              : actionLabel("interrupt", language)
          }
          bgVariant="outline"
          textVariant="danger"
          disabled={busy !== null || !preview}
          className="mt-5"
          onPress={() => setConfirming("interrupt")}
        />
      )}

      <InterruptReasonSheet
        visible={choosingReason}
        consequence={preview?.body ?? ""}
        onClose={() => setChoosingReason(false)}
        onChoose={(reason) => {
          setChoosingReason(false);
          run("interrupt", reason);
        }}
      />

      {!isDriver && isTerminal(ride.status) && ride.status !== "legacy" && (
        <CustomButton
          title={t("ride.panel.viewReceipt")}
          bgVariant="outline"
          textVariant="primary"
          className="mt-5"
          onPress={() =>
            router.push({
              pathname: "/(root)/receipt/[id]",
              params: { id: ride.id },
            })
          }
        />
      )}

      {!isDriver && ride.status === "no_driver" && (
        <CustomButton
          title={t("ride.panel.tryAgain")}
          className="mt-5"
          onPress={() => router.replace("/(root)/confirm-ride")}
        />
      )}

      {isTerminal(ride.status) && (
        <CustomButton
          title={
            isDriver ? t("ride.panel.backDriving") : t("ride.panel.backHome")
          }
          bgVariant="outline"
          textVariant="primary"
          className="mt-5"
          onPress={() =>
            router.replace(isDriver ? "/(root)/driver" : "/(root)/(tabs)/home")
          }
        />
      )}
    </View>
  );
};

export default RideStatusPanel;
