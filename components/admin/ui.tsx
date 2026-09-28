import { Pressable, Text, TextInput, View } from "react-native";

export const Section = ({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <View className="bg-white rounded-2xl p-5 mt-4 border border-neutral-200">
    <View className="flex flex-row items-center justify-between mb-3">
      <Text className="text-lg font-JakartaBold">{title}</Text>
      {right}
    </View>
    {children}
  </View>
);

export const KeyValue = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <View className="flex flex-row py-1.5 border-b border-neutral-100">
    <Text className="w-48 text-sm text-general-200">{label}</Text>
    <Text className="flex-1 text-sm font-JakartaMedium" selectable>
      {value}
    </Text>
  </View>
);

export const Chip = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    className={`px-3 py-1.5 rounded-full mr-2 mb-2 border ${active ? "bg-[#0286FF] border-[#0286FF]" : "bg-white border-neutral-300"}`}
  >
    <Text className={`text-xs ${active ? "text-white" : "text-neutral-700"}`}>
      {label}
    </Text>
  </Pressable>
);

export const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  width = "w-56",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  width?: string;
}) => (
  <View className={`mr-3 mb-2 ${multiline ? "w-full" : width}`}>
    <Text className="text-xs text-general-200 mb-1">{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      multiline={multiline}
      accessibilityLabel={label}
      className={`border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white ${multiline ? "min-h-[80px]" : ""}`}
    />
  </View>
);

export const ActionButton = ({
  title,
  onPress,
  disabled,
  tone = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "danger" | "neutral";
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityState={{ disabled: !!disabled }}
    className={`px-4 py-2 rounded-lg mr-2 mb-2 ${disabled ? "opacity-40" : ""} ${tone === "danger" ? "bg-red-600" : tone === "neutral" ? "bg-neutral-200" : "bg-[#0286FF]"}`}
  >
    <Text
      className={`text-sm font-JakartaSemiBold ${tone === "neutral" ? "text-neutral-800" : "text-white"}`}
    >
      {title}
    </Text>
  </Pressable>
);

export const ListRow = ({
  onPress,
  children,
}: {
  onPress: () => void;
  children: React.ReactNode;
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="link"
    className="py-3 border-b border-neutral-100 hover:bg-neutral-50"
  >
    {children}
  </Pressable>
);

export const Notice = ({
  tone,
  text,
}: {
  tone: "error" | "info" | "warning" | "success";
  text: string;
}) => (
  <View
    className={`rounded-lg px-3 py-2 mt-2 ${tone === "error" ? "bg-red-50" : tone === "warning" ? "bg-orange-50" : tone === "success" ? "bg-green-50" : "bg-blue-50"}`}
  >
    <Text
      className={`text-sm ${tone === "error" ? "text-red-700" : tone === "warning" ? "text-orange-700" : tone === "success" ? "text-green-700" : "text-blue-700"}`}
      accessibilityLiveRegion="polite"
    >
      {text}
    </Text>
  </View>
);

export const shortId = (id: string) => id.slice(0, 8);

export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : "—";
