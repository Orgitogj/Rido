import { Text } from "react-native";

import { useI18n } from "@/lib/i18n";
import { PaymentProps } from "@/types/type";

const StripeCheckout = (_props: PaymentProps) => {
  const { t } = useI18n();
  return (
    <Text className="text-sm text-general-200 text-center my-10">
      {t("pay.webOnly")}
    </Text>
  );
};

export default StripeCheckout;
