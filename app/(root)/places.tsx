import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import GoogleTextInput from "@/components/GoogleTextInput";
import InputField from "@/components/InputField";
import ListState from "@/components/ListState";
import { icons } from "@/constants";
import { useI18n } from "@/lib/i18n";
import { placeTitle, usePlaces } from "@/lib/places";

import type { SavedPlace, SavedPlaceKind } from "@/shared/account";
import type { SelectedPlace } from "@/types/type";

type Editing =
  | { mode: "create"; kind: SavedPlaceKind }
  | { mode: "edit"; place: SavedPlace };

const Places = () => {
  const { t, tn, error: errorText } = useI18n();
  const {
    places,
    customRemaining,
    status,
    error,
    reload,
    save,
    update,
    remove,
  } = usePlaces();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picked, setPicked] = useState<SelectedPlace | null>(null);
  const [label, setLabel] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const names = { home: t("places.home"), work: t("places.work") };
  const home = places.find((p) => p.kind === "home");
  const work = places.find((p) => p.kind === "work");
  const custom = places.filter((p) => p.kind === "custom");

  const start = (next: Editing) => {
    setEditing(next);
    setPicked(null);
    setMessage(null);
    setConfirming(null);
    setLabel(next.mode === "edit" ? (next.place.label ?? "") : "");
  };

  const isCustom =
    editing?.mode === "create"
      ? editing.kind === "custom"
      : editing?.place.kind === "custom";

  const submit = async () => {
    if (!editing || busy) return;
    if (isCustom && !label.trim()) {
      setMessage({ ok: false, text: t("places.labelRequired") });
      return;
    }
    if (editing.mode === "create" && !picked) {
      setMessage({ ok: false, text: t("places.chooseAddress") });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (editing.mode === "create") {
        await save({
          kind: editing.kind,
          label: isCustom ? label.trim() : null,
          address: picked!.address,
          latitude: picked!.latitude,
          longitude: picked!.longitude,
          providerPlaceId: picked!.providerPlaceId ?? null,
        });
      } else {
        const renamed =
          isCustom && label.trim() !== (editing.place.label ?? "");
        if (!picked && !renamed) {
          setEditing(null);
          return;
        }
        await update(editing.place.id, {
          ...(renamed ? { label: label.trim() } : {}),
          ...(picked
            ? {
                address: picked.address,
                latitude: picked.latitude,
                longitude: picked.longitude,
                providerPlaceId: picked.providerPlaceId ?? null,
              }
            : {}),
        });
      }
      setEditing(null);
      setMessage({ ok: true, text: t("places.saved") });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (place: SavedPlace) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await remove(place.id);
      setMessage({ ok: true, text: t("places.deleted") });
    } catch (e) {
      const gone =
        typeof e === "object" &&
        e !== null &&
        "status" in e &&
        e.status === 404;
      setMessage(
        gone
          ? { ok: true, text: t("places.deleted") }
          : { ok: false, text: errorText(e) },
      );
    } finally {
      setConfirming(null);
      setBusy(false);
    }
  };

  const row = (place: SavedPlace) => (
    <View key={place.id} className="bg-white rounded-2xl p-4 mb-3">
      <Text className="text-base font-JakartaBold">
        {placeTitle(place, names)}
      </Text>
      <Text className="text-sm text-general-200 mt-1">{place.address}</Text>
      {confirming === place.id ? (
        <View className="mt-3">
          <Text className="text-sm">
            {t("places.deleteConfirm", { name: placeTitle(place, names) })}
          </Text>
          <View className="flex flex-row mt-2 gap-x-3">
            <CustomButton
              title={t("common.delete")}
              bgVariant="danger"
              className="flex-1 w-auto"
              disabled={busy}
              onPress={() => destroy(place)}
            />
            <CustomButton
              title={t("common.cancel")}
              bgVariant="outline"
              textVariant="primary"
              className="flex-1 w-auto"
              onPress={() => setConfirming(null)}
            />
          </View>
        </View>
      ) : (
        <View className="flex flex-row mt-3 gap-x-3">
          <CustomButton
            title={t("common.edit")}
            bgVariant="outline"
            textVariant="primary"
            className="flex-1 w-auto"
            onPress={() => start({ mode: "edit", place })}
          />
          <CustomButton
            title={t("common.delete")}
            bgVariant="outline"
            textVariant="primary"
            className="flex-1 w-auto"
            onPress={() => setConfirming(place.id)}
          />
        </View>
      )}
    </View>
  );

  const missing = (kind: "home" | "work") => (
    <View key={kind} className="bg-white rounded-2xl p-4 mb-3">
      <Text className="text-base font-JakartaBold">{names[kind]}</Text>
      <Text className="text-sm text-general-200 mt-1">
        {t("account.notSet")}
      </Text>
      <CustomButton
        title={kind === "home" ? t("places.addHome") : t("places.addWork")}
        bgVariant="outline"
        textVariant="primary"
        className="mt-3"
        onPress={() => start({ mode: "create", kind })}
      />
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex flex-row items-center my-5">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            className="w-11 h-11 rounded-full bg-white items-center justify-center mr-3"
          >
            <Text className="text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-2xl font-JakartaExtraBold">
            {t("places.title")}
          </Text>
        </View>

        {message && (
          <Text
            className={`text-sm mb-3 ${message.ok ? "text-green-700" : "text-red-500"}`}
            accessibilityLiveRegion="polite"
          >
            {message.text}
          </Text>
        )}

        {status === "loading" && places.length === 0 && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {status === "error" && places.length === 0 && (
          <ListState
            kind="error"
            message={errorText(error, t("places.loadFailed"))}
            onRetry={reload}
          />
        )}

        {editing ? (
          <View className="bg-white rounded-2xl p-4 mb-3">
            <Text className="text-base font-JakartaBold">
              {editing.mode === "edit"
                ? placeTitle(editing.place, names)
                : editing.kind === "custom"
                  ? t("places.addPlace")
                  : names[editing.kind]}
            </Text>
            {isCustom && (
              <InputField
                label={t("places.label")}
                placeholder={t("places.labelHint")}
                value={label}
                onChangeText={setLabel}
                maxLength={40}
                containerStyle="w-full"
                inputStyle="p-3.5"
              />
            )}
            <Text className="text-sm text-general-200 mt-2 mb-2">
              {picked?.address ??
                (editing.mode === "edit"
                  ? editing.place.address
                  : t("places.searchHint"))}
            </Text>
            <GoogleTextInput
              icon={icons.search}
              containerStyle="bg-neutral-100"
              textInputBackgroundColor="#f5f5f5"
              handlePress={(place) => {
                setPicked(place);
                setMessage(null);
              }}
            />
            <View className="flex flex-row mt-4 gap-x-3">
              <CustomButton
                title={busy ? t("common.saving") : t("common.save")}
                className="flex-1 w-auto"
                disabled={busy}
                onPress={submit}
              />
              <CustomButton
                title={t("common.cancel")}
                bgVariant="outline"
                textVariant="primary"
                className="flex-1 w-auto"
                onPress={() => setEditing(null)}
              />
            </View>
          </View>
        ) : (
          status !== "idle" &&
          (status !== "loading" || places.length > 0) &&
          (status !== "error" || places.length > 0) && (
            <>
              {home ? row(home) : missing("home")}
              {work ? row(work) : missing("work")}
              <Text className="text-lg font-JakartaBold mt-3 mb-3">
                {t("places.custom")}
              </Text>
              {custom.length === 0 && (
                <Text className="text-sm text-general-200 mb-3">
                  {t("places.none")}
                </Text>
              )}
              {custom.map(row)}
              {customRemaining > 0 ? (
                <>
                  <CustomButton
                    title={t("places.addPlace")}
                    onPress={() => start({ mode: "create", kind: "custom" })}
                  />
                  <Text className="text-xs text-general-200 mt-2">
                    {tn("places.remaining", customRemaining)}
                  </Text>
                </>
              ) : (
                <Text className="text-sm text-general-200">
                  {t("places.limitReached")}
                </Text>
              )}
            </>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default Places;
