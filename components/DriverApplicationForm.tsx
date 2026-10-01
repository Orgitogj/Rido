import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import { useI18n } from "@/lib/i18n";
import { driverApplicationSchema } from "@/shared/contracts";

import type { DriverApplication, DriverProfileView } from "@/shared/contracts";

const DriverApplicationForm = ({
  defaultName,
  initial,
  onSubmit,
  onCancel,
}: {
  defaultName: string;
  initial?: DriverProfileView | null;
  onSubmit: (application: DriverApplication) => Promise<void>;
  onCancel?: () => void;
}) => {
  const { t, error: errorText } = useI18n();
  const [form, setForm] = useState({
    displayName: initial?.displayName ?? defaultName,
    vehicleMake: initial?.vehicleMake ?? "",
    vehicleModel: initial?.vehicleModel ?? "",
    vehicleColor: initial?.vehicleColor ?? "",
    vehicleYear: initial?.vehicleYear ? String(initial.vehicleYear) : "",
    vehiclePlate: initial?.vehiclePlate ?? "",
    vehicleSeats: String(initial?.vehicleSeats ?? 4),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = driverApplicationSchema.safeParse({
      ...form,
      vehicleSeats: Number(form.vehicleSeats),
      vehicleYear: form.vehicleYear.trim() ? Number(form.vehicleYear) : null,
    });
    if (!parsed.success) {
      setError(t("driver.form.invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setError(errorText(e, t("driver.form.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, extra: object = {}) => (
    <InputField
      label={label}
      value={form[key]}
      onChangeText={(value) => setForm({ ...form, [key]: value })}
      containerStyle="w-full"
      inputStyle="p-3.5"
      {...extra}
    />
  );

  return (
    <View>
      <Text className="text-base text-general-200 mb-2">
        {initial ? t("driver.form.introEdit") : t("driver.form.introNew")}
      </Text>
      {field("displayName", t("driver.form.displayName"))}
      {field("vehicleMake", t("driver.form.make"))}
      {field("vehicleModel", t("driver.form.model"))}
      {field("vehicleColor", t("driver.form.color"))}
      {field("vehicleYear", t("driver.form.year"), {
        keyboardType: "number-pad",
      })}
      {field("vehiclePlate", t("driver.form.plate"), {
        autoCapitalize: "characters",
      })}
      {field("vehicleSeats", t("driver.form.seats"), {
        keyboardType: "number-pad",
      })}
      {error && (
        <Text
          className="text-sm text-red-600 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      <CustomButton
        title={busy ? t("common.saving") : t("driver.form.save")}
        disabled={busy}
        className="mt-5"
        onPress={submit}
      />
      {onCancel && (
        <CustomButton
          title={t("common.cancel")}
          bgVariant="outline"
          textVariant="primary"
          className="mt-3"
          onPress={onCancel}
        />
      )}
    </View>
  );
};

export default DriverApplicationForm;
