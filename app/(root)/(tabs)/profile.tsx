import { useUser } from "@clerk/expo";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import ListState from "@/components/ListState";
import { useApi, useApiQuery } from "@/lib/fetch";
import { useI18n, useLanguage } from "@/lib/i18n";
import { useSignOut } from "@/lib/session";
import { type AccountProfile, languages } from "@/shared/account";

type Note = { ok: boolean; text: string } | null;

const Card = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <View className="bg-white rounded-2xl p-5 mb-4">
    <Text className="text-lg font-JakartaBold mb-1" accessibilityRole="header">
      {title}
    </Text>
    {children}
  </View>
);

const NoteText = ({ note }: { note: Note }) =>
  note ? (
    <Text
      className={`text-sm mt-2 ${note.ok ? "text-green-700" : "text-red-500"}`}
      accessibilityLiveRegion="polite"
    >
      {note.text}
    </Text>
  ) : null;

const LinkRow = ({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) => (
  <TouchableOpacity
    onPress={onPress}
    accessibilityRole="button"
    className="flex flex-row items-center justify-between min-h-[48px] border-t border-general-700"
  >
    <Text className="text-base font-JakartaMedium">{label}</Text>
    <Text className="text-lg text-general-200">›</Text>
  </TouchableOpacity>
);

const clerkMessage = (e: unknown) => {
  const first = (e as { errors?: { longMessage?: string; message?: string }[] })
    ?.errors?.[0];
  return first?.longMessage ?? first?.message ?? null;
};

const Profile = () => {
  const { user } = useUser();
  const { t, error: errorText, language } = useI18n();
  const setLanguage = useLanguage((s) => s.setLanguage);
  const request = useApi();
  const signOut = useSignOut();
  const account = useApiQuery<AccountProfile>("/api/me", {
    refetchOnFocus: true,
  });

  const [name, setName] = useState("");
  const [nameNote, setNameNote] = useState<Note>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [pendingEmailId, setPendingEmailId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [emailNote, setEmailNote] = useState<Note>(null);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordNote, setPasswordNote] = useState<Note>(null);

  const loadedName = account.data?.name ?? null;
  useEffect(() => {
    if (loadedName !== null) setName(loadedName);
  }, [loadedName]);

  const identityError = (e: unknown) =>
    language === "en"
      ? (clerkMessage(e) ?? t("account.identityFailed"))
      : t("account.identityFailed");

  const saveName = async () => {
    const value = name.trim();
    if (!value || value.length > 100) {
      setNameNote({ ok: false, text: t("account.nameInvalid") });
      return;
    }
    setBusy("name");
    setNameNote(null);
    try {
      await request("/api/me", { method: "PATCH", body: { name: value } });
      setNameNote({ ok: true, text: t("account.nameSaved") });
      account.refetch();
    } catch (e) {
      setNameNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const sendCode = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailNote({ ok: false, text: t("account.emailInvalid") });
      return;
    }
    if (!user) return;
    setBusy("email");
    setEmailNote(null);
    try {
      const created = await user.createEmailAddress({ email });
      await created.prepareVerification({ strategy: "email_code" });
      setPendingEmailId(created.id);
      setEmailNote({ ok: true, text: t("account.codeSentTo", { email }) });
    } catch (e) {
      setEmailNote({ ok: false, text: identityError(e) });
    } finally {
      setBusy(null);
    }
  };

  const verifyEmail = async () => {
    if (!user || !pendingEmailId) return;
    if (!code.trim()) {
      setEmailNote({ ok: false, text: t("account.codeInvalid") });
      return;
    }
    setBusy("email");
    setEmailNote(null);
    try {
      await user.reload();
      const address = user.emailAddresses.find((a) => a.id === pendingEmailId);
      if (!address) throw new Error("missing");
      const verified = await address.attemptVerification({ code: code.trim() });
      if (verified.verification.status !== "verified") {
        throw new Error("unverified");
      }
      const previous = user.primaryEmailAddressId;
      await user.update({ primaryEmailAddressId: pendingEmailId });
      if (previous && previous !== pendingEmailId) {
        await user.emailAddresses
          .find((a) => a.id === previous)
          ?.destroy()
          .catch(() => {});
      }
      await user.reload();
      setEmailNote({
        ok: true,
        text: t("account.emailChanged", { email: verified.emailAddress }),
      });
      setPendingEmailId(null);
      setEmailOpen(false);
      setNewEmail("");
      setCode("");
    } catch (e) {
      setEmailNote({ ok: false, text: identityError(e) });
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async () => {
    if (!user) return;
    if (newPassword.length < 8) {
      setPasswordNote({ ok: false, text: t("account.passwordTooShort") });
      return;
    }
    setBusy("password");
    setPasswordNote(null);
    try {
      await user.updatePassword({
        currentPassword,
        newPassword,
        signOutOfOtherSessions: true,
      });
      setPasswordNote({
        ok: true,
        text: `${t("account.passwordChanged")} ${t("account.signOutOthers")}`,
      });
      setCurrentPassword("");
      setNewPassword("");
      setPasswordOpen(false);
    } catch (e) {
      setPasswordNote({ ok: false, text: identityError(e) });
    } finally {
      setBusy(null);
    }
  };

  const doSignOut = async () => {
    setBusy("signout");
    try {
      await signOut();
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          className="text-2xl font-JakartaExtraBold my-5"
          accessibilityRole="header"
        >
          {t("account.title")}
        </Text>

        {account.status === "loading" && !account.data && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {account.status === "error" && !account.data && (
          <ListState
            kind="error"
            message={errorText(account.errorCode, t("account.loadFailed"))}
            onRetry={account.refetch}
          />
        )}

        {account.data && (
          <Card title={t("account.details")}>
            <InputField
              label={t("account.name")}
              value={name}
              onChangeText={setName}
              maxLength={100}
              placeholder={t("account.noName")}
              containerStyle="w-full"
              inputStyle="p-3.5"
            />
            <Text className="text-xs text-general-200">
              {t("account.nameHint")}
            </Text>
            <CustomButton
              title={busy === "name" ? t("common.saving") : t("common.save")}
              disabled={busy !== null || name.trim() === (loadedName ?? "")}
              className="mt-3"
              onPress={saveName}
            />
            <NoteText note={nameNote} />
          </Card>
        )}

        <Card title={t("account.email")}>
          <Text className="text-base" selectable>
            {user?.primaryEmailAddress?.emailAddress ?? t("account.notSet")}
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {t("account.emailManaged")}
          </Text>
          {!emailOpen ? (
            <CustomButton
              title={t("account.changeEmail")}
              bgVariant="outline"
              textVariant="primary"
              className="mt-3"
              onPress={() => {
                setEmailOpen(true);
                setEmailNote(null);
              }}
            />
          ) : (
            <View>
              <InputField
                label={t("account.newEmail")}
                value={newEmail}
                onChangeText={setNewEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
                editable={!pendingEmailId}
                containerStyle="w-full"
                inputStyle="p-3.5"
              />
              {pendingEmailId && (
                <InputField
                  label={t("account.verificationCode")}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  containerStyle="w-full"
                  inputStyle="p-3.5"
                />
              )}
              <CustomButton
                title={
                  busy === "email"
                    ? t("common.loading")
                    : pendingEmailId
                      ? t("account.verifyEmail")
                      : t("account.sendCode")
                }
                disabled={busy !== null}
                className="mt-2"
                onPress={pendingEmailId ? verifyEmail : sendCode}
              />
              <CustomButton
                title={t("common.cancel")}
                bgVariant="outline"
                textVariant="primary"
                className="mt-3"
                onPress={() => {
                  setEmailOpen(false);
                  setPendingEmailId(null);
                  setCode("");
                }}
              />
            </View>
          )}
          <NoteText note={emailNote} />
        </Card>

        <Card title={t("account.password")}>
          {!passwordOpen ? (
            <CustomButton
              title={t("account.changePassword")}
              bgVariant="outline"
              textVariant="primary"
              className="mt-2"
              onPress={() => {
                setPasswordOpen(true);
                setPasswordNote(null);
              }}
            />
          ) : (
            <View>
              <InputField
                label={t("account.currentPassword")}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                textContentType="password"
                containerStyle="w-full"
                inputStyle="p-3.5"
              />
              <InputField
                label={t("account.newPassword")}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                textContentType="newPassword"
                containerStyle="w-full"
                inputStyle="p-3.5"
              />
              <Text className="text-xs text-general-200">
                {t("account.passwordHint")}
              </Text>
              <CustomButton
                title={
                  busy === "password"
                    ? t("common.saving")
                    : t("account.changePassword")
                }
                disabled={busy !== null}
                className="mt-3"
                onPress={changePassword}
              />
              <CustomButton
                title={t("common.cancel")}
                bgVariant="outline"
                textVariant="primary"
                className="mt-3"
                onPress={() => setPasswordOpen(false)}
              />
            </View>
          )}
          <NoteText note={passwordNote} />
        </Card>

        <Card title={t("common.language")}>
          <View className="flex flex-row mt-2 gap-x-3">
            {languages.map((code) => (
              <CustomButton
                key={code}
                title={
                  code === "en" ? t("common.english") : t("common.albanian")
                }
                bgVariant={language === code ? "primary" : "outline"}
                textVariant={language === code ? "default" : "primary"}
                className="flex-1 w-auto"
                accessibilityState={{ selected: language === code }}
                onPress={() => setLanguage(code)}
              />
            ))}
          </View>
          <Text className="text-xs text-general-200 mt-2">
            {t("account.languageHint")}
          </Text>
        </Card>

        <View className="bg-white rounded-2xl px-5 mb-4">
          <LinkRow
            label={t("account.savedPlaces")}
            onPress={() => router.push("/(root)/places")}
          />
          <LinkRow
            label={t("account.notifications")}
            onPress={() => router.push("/(root)/notifications")}
          />
          <LinkRow
            label={t("account.support")}
            onPress={() => router.push("/(root)/support")}
          />
        </View>

        <Card title={t("account.driverSection")}>
          <Text className="text-sm text-general-200">
            {t("account.driverSeparate")}
          </Text>
          <CustomButton
            title={
              account.data?.driver
                ? t("account.openDrive")
                : t("account.becomeDriver")
            }
            bgVariant="outline"
            textVariant="primary"
            className="mt-3"
            onPress={() => router.push("/(root)/driver")}
          />
        </Card>

        <CustomButton
          title={
            busy === "signout" ? t("account.signingOut") : t("account.signOut")
          }
          bgVariant="outline"
          textVariant="primary"
          disabled={busy !== null}
          onPress={doSignOut}
        />
        <CustomButton
          title={t("deletion.link")}
          bgVariant="outline"
          textVariant="danger"
          className="mt-4"
          onPress={() => router.push("/(root)/delete-account")}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

export default Profile;
