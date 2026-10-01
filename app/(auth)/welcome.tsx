import { router } from "expo-router";
import { useRef, useState } from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Swiper from "react-native-swiper";

import CustomButton from "@/components/CustomButton";
import { onboarding } from "@/constants";
import { type TKey, useI18n, useLanguage } from "@/lib/i18n";
import { languages } from "@/shared/account";

const SLIDES: { title: TKey; body: TKey }[] = [
  { title: "auth.slide1Title", body: "auth.slide1Body" },
  { title: "auth.slide2Title", body: "auth.slide2Body" },
  { title: "auth.slide3Title", body: "auth.slide3Body" },
];

const Welcome = () => {
  const swiperRef = useRef<Swiper>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { t, language } = useI18n();
  const setLanguage = useLanguage((s) => s.setLanguage);
  const isLastSlide = activeIndex === SLIDES.length - 1;

  return (
    <SafeAreaView className="flex h-full items-center justify-between bg-white">
      <View className="w-full flex flex-row justify-between items-center p-5">
        <View className="flex flex-row">
          {languages.map((code) => (
            <TouchableOpacity
              key={code}
              onPress={() => setLanguage(code)}
              accessibilityRole="button"
              accessibilityState={{ selected: language === code }}
              className="mr-4 min-h-[44px] justify-center"
            >
              <Text
                className={`text-md ${language === code ? "font-JakartaBold text-[#0286FF]" : "font-Jakarta text-neutral-600"}`}
              >
                {code === "en" ? t("common.english") : t("common.albanian")}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          onPress={() => router.replace("/(auth)/sign-up")}
          accessibilityRole="button"
          className="min-h-[44px] justify-center"
        >
          <Text className="text-black text-md font-JakartaBold">
            {t("auth.skip")}
          </Text>
        </TouchableOpacity>
      </View>

      <Swiper
        ref={swiperRef}
        loop={false}
        dot={
          <View className="w-[32px] h-[4px] mx-1 bg-[#E2E8F0] rounded-full" />
        }
        activeDot={
          <View className="w-[32px] h-[4px] mx-1 bg-[#0286FF] rounded-full" />
        }
        onIndexChanged={(index) => setActiveIndex(index)}
      >
        {SLIDES.map((slide, index) => (
          <View
            key={slide.title}
            className="flex items-center justify-center p-5"
          >
            <Image
              source={onboarding[index]?.image}
              className="w-full h-[300px]"
              resizeMode="contain"
            />
            <View className="flex flex-row items-center justify-center w-full mt-10">
              <Text className="text-black text-3xl font-bold mx-10 text-center">
                {t(slide.title)}
              </Text>
            </View>
            <Text className="text-md font-JakartaSemiBold text-center text-[#858585] mx-10 mt-3">
              {t(slide.body)}
            </Text>
          </View>
        ))}
      </Swiper>

      <CustomButton
        title={isLastSlide ? t("auth.getStarted") : t("auth.next")}
        onPress={() =>
          isLastSlide
            ? router.replace("/(auth)/sign-up")
            : swiperRef.current?.scrollBy(1)
        }
        className="w-11/12 mt-10 mb-5"
      />
    </SafeAreaView>
  );
};

export default Welcome;
