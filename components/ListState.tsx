import { ActivityIndicator, Image, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { images } from "@/constants";
import { useI18n } from "@/lib/i18n";

type Props =
  | { kind: "loading"; message: string }
  | { kind: "empty"; message: string; onRetry?: () => void }
  | { kind: "error"; message: string; onRetry: () => void };

const ListState = (props: Props) => {
  const { t } = useI18n();
  if (props.kind === "loading") {
    return (
      <View className="flex flex-col items-center justify-center py-10">
        <ActivityIndicator size="small" color="#000" />
        <Text
          className="text-sm text-general-800 mt-3"
          accessibilityLiveRegion="polite"
        >
          {props.message}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex flex-col items-center justify-center py-5 px-5">
      {props.kind === "empty" && (
        <Image
          source={images.noResult}
          className="w-40 h-40"
          accessible={false}
          resizeMode="contain"
        />
      )}
      <Text
        className={`text-sm text-center ${props.kind === "error" ? "text-red-600" : ""}`}
        accessibilityLiveRegion="polite"
      >
        {props.message}
      </Text>
      {props.onRetry && (
        <CustomButton
          title={t("common.retry")}
          bgVariant="outline"
          textVariant="primary"
          className="mt-4 w-40"
          onPress={props.onRetry}
        />
      )}
    </View>
  );
};

export default ListState;
