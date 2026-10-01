import { Text, View } from "react-native";
import { ReactNativeModal } from "react-native-modal";

import CustomButton from "@/components/CustomButton";
import { useI18n } from "@/lib/i18n";

export const INTERRUPT_REASONS = [
  "passenger_unsafe",
  "vehicle_problem",
  "driver_emergency",
  "passenger_request",
  "other",
] as const;

const InterruptReasonSheet = ({
  visible,
  consequence,
  onChoose,
  onClose,
}: {
  visible: boolean;
  consequence: string;
  onChoose: (reason: string) => void;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  return (
    <ReactNativeModal isVisible={visible} onBackdropPress={onClose}>
      <View className="bg-white rounded-2xl p-6">
        <Text className="text-xl font-JakartaBold" accessibilityRole="header">
          {t("ride.cancel.whyEnding")}
        </Text>
        <Text className="text-sm text-general-200 mt-2">{consequence}</Text>
        {INTERRUPT_REASONS.map((reason) => (
          <CustomButton
            key={reason}
            title={t(`ride.interruptReason.${reason}`)}
            bgVariant="outline"
            textVariant="primary"
            className="mt-3"
            onPress={() => onChoose(reason)}
          />
        ))}
        <CustomButton
          title={t("ride.cancel.keepDriving")}
          className="mt-5"
          onPress={onClose}
        />
      </View>
    </ReactNativeModal>
  );
};

export default InterruptReasonSheet;
