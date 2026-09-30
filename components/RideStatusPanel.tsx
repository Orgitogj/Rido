import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { formatRating } from "@/lib/ratingText";
import {
  ACTION_LABEL,
  isTerminal,
  paymentNote,
  rideHeadline,
} from "@/lib/rideText";
import { formatCents, formatDate, formatTime } from "@/lib/utils";

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
    <Text className="text-base font-JakartaSemiBold">{value}</Text>
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
  const [busy, setBusy] = useState<RideAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searching = ride.status === "requested" || ride.status === "offered";
  const secondsLeft = useSecondsLeft(
    searching ? ride.searchDeadline : null,
    ride.serverTime,
  );
  const isDriver = ride.viewer === "driver";

  const [choosingReason, setChoosingReason] = useState(false);

  const run = async (action: RideAction, reason?: string) => {
    if (busy) return;
    setBusy(action);
    setError(null);
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
          ? "The ride changed before your action went through. Showing the latest status."
          : e instanceof Error
            ? e.message
            : "Something went wrong.",
      );
    } finally {
      setBusy(null);
    }
  };

  const confirm = (action: "cancel" | "interrupt") => {
    const preview = ride.cancellation;
    if (!preview) return;
    Alert.alert(preview.title, preview.consequence, [
      {
        text: action === "interrupt" ? "Keep driving" : "Keep ride",
        style: "cancel",
      },
      {
        text: action === "interrupt" ? "Choose a reason" : "Cancel ride",
        style: "destructive",
        onPress: () =>
          action === "interrupt" ? setChoosingReason(true) : run("cancel"),
      },
    ]);
  };

  return (
    <View className="pb-10">
      {connection === "reconnecting" && (
        <View className="bg-orange-100 rounded-lg px-3 py-2 mb-3">
          <Text className="text-xs text-orange-700">
            Reconnecting… showing the last known status.
          </Text>
        </View>
      )}

      <View className="flex flex-row items-center justify-between mb-2">
        <StatusBadge status={ride.status} />
        <Text className="text-lg font-JakartaBold">
          {formatCents(ride.fareCents)}
        </Text>
      </View>
      <Text className="text-2xl font-JakartaBold mt-2">
        {rideHeadline(ride)}
      </Text>

      {searching && !isDriver && (
        <View className="flex flex-row items-center mt-4">
          <ActivityIndicator size="small" color="#0286FF" />
          <Text className="text-sm text-general-200 ml-3">
            {ride.status === "offered"
              ? "A nearby driver is reviewing your request."
              : "Looking for available drivers nearby."}
            {secondsLeft !== null ? ` Search ends in ${secondsLeft}s.` : ""}
          </Text>
        </View>
      )}

      {live && !isTerminal(ride.status) && (
        <EtaCard live={live} viewer={ride.viewer} />
      )}

      {ride.driver && !isDriver && (
        <View className="bg-general-600 rounded-2xl px-4 py-2 mt-4">
          <Row label="Driver" value={ride.driver.name} />
          <Row
            label="Vehicle"
            value={[ride.driver.color, ride.driver.vehicle]
              .filter(Boolean)
              .join(" ")}
          />
          <Row label="Plate" value={ride.driver.plate} />
          <Row label="Seats" value={String(ride.driver.seats)} />
          <Row label="Rating" value={formatRating(ride.counterpartRating)} />
        </View>
      )}

      {isDriver && (
        <View className="bg-general-600 rounded-2xl px-4 py-2 mt-4">
          <Row label="Passenger" value={ride.passengerName ?? "Passenger"} />
          <Row label="Rating" value={formatRating(ride.counterpartRating)} />
          <Row
            label="Est. trip time"
            value={formatTime(ride.durationSeconds / 60)}
          />
        </View>
      )}

      {ride.status !== "legacy" && (
        <CustomButton
          title="Safety"
          bgVariant="outline"
          textVariant="primary"
          className="mt-4"
          accessibilityHint="Report a safety issue, contact support or share your trip"
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
                ? `Message ${isDriver ? "passenger" : "driver"}${ride.chat.unread > 0 ? ` (${ride.chat.unread} new)` : ""}`
                : "View messages"
            }
            bgVariant={ride.chat.unread > 0 ? "primary" : "outline"}
            textVariant={ride.chat.unread > 0 ? "default" : "primary"}
            accessibilityHint="Opens the conversation for this ride"
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
          Booked with the earlier demo flow and a simulated driver (
          {ride.legacyDemoDriver}). No real driver was involved.
        </Text>
      )}

      <Route ride={ride} />

      {isDriver && !isTerminal(ride.status) && (
        <View className="flex flex-row mt-3 gap-x-3">
          <CustomButton
            title="Pickup in Maps"
            bgVariant="outline"
            textVariant="primary"
            className="flex-1 w-auto"
            onPress={() => openInMaps(ride.pickup)}
          />
          <CustomButton
            title="Destination"
            bgVariant="outline"
            textVariant="primary"
            className="flex-1 w-auto"
            onPress={() => openInMaps(ride.destination)}
          />
        </View>
      )}

      {ride.status === "completed" && (
        <View className="bg-general-600 rounded-2xl px-4 py-2 mt-4">
          <Row
            label="Requested"
            value={formatDate(ride.requestedAt ?? ride.createdAt)}
          />
          {ride.startedAt && (
            <Row label="Picked up" value={formatDate(ride.startedAt)} />
          )}
          {ride.completedAt && (
            <Row label="Dropped off" value={formatDate(ride.completedAt)} />
          )}
          <Row
            label={ride.paymentStatus === "paid" ? "Charged" : "Fare"}
            value={formatCents(ride.fareCents)}
          />
        </View>
      )}

      {ride.status === "completed" && (
        <RatingCard
          rideId={ride.id}
          rating={ride.rating}
          counterpart={isDriver ? "the passenger" : "your driver"}
        />
      )}

      {!isDriver && ride.status !== "legacy" && (
        <Text className="text-sm text-general-200 mt-4">
          {paymentNote(ride.paymentStatus, ride.status, ride.settlement)}
        </Text>
      )}

      {error && (
        <Text
          className="text-sm text-red-500 mt-4"
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
            title={busy === action ? "Updating…" : ACTION_LABEL[action]}
            disabled={busy !== null}
            className="mt-5"
            onPress={() => run(action)}
          />
        ))}

      {ride.allowedActions.includes("cancel") && (
        <CustomButton
          title={busy === "cancel" ? "Cancelling…" : ACTION_LABEL.cancel}
          bgVariant="danger"
          disabled={busy !== null}
          className="mt-5"
          onPress={() => confirm("cancel")}
        />
      )}

      {ride.allowedActions.includes("interrupt") && (
        <CustomButton
          title={busy === "interrupt" ? "Ending trip…" : ACTION_LABEL.interrupt}
          bgVariant="outline"
          textVariant="danger"
          disabled={busy !== null}
          className="mt-5"
          onPress={() => confirm("interrupt")}
        />
      )}

      <InterruptReasonSheet
        visible={choosingReason}
        consequence={ride.cancellation?.consequence ?? ""}
        onClose={() => setChoosingReason(false)}
        onChoose={(reason) => {
          setChoosingReason(false);
          run("interrupt", reason);
        }}
      />

      {!isDriver && isTerminal(ride.status) && ride.status !== "legacy" && (
        <CustomButton
          title="View receipt"
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
          title="Try again"
          className="mt-5"
          onPress={() => router.replace("/(root)/confirm-ride")}
        />
      )}

      {isTerminal(ride.status) && (
        <CustomButton
          title={isDriver ? "Back to driving" : "Back home"}
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
