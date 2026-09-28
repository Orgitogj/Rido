import { Text, View } from "react-native";
import { ReactNativeModal } from "react-native-modal";

import CustomButton from "@/components/CustomButton";

export const INTERRUPT_REASONS = [
  { value: "passenger_unsafe", label: "Safety concern with the passenger" },
  { value: "vehicle_problem", label: "Vehicle problem" },
  { value: "driver_emergency", label: "Personal emergency" },
  { value: "passenger_request", label: "Passenger asked to stop here" },
  { value: "other", label: "Other" },
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
}) => (
  <ReactNativeModal isVisible={visible} onBackdropPress={onClose}>
    <View className="bg-white rounded-2xl p-6">
      <Text className="text-xl font-JakartaBold">
        Why are you ending the trip?
      </Text>
      <Text className="text-sm text-general-200 mt-2">{consequence}</Text>
      {INTERRUPT_REASONS.map((reason) => (
        <CustomButton
          key={reason.value}
          title={reason.label}
          bgVariant="outline"
          textVariant="primary"
          className="mt-3"
          onPress={() => onChoose(reason.value)}
        />
      ))}
      <CustomButton title="Keep driving" className="mt-5" onPress={onClose} />
    </View>
  </ReactNativeModal>
);

export default InterruptReasonSheet;
