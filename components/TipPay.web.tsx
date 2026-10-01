import { Text } from "react-native";

import { useI18n } from "@/lib/i18n";

import type { TipPayProps } from "@/components/TipPay";

const TipPay = (_props: TipPayProps) => {
  const { t } = useI18n();
  return (
    <Text className="text-sm text-general-200 mt-2">{t("pay.webOnly")}</Text>
  );
};

export default TipPay;
