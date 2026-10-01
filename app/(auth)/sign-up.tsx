import { useAuth, useSignUp } from "@clerk/expo";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { ReactNativeModal } from "react-native-modal";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import { icons, images } from "@/constants";
import { apiRequest } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";

const clerkMessage = (err: unknown) =>
  (err as { errors?: { longMessage?: string }[] })?.errors?.[0]?.longMessage;

const SignUp = () => {
  const { signUp, fetchStatus } = useSignUp();
  const { getToken } = useAuth();
  const { t, language } = useI18n();
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [verification, setVerification] = useState({
    state: "default",
    error: "",
    code: "",
  });
  const busy = fetchStatus === "fetching";

  const text = (message: string | null | undefined, fallback: string) =>
    language === "en" && message ? message : fallback;

  const onSignUpPress = async () => {
    if (!signUp || busy) return;
    if (!form.email.trim() || !form.password) {
      setFormError(t("auth.missingCredentials"));
      return;
    }
    setFormError(null);
    try {
      const { error } = await signUp.password({
        emailAddress: form.email.trim(),
        password: form.password,
      });
      if (error) {
        setFormError(text(error.message, t("auth.signUpFailed")));
        return;
      }
      await signUp.verifications.sendEmailCode();
      setVerification({ ...verification, state: "pending", error: "" });
    } catch (err) {
      setFormError(text(clerkMessage(err), t("auth.signUpFailed")));
    }
  };

  const onPressVerify = async () => {
    if (!signUp || busy) return;
    const fail = (message?: string | null) =>
      setVerification({
        ...verification,
        error: text(message, t("auth.verificationFailed")),
        state: "failed",
      });
    try {
      const { error } = await signUp.verifications.verifyEmailCode({
        code: verification.code.trim(),
      });
      if (error) {
        fail(error.message);
        return;
      }
      if (signUp.status !== "complete") {
        fail();
        return;
      }
      await signUp.finalize({
        navigate: () => {
          setVerification({ ...verification, state: "success" });
        },
      });
      const name = form.name.trim();
      if (name) {
        getToken()
          .then((token) =>
            token
              ? apiRequest("/api/user", { body: { name }, token })
              : undefined,
          )
          .catch(() => {});
      }
    } catch (err) {
      fail(clerkMessage(err));
    }
  };

  return (
    <ScrollView className="flex-1 bg-white" keyboardShouldPersistTaps="handled">
      <View className="flex-1 bg-white">
        <View className="relative w-full h-[250px]">
          <Image source={images.signUpCar} className="z-0 w-full h-[250px]" />
          <Text
            className="text-2xl text-black font-JakartaSemiBold absolute bottom-5 left-5"
            accessibilityRole="header"
          >
            {t("auth.createAccount")}
          </Text>
        </View>

        <View className="p-5">
          <InputField
            label={t("auth.name")}
            placeholder={t("auth.namePlaceholder")}
            icon={icons.person}
            maxLength={100}
            value={form.name}
            onChangeText={(value) => setForm({ ...form, name: value })}
          />

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
            textContentType="newPassword"
            value={form.password}
            onChangeText={(value) => setForm({ ...form, password: value })}
          />

          {formError && (
            <Text
              className="text-red-500 text-sm mt-1"
              accessibilityLiveRegion="polite"
            >
              {formError}
            </Text>
          )}

          <CustomButton
            title={busy ? t("auth.signingUp") : t("auth.signUp")}
            disabled={busy}
            onPress={onSignUpPress}
            className="mt-6"
          />

          <View nativeID="clerk-captcha" />

          <Link
            href="/(auth)/sign-in"
            className="text-lg text-center text-general-200 mt-10"
          >
            {t("auth.haveAccount")}{" "}
            <Text className="text-primary-500">{t("auth.signIn")}</Text>
          </Link>
        </View>

        <ReactNativeModal
          isVisible={
            verification.state === "pending" || verification.state === "failed"
          }
          onModalHide={() => {
            if (verification.state === "success") {
              setShowSuccessModal(true);
            }
          }}
        >
          <View className="bg-white px-7 py-9 rounded-2xl min-h-[300px]">
            <Text className="font-JakartaExtraBold text-2xl mb-2">
              {t("auth.verification")}
            </Text>
            <Text className="font-Jakarta mb-5">
              {t("auth.verificationSent", { email: form.email.trim() })}
            </Text>

            <InputField
              label={t("auth.code")}
              icon={icons.lock}
              placeholder="123456"
              value={verification.code}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              onChangeText={(code) =>
                setVerification({ ...verification, code })
              }
            />

            {verification.error ? (
              <Text
                className="text-red-500 text-sm mt-1"
                accessibilityLiveRegion="polite"
              >
                {verification.error}
              </Text>
            ) : null}

            <CustomButton
              title={busy ? t("common.loading") : t("auth.verifyEmail")}
              disabled={busy}
              onPress={onPressVerify}
              className="mt-5 bg-success-500"
            />
          </View>
        </ReactNativeModal>

        <ReactNativeModal isVisible={showSuccessModal}>
          <View className="bg-white px-7 py-9 rounded-2xl min-h-[300px]">
            <Image
              source={images.check}
              className="w-[110px] h-[110px] mx-auto my-5"
            />
            <Text className="text-3xl font-JakartaBold text-center">
              {t("auth.verified")}
            </Text>
            <Text className="text-base text-gray-400 font-Jakarta text-center mt-2">
              {t("auth.verifiedBody")}
            </Text>

            <CustomButton
              title={t("auth.goHome")}
              onPress={() => {
                setShowSuccessModal(false);
                router.replace("/(root)/(tabs)/home");
              }}
              className="mt-5"
            />
          </View>
        </ReactNativeModal>
      </View>
    </ScrollView>
  );
};

export default SignUp;
