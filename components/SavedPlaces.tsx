import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";

import InputField from "@/components/InputField";
import { useI18n } from "@/lib/i18n";
import { matchingPlace, placeTitle, usePlaces } from "@/lib/places";

import type { SavedPlace, SavedPlaceKind } from "@/shared/account";

const Chip = ({
  label,
  hint,
  muted,
  onPress,
}: {
  label: string;
  hint?: string;
  muted?: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={hint ? `${label}, ${hint}` : label}
    className={`mr-2 px-4 py-2 rounded-full min-h-[44px] justify-center ${muted ? "bg-white border border-neutral-300" : "bg-[#E6F3FF]"}`}
  >
    <Text
      className={`text-sm font-JakartaSemiBold ${muted ? "text-neutral-600" : "text-[#0286FF]"}`}
      numberOfLines={1}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

export const SavedPlaceChips = ({
  onSelect,
}: {
  onSelect: (place: SavedPlace) => void;
}) => {
  const { t } = useI18n();
  const { places, status } = usePlaces();
  const names = { home: t("places.home"), work: t("places.work") };
  const has = (kind: SavedPlaceKind) => places.some((p) => p.kind === kind);
  if (status === "error" && places.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className="mt-3"
      accessibilityLabel={t("places.pick")}
    >
      {places.map((p) => (
        <Chip
          key={p.id}
          label={placeTitle(p, names)}
          hint={p.address}
          onPress={() => onSelect(p)}
        />
      ))}
      {status === "ready" && !has("home") && (
        <Chip
          muted
          label={t("places.addHome")}
          onPress={() => router.push("/(root)/places")}
        />
      )}
      {status === "ready" && !has("work") && (
        <Chip
          muted
          label={t("places.addWork")}
          onPress={() => router.push("/(root)/places")}
        />
      )}
      {status === "ready" && (
        <Chip
          muted
          label={t("places.manage")}
          onPress={() => router.push("/(root)/places")}
        />
      )}
    </ScrollView>
  );
};

export const SavePlacePrompt = ({
  place,
}: {
  place: {
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    providerPlaceId?: string | null;
  };
}) => {
  const { t, error: errorText } = useI18n();
  const { places, save, status, customRemaining } = usePlaces();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  if (
    !place.address ||
    place.latitude === null ||
    place.longitude === null ||
    status !== "ready"
  ) {
    return null;
  }
  if (matchingPlace(places, place)) {
    return message?.ok ? (
      <Text
        className="text-xs text-green-700 mt-1"
        accessibilityLiveRegion="polite"
      >
        {message.text}
      </Text>
    ) : null;
  }

  const store = async (kind: SavedPlaceKind) => {
    if (busy) return;
    if (kind === "custom" && !label.trim()) {
      setMessage({ ok: false, text: t("places.labelRequired") });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await save({
        kind,
        label: kind === "custom" ? label.trim() : null,
        address: place.address!,
        latitude: place.latitude!,
        longitude: place.longitude!,
        providerPlaceId: place.providerPlaceId ?? null,
      });
      setOpen(false);
      setLabel("");
      setMessage({ ok: true, text: t("places.saved") });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-1">
      {!open ? (
        <TouchableOpacity
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          className="min-h-[44px] justify-center"
        >
          <Text className="text-sm text-[#0286FF] font-JakartaSemiBold">
            {t("places.saveThis")}
          </Text>
        </TouchableOpacity>
      ) : (
        <View className="bg-neutral-100 rounded-xl p-3">
          <Text className="text-sm font-JakartaSemiBold">
            {t("places.saveAs")}
          </Text>
          <View className="flex flex-row mt-2">
            <Chip label={t("places.asHome")} onPress={() => store("home")} />
            <Chip label={t("places.asWork")} onPress={() => store("work")} />
          </View>
          {places.some((p) => p.kind === "home") && (
            <Text className="text-xs text-general-200 mt-1">
              {t("places.replaceHome")}
            </Text>
          )}
          {places.some((p) => p.kind === "work") && (
            <Text className="text-xs text-general-200 mt-1">
              {t("places.replaceWork")}
            </Text>
          )}
          {customRemaining > 0 ? (
            <>
              <InputField
                label={t("places.label")}
                placeholder={t("places.labelHint")}
                value={label}
                onChangeText={setLabel}
                maxLength={40}
                containerStyle="w-full"
                inputStyle="p-3"
              />
              <View className="flex flex-row">
                <Chip
                  label={t("places.asOther")}
                  onPress={() => store("custom")}
                />
                <Chip
                  muted
                  label={t("common.cancel")}
                  onPress={() => setOpen(false)}
                />
              </View>
            </>
          ) : (
            <Text className="text-xs text-general-200 mt-2">
              {t("places.limitReached")}
            </Text>
          )}
        </View>
      )}
      {message && !message.ok && (
        <Text
          className="text-xs text-red-500 mt-1"
          accessibilityLiveRegion="polite"
        >
          {message.text}
        </Text>
      )}
    </View>
  );
};
