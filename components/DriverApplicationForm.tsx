import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
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
      setError(
        "Please fill in every required field. Colour uses letters only; plates use letters, numbers, spaces, or dashes; seats 1–8; year is optional.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
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
        {initial
          ? "Update your details. Changes are saved as a draft until you submit."
          : "Apply to drive. Save your details, upload your documents, then submit. An operator reviews every application before you can go online."}
      </Text>
      {field("displayName", "Name shown to passengers")}
      {field("vehicleMake", "Vehicle make")}
      {field("vehicleModel", "Vehicle model")}
      {field("vehicleColor", "Vehicle colour")}
      {field("vehicleYear", "Model year (optional)", {
        keyboardType: "number-pad",
      })}
      {field("vehiclePlate", "Plate", { autoCapitalize: "characters" })}
      {field("vehicleSeats", "Passenger seats", { keyboardType: "number-pad" })}
      {error && <Text className="text-sm text-red-500 mt-2">{error}</Text>}
      <CustomButton
        title={busy ? "Saving…" : "Save details"}
        disabled={busy}
        className="mt-5"
        onPress={submit}
      />
      {onCancel && (
        <CustomButton
          title="Cancel"
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
