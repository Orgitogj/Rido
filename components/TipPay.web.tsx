import { Text } from "react-native";

import type { TipPayProps } from "@/components/TipPay";

const TipPay = (_props: TipPayProps) => (
  <Text className="text-sm text-general-200 mt-2">
    Tips can be paid in the iOS and Android app.
  </Text>
);

export default TipPay;
