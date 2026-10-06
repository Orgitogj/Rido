import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { useI18n } from "@/lib/i18n";

import type { CollectionView } from "@/shared/contracts";

type Method = "pos" | "cash" | "unpaid";

const CollectionPanel = ({
  collection,
  fare,
  onRecord,
}: {
  collection: CollectionView;
  fare: string;
  onRecord: (method: Method) => Promise<void>;
}) => {
  const { t, error: errorText } = useI18n();
  const [busy, setBusy] = useState<Method | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const record = async (method: Method) => {
    if (busy) return;
    setBusy(method);
    setError(null);
    try {
      await onRecord(method);
      setConfirming(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!collection.canRecord) {
    const key =
      collection.status === "collected"
        ? collection.method === "cash"
          ? "recorded_cash"
          : "recorded_pos"
        : collection.status === "unpaid"
          ? "recorded_unpaid"
          : collection.status === "waived"
            ? "recorded_waived"
            : null;
    if (!key) return null;
    return (
      <View className="bg-general-600 rounded-2xl p-4 mt-5">
        <Text className="text-sm" accessibilityLiveRegion="polite">
          {t(`ride.collection.${key}`)}
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-orange-50 rounded-2xl p-4 mt-5">
      <Text className="text-base font-JakartaBold" accessibilityRole="header">
        {t("ride.collection.title")}
      </Text>
      <Text className="text-sm text-neutral-700 mt-1">
        {t("ride.collection.prompt", { fare })}
      </Text>
      {error && (
        <Text
          className="text-sm text-red-600 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      {!confirming && (
        <>
          <CustomButton
            title={
              busy === "pos"
                ? t("ride.collection.saving")
                : t("ride.collection.pos")
            }
            className="mt-3"
            disabled={busy !== null}
            onPress={() => record("pos")}
          />
          <CustomButton
            title={
              busy === "cash"
                ? t("ride.collection.saving")
                : t("ride.collection.cash")
            }
            bgVariant="success"
            className="mt-3"
            disabled={busy !== null}
            onPress={() => record("cash")}
          />
          <CustomButton
            title={t("ride.collection.unpaid")}
            bgVariant="outline"
            textVariant="danger"
            className="mt-3"
            disabled={busy !== null}
            onPress={() => setConfirming(true)}
          />
        </>
      )}
      {confirming && (
        <View accessibilityRole="alert">
          <Text className="text-sm mt-3">
            {t("ride.collection.unpaidConfirm")}
          </Text>
          <CustomButton
            title={
              busy === "unpaid"
                ? t("ride.collection.saving")
                : t("ride.collection.unpaidYes")
            }
            bgVariant="danger"
            className="mt-3"
            disabled={busy !== null}
            onPress={() => record("unpaid")}
          />
          <CustomButton
            title={t("ride.collection.back")}
            bgVariant="outline"
            textVariant="primary"
            className="mt-2"
            disabled={busy !== null}
            onPress={() => setConfirming(false)}
          />
        </View>
      )}
    </View>
  );
};

export default CollectionPanel;
