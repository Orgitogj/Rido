import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";
import { RIDE_PIN, type PinEntryView } from "@/shared/contracts";

export const PassengerPin = ({ pin }: { pin: string }) => {
  const { t } = useI18n();
  return (
    <View
      className="bg-[#E6F3FF] rounded-2xl p-4 mt-4"
      accessible
      accessibilityLabel={`${t("ride.pin.title")}: ${pin.split("").join(" ")}. ${t("ride.pin.explain")}`}
    >
      <Text className="text-sm font-JakartaSemiBold">
        {t("ride.pin.title")}
      </Text>
      <Text
        className="text-4xl font-JakartaExtraBold mt-1"
        style={{ letterSpacing: 8 }}
        selectable
      >
        {pin}
      </Text>
      <Text className="text-xs text-neutral-700 mt-2">
        {t("ride.pin.explain")}
      </Text>
    </View>
  );
};

export function useLockSeconds(lockedUntil: string | null, serverTime: string) {
  const [offset] = useState(() => new Date(serverTime).getTime() - Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);
  if (!lockedUntil) return 0;
  return Math.max(
    0,
    Math.ceil((new Date(lockedUntil).getTime() - (now + offset)) / 1000),
  );
}

export const DriverPinEntry = ({
  entry,
  serverTime,
  value,
  onChange,
  disabled,
}: {
  entry: PinEntryView;
  serverTime: string;
  value: string;
  onChange: (pin: string) => void;
  disabled: boolean;
}) => {
  const { t, tn } = useI18n();
  const lockSeconds = useLockSeconds(entry.lockedUntil, serverTime);
  if (!entry.required) return null;

  return (
    <View className="bg-general-600 rounded-2xl p-4 mt-5">
      <Text className="text-base font-JakartaBold">
        {t("ride.pin.driverTitle")}
      </Text>
      <Text className="text-sm text-neutral-700 mt-1">
        {t("ride.pin.driverHint")}
      </Text>
      {entry.blocked ? (
        <Text
          className="text-sm text-red-600 mt-3"
          accessibilityLiveRegion="polite"
        >
          {t("ride.pin.blocked")}
        </Text>
      ) : (
        <>
          <BottomSheetTextInput
            value={value}
            onChangeText={(text) =>
              onChange(text.replace(/\D/g, "").slice(0, RIDE_PIN.digits))
            }
            editable={!disabled && lockSeconds === 0}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={RIDE_PIN.digits}
            autoComplete="off"
            textContentType="none"
            accessibilityLabel={t("ride.pin.inputLabel")}
            placeholder="••••"
            placeholderTextColor="#8a8a8a"
            className="bg-white rounded-xl px-4 min-h-[52px] text-2xl font-JakartaBold mt-3"
            style={{ letterSpacing: 8 }}
          />
          {lockSeconds > 0 ? (
            <Text
              className="text-sm text-red-600 mt-2"
              accessibilityLiveRegion="polite"
            >
              {t("ride.pin.locked", { seconds: lockSeconds })}
            </Text>
          ) : (
            entry.attemptsLeft < RIDE_PIN.maxAttempts && (
              <Text
                className="text-sm text-orange-800 mt-2"
                accessibilityLiveRegion="polite"
              >
                {tn("ride.pin.attemptsLeft", entry.attemptsLeft)}
              </Text>
            )
          )}
        </>
      )}
    </View>
  );
};
