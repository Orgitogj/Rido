import { Text, View } from "react-native";

const WebOnly = () => (
  <View className="flex-1 items-center justify-center p-8 bg-white">
    <Text className="text-lg font-JakartaBold text-center">
      The operations console is only available on the web.
    </Text>
  </View>
);

export default WebOnly;
