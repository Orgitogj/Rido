import { useAuth } from "@clerk/expo";
import { useStripe } from "@stripe/stripe-react-native";
import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Image, Text, View } from "react-native";
import { ReactNativeModal } from "react-native-modal";

import CustomButton from "@/components/CustomButton";
import { images } from "@/constants";
import { fetchAPI } from "@/lib/fetch";
import { useLocationStore } from "@/store";
import { PaymentProps } from "@/types/type";

const Payment = ({
  fullName,
  email,
  amount,
  driverId,
  rideTime,
}: PaymentProps) => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const {
    userAddress,
    userLongitude,
    userLatitude,
    destinationLatitude,
    destinationAddress,
    destinationLongitude,
  } = useLocationStore();

  const { userId } = useAuth();
  const [success, setSuccess] = useState<boolean>(false);

  const openPaymentSheet = async () => {
    await initializePaymentSheet();

    const { error } = await presentPaymentSheet();

    if (error) {
      Alert.alert(`Error code: ${error.code}`, error.message);
    } else {
      setSuccess(true);
    }
  };

  const initializePaymentSheet = async () => {
    const { error } = await initPaymentSheet({
      merchantDisplayName: "Example, Inc.",
      intentConfiguration: {
        mode: {
          amount: parseInt(amount) * 100,
          currencyCode: "usd",
        },
        paymentMethodTypes: ["card"],
        confirmHandler: async (
          paymentMethod,
          shouldSavePaymentMethod,
          intentCreationCallback,
        ) => {
          let createResponse;

          try {
            createResponse = await fetchAPI("/api/stripe/create", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: fullName || email.split("@")[0],
                email: email,
                amount: amount,
                paymentMethodId: paymentMethod.id,
              }),
            });
          } catch (error) {
            Alert.alert(
              "Payment setup failed",
              error instanceof Error
                ? error.message
                : "Unable to create payment intent",
            );
            return;
          }

          const {
            paymentIntent,
            customer,
            clientSecret: createClientSecret,
            error: createError,
          } = createResponse ?? {};
          const clientSecret =
            paymentIntent?.client_secret || createClientSecret;

          if (!clientSecret) {
            Alert.alert(
              "Payment setup failed",
              createError ||
                createResponse?.error ||
                "The Stripe payment intent did not return a client secret.",
            );
            return;
          }

          let payResponse;

          try {
            payResponse = await fetchAPI("/api/stripe/pay", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                payment_method_id: paymentMethod.id,
                payment_intent_id: paymentIntent.id,
                customer_id: customer,
                client_secret: clientSecret,
              }),
            });
          } catch (error) {
            Alert.alert(
              "Payment confirmation failed",
              error instanceof Error
                ? error.message
                : "Unable to confirm payment with Stripe.",
            );
            return;
          }

          const {
            result,
            clientSecret: confirmedClientSecret,
            error: payError,
          } = payResponse ?? {};
          const finalClientSecret =
            confirmedClientSecret || result?.client_secret;

          if (!finalClientSecret) {
            Alert.alert(
              "Payment setup failed",
              payError ||
                payResponse?.error ||
                "The Stripe confirmation step did not return a client secret.",
            );
            return;
          }

          try {
            await fetchAPI("/api/ride/create", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                origin_address: userAddress,
                destination_address: destinationAddress,
                origin_latitude: userLatitude,
                origin_longitude: userLongitude,
                destination_latitude: destinationLatitude,
                destination_longitude: destinationLongitude,
                ride_time: rideTime.toFixed(0),
                fare_price: parseInt(amount) * 100,
                payment_status: "paid",
                driver_id: driverId,
                user_id: userId,
              }),
            });
          } catch (error) {
            console.error("Failed to save ride record:", error);
            Alert.alert(
              "Ride booking issue",
              error instanceof Error
                ? error.message
                : "Payment succeeded, but we couldn't save your ride details. Please contact support.",
            );
          }

          intentCreationCallback({
            clientSecret: finalClientSecret,
          });
        },
      },
      returnURL: "myapp://book-ride",
    });

    if (!error) {
      // setLoading(true);
    }
  };

  return (
    <>
      <CustomButton
        title="Confirm Ride"
        className="my-10"
        onPress={openPaymentSheet}
      />

      <ReactNativeModal
        isVisible={success}
        onBackdropPress={() => setSuccess(false)}
      >
        <View className="flex flex-col items-center justify-center bg-white p-7 rounded-2xl">
          <Image source={images.check} className="w-28 h-28 mt-5" />

          <Text className="text-2xl text-center font-JakartaBold mt-5">
            Booking placed successfully
          </Text>

          <Text className="text-md text-general-200 font-JakartaRegular text-center mt-3">
            Thank you for your booking. Your reservation has been successfully
            placed. Please proceed with your trip.
          </Text>

          <CustomButton
            title="Back Home"
            onPress={() => {
              setSuccess(false);
              router.push("/(root)/(tabs)/home");
            }}
            className="mt-5"
          />
        </View>
      </ReactNativeModal>
    </>
  );
};

export default Payment;
