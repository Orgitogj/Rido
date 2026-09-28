import { useState } from "react";
import { Image, Text, View } from "react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";

import { icons } from "@/constants";
import { GoogleInputProps } from "@/types/type";

const googlePlacesApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_API_KEY ||
  process.env.EXPO_PUBLIC_PLACES_API_KEY;

const GoogleTextInput = ({
  icon,
  initialLocation,
  containerStyle,
  textInputBackgroundColor,
  handlePress,
}: GoogleInputProps) => {
  const [error, setError] = useState<string | null>(
    googlePlacesApiKey
      ? null
      : "Address search needs a Google Places API key (see README).",
  );

  return (
    <View className="relative z-50">
      <View
        className={`flex flex-row items-center justify-center rounded-xl ${containerStyle}`}
      >
        <GooglePlacesAutocomplete
          fetchDetails={true}
          placeholder="Search"
          minLength={2}
          debounce={200}
          styles={{
            textInputContainer: {
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 20,
              marginHorizontal: 20,
              position: "relative",
              shadowColor: "#d4d4d4",
            },
            textInput: {
              backgroundColor: textInputBackgroundColor
                ? textInputBackgroundColor
                : "white",
              fontSize: 16,
              fontWeight: "600",
              marginTop: 5,
              width: "100%",
              borderRadius: 200,
            },
            listView: {
              backgroundColor: textInputBackgroundColor
                ? textInputBackgroundColor
                : "white",
              position: "absolute",
              top: 65,
              left: 20,
              right: 20,
              borderRadius: 10,
              shadowColor: "#d4d4d4",
              zIndex: 999,
            },
          }}
          onPress={(data, details = null) => {
            const lat = details?.geometry?.location?.lat;
            const lng = details?.geometry?.location?.lng;
            if (typeof lat !== "number" || typeof lng !== "number") {
              setError(
                "We couldn't find coordinates for that place. Try another result.",
              );
              return;
            }
            setError(null);
            handlePress({
              latitude: lat,
              longitude: lng,
              address: data.description,
            });
          }}
          query={{
            key: googlePlacesApiKey,
            language: "en",
          }}
          GooglePlacesDetailsQuery={{
            fields: "formatted_address,geometry",
          }}
          nearbyPlacesAPI="GooglePlacesSearch"
          listViewDisplayed="auto"
          enablePoweredByContainer={false}
          requestUrl={{
            url: "https://maps.googleapis.com/maps/api",
            useOnPlatform: "all",
          }}
          onFail={() =>
            setError(
              "Address search failed. Check your connection and try again.",
            )
          }
          onNotFound={() => setError("No matching places found.")}
          onTimeout={() =>
            setError("Address search timed out. Please try again.")
          }
          renderLeftButton={() => (
            <View className="justify-center items-center w-6 h-6">
              <Image
                source={icon ? icon : icons.search}
                className="w-6 h-6"
                resizeMode="contain"
              />
            </View>
          )}
          textInputProps={{
            placeholderTextColor: "gray",
            placeholder: initialLocation ?? "Where do you want to go?",
            onChangeText: () =>
              setError((current) => (googlePlacesApiKey ? null : current)),
          }}
        />
      </View>
      {error && (
        <Text
          className="text-xs text-red-500 mt-1 mx-5"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
    </View>
  );
};

export default GoogleTextInput;
