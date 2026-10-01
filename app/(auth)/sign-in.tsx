import { useSignIn } from "@clerk/expo";
import { Link, router } from "expo-router";
import { useCallback, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import { icons, images } from "@/constants";
import { useI18n } from "@/lib/i18n";
import { chatRideId, usePendingRoute } from "@/lib/notificationRouting";

const SignIn = () => {
  const { signIn, fetchStatus } = useSignIn();
  const { t, language } = useI18n();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  const onSignInPress = useCallback(async () => {
    if (!signIn || fetchStatus === "fetching") return;
    if (!form.email.trim() || !form.password) {
      setError(t("auth.missingCredentials"));
      return;
    }
    setError(null);
    const failed = (message?: string | null) =>
      setError(language === "en" && message ? message : t("auth.signInFailed"));
    try {
      await signIn.create({ identifier: form.email.trim() });
      const { error: failure } = await signIn.password({
        password: form.password,
      });
      if (failure) {
        failed(failure.message);
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
      failed();
    } catch (err) {
      failed(
        (err as { errors?: { longMessage?: string }[] })?.errors?.[0]
          ?.longMessage,
      );
    }
  }, [signIn, fetchStatus, form.email, form.password, t, language]);

  return (
    <ScrollView className="flex-1 bg-white" keyboardShouldPersistTaps="handled">
      <View className="flex-1 bg-white">
        <View className="relative w-full h-[250px]">
          <Image source={images.signUpCar} className="z-0 w-full h-[250px]" />
          <Text
            className="text-2xl text-black font-JakartaSemiBold absolute bottom-5 left-5"
            accessibilityRole="header"
          >
            {t("auth.welcomeBack")}
          </Text>
        </View>

        <View className="p-5">
          <InputField
            label={t("auth.email")}
            placeholder={t("auth.emailPlaceholder")}
            icon={icons.email}
            textContentType="emailAddress"
            keyboardType="email-address"
            autoCapitalize="none"
            value={form.email}
            onChangeText={(value) => setForm({ ...form, email: value })}
          />

          <InputField
            label={t("auth.password")}
            placeholder={t("auth.passwordPlaceholder")}
            icon={icons.lock}
            secureTextEntry={true}
            textContentType="password"
            value={form.password}
            onChangeText={(value) => setForm({ ...form, password: value })}
          />

          {error && (
            <Text
              className="text-red-500 text-sm mt-1"
              accessibilityLiveRegion="polite"
            >
              {error}
            </Text>
          )}

          <CustomButton
            title={
              fetchStatus === "fetching"
                ? t("auth.signingIn")
                : t("auth.signIn")
            }
            disabled={fetchStatus === "fetching"}
            onPress={onSignInPress}
            className="mt-6"
          />

          <Link
            href="/(auth)/reset-password"
            className="text-base text-center text-primary-500 mt-6"
          >
            {t("auth.forgotPassword")}
          </Link>

          <Link
            href="/(auth)/sign-up"
            className="text-lg text-center text-general-200 mt-8"
          >
            {t("auth.noAccount")}{" "}
            <Text className="text-primary-500">{t("auth.signUp")}</Text>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
};

export default SignIn;
