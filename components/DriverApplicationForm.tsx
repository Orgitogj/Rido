import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import { driverApplicationSchema } from "@/shared/contracts";

import type { DriverApplication } from "@/shared/contracts";

const DriverApplicationForm = ({
  defaultName,
  onSubmit,
}: {
  defaultName: string;
  onSubmit: (application: DriverApplication) => Promise<void>;
}) => {
  const [form, setForm] = useState({
    displayName: defaultName,
    vehicleMake: "",
    vehicleModel: "",
    vehiclePlate: "",
    vehicleSeats: "4",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = driverApplicationSchema.safeParse({
      ...form,
      vehicleSeats: Number(form.vehicleSeats),
    });
    if (!parsed.success) {
      setError(
        "Please fill in every field. Plates use letters, numbers, spaces, or dashes; seats 1–8.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't submit.");
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
        Apply to drive. An operator reviews every application before you can go
        online.
      </Text>
      {field("displayName", "Name shown to passengers")}
      {field("vehicleMake", "Vehicle make")}
      {field("vehicleModel", "Vehicle model")}
      {field("vehiclePlate", "Plate", { autoCapitalize: "characters" })}
      {field("vehicleSeats", "Passenger seats", { keyboardType: "number-pad" })}
      {error && <Text className="text-sm text-red-500 mt-2">{error}</Text>}
      <CustomButton
        title={busy ? "Submitting…" : "Submit application"}
        disabled={busy}
        className="mt-5"
        onPress={submit}
      />
    </View>
  );
};

export default DriverApplicationForm;
