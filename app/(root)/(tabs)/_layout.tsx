import { Tabs } from "expo-router";
import { Image, ImageSourcePropType, View } from "react-native";

import { icons } from "@/constants";
import { useI18n } from "@/lib/i18n";

const TabIcon = ({
  source,
  focused,
}: {
  source: ImageSourcePropType;
  focused: boolean;
}) => (
  <View
    className={`w-14 h-14 items-center justify-center ${
      focused ? "bg-general-300 rounded-full" : ""
    }`}
  >
    <View
      className={`w-12 h-12 items-center justify-center ${
        focused ? "bg-general-400 rounded-full" : ""
      }`}
    >
      <Image
        source={source}
        resizeMode="contain"
        tintColor="white"
        className="w-7 h-7"
      />
    </View>
  </View>
);
export default function Layout() {
  const { t } = useI18n();
  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        tabBarActiveTintColor: "white",
        tabBarInactiveTintColor: "white",
        tabBarShowLabel: false,
        tabBarItemStyle: {
          justifyContent: "center",
          alignItems: "center",
        },
        tabBarStyle: {
          backgroundColor: "#333333",
          borderRadius: 50,
          paddingBottom: 30,
          overflow: "hidden",
          marginHorizontal: 20,
          marginBottom: 20,
          height: 78,
          borderTopWidth: 0,
          elevation: 0,
          shadowOpacity: 0,
          shadowColor: "transparent",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexDirection: "row",
          position: "absolute",
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("booking.tabs.home"),
          tabBarAccessibilityLabel: t("booking.tabs.home"),
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon source={icons.home} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: t("booking.tabs.rides"),
          tabBarAccessibilityLabel: t("booking.tabs.rides"),
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon source={icons.list} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t("booking.tabs.chat"),
          tabBarAccessibilityLabel: t("booking.tabs.chat"),
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon source={icons.chat} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("booking.tabs.profile"),
          tabBarAccessibilityLabel: t("booking.tabs.profile"),
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon source={icons.profile} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
