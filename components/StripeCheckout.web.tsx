import { Text } from "react-native";

import { PaymentProps } from "@/types/type";

const StripeCheckout = (_props: PaymentProps) => (
  <Text className="text-sm text-general-200 text-center my-10">
    Payments are available in the iOS and Android app.
  </Text>
);

export default StripeCheckout;
