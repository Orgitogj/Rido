import { useAuth, useSession } from "@clerk/expo";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import ListState from "@/components/ListState";
import ScreenHeader from "@/components/ScreenHeader";
import { apiRequest } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { resetUserState } from "@/lib/session";
import { stopBackgroundTracking } from "@/lib/tracking";

import type { AccountDeletionResult, DeletionStatus } from "@/shared/account";

const DeleteAccount = () => {
  const { t, error: errorText } = useI18n();
  const { getToken, signOut } = useAuth();
  const { session } = useSession();
  const [state, setState] = useState<DeletionStatus | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [result, setResult] = useState<AccountDeletionResult | null>(null);

  const load = useCallback(
    async (fresh = false) => {
      setLoadError(null);
      try {
        const token = await getToken({ skipCache: fresh });
        setState(
          await apiRequest<DeletionStatus>("/api/account/deletion", { token }),
        );
      } catch (e) {
        setLoadError(e);
      }
    },
    [getToken],
  );

  useEffect(() => {
    load();
  }, [load]);

  const verify = async () => {
    if (!session || !password) return;
    setBusy("verify");
    setNote(null);
    try {
      await session.startVerification({ level: "first_factor" });
      const attempt = await session.attemptFirstFactorVerification({
        strategy: "password",
        password,
      });
      if (attempt.status !== "complete") throw new Error("incomplete");
      setPassword("");
      await load(true);
      setNote({ ok: true, text: t("deletion.verified") });
    } catch {
      setNote({ ok: false, text: t("deletion.verifyFailed") });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setNote(null);
    try {
      const token = await getToken({ skipCache: true });
      const outcome = await apiRequest<AccountDeletionResult>(
        "/api/account/deletion",
        { body: { confirm: "DELETE" }, token },
      );
      await stopBackgroundTracking().catch(() => {});
      resetUserState();
      setResult(outcome);
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
      await load(true);
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    await signOut().catch(() => {});
    router.replace("/(auth)/welcome");
  };

  if (result) {
    return (
      <SafeAreaView className="flex-1 bg-general-500">
        <View className="px-5 mt-10">
          <Text className="text-2xl font-JakartaExtraBold">
            {t("deletion.done")}
          </Text>
          {result.status === "pending" && (
            <Text className="text-base text-general-200 mt-3">
              {t("deletion.pending")}
            </Text>
          )}
          <CustomButton
            title={t("common.done")}
            className="mt-6"
            onPress={leave}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title={t("deletion.title")} />
        <View className="bg-white rounded-2xl p-5 mb-4">
          <Text className="text-base">{t("deletion.intro")}</Text>
          <Text className="text-sm text-general-200 mt-2">
            {t("deletion.driverNote")}
          </Text>
          <Text className="text-base font-JakartaBold mt-4">
            {t("deletion.retainedTitle")}
          </Text>
          <Text className="text-sm text-general-200 mt-1">
            {t("deletion.retained")}
          </Text>
        </View>

        {!state && !loadError && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {!state && loadError !== null && (
          <ListState
            kind="error"
            message={errorText(loadError, t("deletion.loadFailed"))}
            onRetry={() => load()}
          />
        )}

        {state && state.blockers.length > 0 && (
          <View className="bg-white rounded-2xl p-5 mb-4">
            <Text className="text-base font-JakartaBold">
              {t("deletion.blockedTitle")}
            </Text>
            {state.blockers.map((b) => (
              <Text key={b} className="text-sm mt-2">
                • {t(`deletion.blocker.${b}`)}
              </Text>
            ))}
            <CustomButton
              title={t("common.refresh")}
              bgVariant="outline"
              textVariant="primary"
              className="mt-4"
              onPress={() => load()}
            />
          </View>
        )}

        {state && state.blockers.length === 0 && state.reauthRequired && (
          <View className="bg-white rounded-2xl p-5 mb-4">
            <Text className="text-base font-JakartaBold">
              {t("deletion.confirmIdentity")}
            </Text>
            <Text className="text-sm text-general-200 mt-1">
              {t("deletion.passwordPrompt")}
            </Text>
            <InputField
              label={t("deletion.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              containerStyle="w-full"
              inputStyle="p-3.5"
            />
            <CustomButton
              title={
                busy === "verify" ? t("common.loading") : t("deletion.verify")
              }
              disabled={busy !== null || !password}
              className="mt-2"
              onPress={verify}
            />
          </View>
        )}

        {state && state.blockers.length === 0 && !state.reauthRequired && (
          <View className="bg-white rounded-2xl p-5 mb-4">
            <Text className="text-base font-JakartaBold">
              {t("deletion.cannotUndo")}
            </Text>
            <InputField
              label={t("deletion.typeDelete")}
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              containerStyle="w-full"
              inputStyle="p-3.5"
            />
            <CustomButton
              title={
                busy === "delete"
                  ? t("deletion.deleting")
                  : t("deletion.deleteNow")
              }
              bgVariant="danger"
              disabled={busy !== null || confirmText.trim() !== "DELETE"}
              className="mt-2"
              onPress={remove}
            />
          </View>
        )}

        {note && (
          <Text
            className={`text-sm ${note.ok ? "text-green-700" : "text-red-500"}`}
            accessibilityLiveRegion="polite"
          >
            {note.text}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default DeleteAccount;
