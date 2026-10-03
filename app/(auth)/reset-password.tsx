import { useSignIn } from "@clerk/expo";
import { Link, router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import { icons } from "@/constants";
import { clerkErrorKey } from "@/lib/clerkErrors";
import { useI18n } from "@/lib/i18n";

type Step = "email" | "code";

const ResetPassword = () => {
  const { signIn, fetchStatus } = useSignIn();
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = fetchStatus === "fetching";

  const failure = (problem?: unknown) =>
    setNote({
      ok: false,
      text: t(clerkErrorKey(problem) ?? "auth.resetFailed"),
    });

  const sendCode = async () => {
    const address = email.trim().toLowerCase();
    if (!signIn || busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setNote({ ok: false, text: t("account.emailInvalid") });
      return;
    }
    setNote(null);
    try {
      await signIn.create({ identifier: address });
      await signIn.resetPasswordEmailCode.sendCode();
    } catch {
      setNote(null);
    }
    setStep("code");
    setNote({ ok: true, text: t("auth.resetCodeSent", { email: address }) });
  };

  const submit = async () => {
    if (!signIn || busy) return;
    if (!code.trim()) {
      setNote({ ok: false, text: t("account.codeInvalid") });
      return;
    }
    if (password.length < 8) {
      setNote({ ok: false, text: t("account.passwordTooShort") });
      return;
    }
    setNote(null);
    try {
      const verified = await signIn.resetPasswordEmailCode.verifyCode({
        code: code.trim(),
      });
      if (verified.error) {
        failure(verified.error);
        return;
      }
      const changed = await signIn.resetPasswordEmailCode.submitPassword({
        password,
        signOutOfOtherSessions: true,
      });
      if (changed.error) {
        failure(changed.error);
        return;
      }
      if (signIn.status === "complete") {
        await signIn.finalize({
          navigate: () => router.replace("/(root)/(tabs)/home"),
        });
        return;
      }
      failure();
    } catch (err) {
      failure(err);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="p-5" keyboardShouldPersistTaps="handled">
        <Text
          className="text-2xl font-JakartaExtraBold mt-5"
          accessibilityRole="header"
        >
          {t("auth.resetTitle")}
        </Text>
        <Text className="text-base text-general-200 mt-2">
          {t("auth.resetIntro")}
        </Text>

        <InputField
          label={t("auth.email")}
          placeholder={t("auth.emailPlaceholder")}
          icon={icons.email}
          textContentType="emailAddress"
          keyboardType="email-address"
          autoCapitalize="none"
          editable={step === "email"}
          value={email}
          onChangeText={setEmail}
        />

        {step === "code" && (
          <View>
            <InputField
              label={t("auth.code")}
              icon={icons.lock}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              value={code}
              onChangeText={setCode}
            />
            <InputField
              label={t("auth.newPassword")}
              icon={icons.lock}
              secureTextEntry
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
            />
            <Text className="text-xs text-general-200">
              {t("auth.newPasswordHint")}
            </Text>
          </View>
        )}

        {note && (
          <Text
            className={`text-sm mt-3 ${note.ok ? "text-green-700" : "text-red-500"}`}
            accessibilityLiveRegion="polite"
          >
            {note.text}
          </Text>
        )}

        <CustomButton
          title={
            busy
              ? t("common.loading")
              : step === "email"
                ? t("auth.sendResetCode")
                : t("auth.setPassword")
          }
          disabled={busy}
          className="mt-6"
          onPress={step === "email" ? sendCode : submit}
        />

        <Link
          href="/(auth)/sign-in"
          className="text-base text-center text-primary-500 mt-8"
        >
          {t("auth.backToSignIn")}
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ResetPassword;
