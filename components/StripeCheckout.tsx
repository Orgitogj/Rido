import { StripeProvider } from "@stripe/stripe-react-native";
import { Text } from "react-native";

import Payment from "@/components/Payment";
import { useI18n } from "@/lib/i18n";
import { PaymentProps } from "@/types/type";

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

const StripeCheckout = (props: PaymentProps) => {
  const { t } = useI18n();
  if (!stripePublishableKey) {
    return (
      <Text className="text-sm text-red-600 text-center my-10">
        {t("pay.notConfigured")}
      </Text>
    );
  }

  return (
    <StripeProvider
      publishableKey={stripePublishableKey}
      merchantIdentifier="merchant.com.uber"
      urlScheme="myapp"
    >
      <Payment {...props} />
    </StripeProvider>
  );
};

export default StripeCheckout;
