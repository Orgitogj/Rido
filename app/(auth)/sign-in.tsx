import { useSignIn } from "@clerk/expo";
import { Link, router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Image, ScrollView, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import { icons, images } from "@/constants";
import { chatRideId, usePendingRoute } from "@/lib/notificationRouting";

const SignIn = () => {
  const { signIn, errors, fetchStatus } = useSignIn();

  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const onSignInPress = useCallback(async () => {
    if (!signIn) return;

    if (!form.email.trim() || !form.password.trim()) {
      Alert.alert("Error", "Please enter your email and password.");
      return;
    }

    try {
      await signIn.create({ identifier: form.email.trim() });
      const { error } = await signIn.password({ password: form.password });

      if (error) {
        Alert.alert("Error", error.message || "Invalid email or password.");
        return;
      }

      if (signIn.status === "complete") {
        const pending = usePendingRoute.getState().take();
        const deferred = pending !== null && chatRideId(pending) !== null;
        if (deferred) usePendingRoute.getState().remember(pending);
        await signIn.finalize({
          navigate: () =>
            router.replace(
              (pending && !deferred ? pending : "/(root)/(tabs)/home") as never,
            ),
        });
        return;
      }

      Alert.alert("Error", "Log in failed. Please try again.");
    } catch (err: any) {
      const message =
        err?.errors?.[0]?.longMessage || "Unable to sign in right now.";
      Alert.alert("Error", message);
    }
  }, [signIn, form.email, form.password]);

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="flex-1 bg-white">
        <View className="relative w-full h-[250px]">
          <Image source={images.signUpCar} className="z-0 w-full h-[250px]" />
          <Text className="text-2xl text-black font-JakartaSemiBold absolute bottom-5 left-5">
            Welcome
          </Text>
        </View>

        <View className="p-5">
          <InputField
            label="Email"
            placeholder="Enter email"
            icon={icons.email}
            textContentType="emailAddress"
            value={form.email}
            onChangeText={(value) => setForm({ ...form, email: value })}
          />

          <InputField
            label="Password"
            placeholder="Enter password"
            icon={icons.lock}
            secureTextEntry={true}
            textContentType="password"
            value={form.password}
            onChangeText={(value) => setForm({ ...form, password: value })}
          />

          {errors?.fields?.identifier && (
            <Text className="text-red-500 text-sm mt-1">
              {errors.fields.identifier.message}
            </Text>
          )}

          <CustomButton
            title={fetchStatus === "fetching" ? "Signing In..." : "Sign In"}
            onPress={onSignInPress}
            className="mt-6"
          />

          <Link
            href="/(auth)/sign-up"
            className="text-lg text-center text-general-200 mt-10"
          >
            Don't have an account?{" "}
            <Text className="text-primary-500">Sign Up</Text>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
};

export default SignIn;
