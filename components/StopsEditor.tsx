import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";

import GoogleTextInput from "@/components/GoogleTextInput";
import { icons } from "@/constants";
import { useI18n } from "@/lib/i18n";
import { MAX_STOPS } from "@/lib/itinerary";
import { useLocationStore } from "@/store";

const Control = ({
  label,
  symbol,
  disabled,
  onPress,
}: {
  label: string;
  symbol: string;
  disabled?: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled }}
    className={`w-11 h-11 items-center justify-center rounded-full bg-white ml-1 ${disabled ? "opacity-30" : ""}`}
  >
    <Text className="text-lg">{symbol}</Text>
  </TouchableOpacity>
);

const StopsEditor = () => {
  const { t } = useI18n();
  const { stops, addStop, removeStop, moveStop } = useLocationStore();
  const [adding, setAdding] = useState(false);

  return (
    <View className="my-3">
      <Text className="text-lg font-JakartaSemiBold">
        {t("booking.stops.title")}
      </Text>
      <Text className="text-xs text-general-200 mt-1">
        {t("booking.stops.hint", { max: MAX_STOPS })}
      </Text>

      {stops.map((stop, index) => (
        <View
          key={`${stop.latitude},${stop.longitude},${index}`}
          className="bg-neutral-100 rounded-xl p-3 mt-2 flex flex-row items-center"
        >
          <View className="flex-1 pr-2">
            <Text className="text-xs text-general-200">
              {t("booking.stops.number", { number: index + 1 })}
            </Text>
            <Text className="text-sm font-JakartaMedium" numberOfLines={2}>
              {stop.address}
            </Text>
          </View>
          <Control
            symbol="↑"
            label={t("booking.stops.moveUp", { number: index + 1 })}
            disabled={index === 0}
            onPress={() => moveStop(index, -1)}
          />
          <Control
            symbol="↓"
            label={t("booking.stops.moveDown", { number: index + 1 })}
            disabled={index === stops.length - 1}
            onPress={() => moveStop(index, 1)}
          />
          <Control
            symbol="✕"
            label={t("booking.stops.remove", { number: index + 1 })}
            onPress={() => removeStop(index)}
          />
        </View>
      ))}

      {adding && stops.length < MAX_STOPS && (
        <View className="mt-2">
          <GoogleTextInput
            icon={icons.point}
            initialLocation={t("booking.stops.search")}
            containerStyle="bg-neutral-100"
            textInputBackgroundColor="transparent"
            handlePress={(location) => {
              addStop(location);
              setAdding(false);
            }}
          />
          <TouchableOpacity
            onPress={() => setAdding(false)}
            accessibilityRole="button"
            className="min-h-[44px] justify-center"
          >
            <Text className="text-sm text-[#0066CC] font-JakartaSemiBold">
              {t("common.cancel")}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {!adding && stops.length < MAX_STOPS && (
        <TouchableOpacity
          onPress={() => setAdding(true)}
          accessibilityRole="button"
          className="min-h-[44px] justify-center"
        >
          <Text className="text-sm text-[#0066CC] font-JakartaSemiBold">
            {t("booking.stops.add")}
          </Text>
        </TouchableOpacity>
      )}
      {stops.length > 0 && (
        <Text className="text-xs text-general-200">
          {t("booking.stops.fixed")}
        </Text>
      )}
    </View>
  );
};

export default StopsEditor;
