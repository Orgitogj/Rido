import { StripeProvider } from "@stripe/stripe-react-native";
import { Text } from "react-native";

import Payment from "@/components/Payment";
import { PaymentProps } from "@/types/type";

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

const StripeCheckout = (props: PaymentProps) => {
  if (!stripePublishableKey) {
    return (
      <Text className="text-sm text-red-500 text-center my-10">
        Payments aren&apos;t configured. Set EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
        (see README).
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
