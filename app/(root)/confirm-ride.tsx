import { router } from "expo-router";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import CustomButton from "@/components/CustomButton";
import DriverCard from "@/components/DriverCard";
import RideLayout from "@/components/RideLayout";
import { useDriverStore } from "@/store";

const ConfirmRide = () => {
  const { drivers, selectedDriver, setSelectedDriver } = useDriverStore();

  return (
    <RideLayout title={"Choose a Rider"} snapPoints={["65%", "85%"]}>
      <FlatList
        data={drivers}
        keyExtractor={(item, index) => index.toString()}
        renderItem={({ item }) => (
          <DriverCard
            item={item}
            selected={selectedDriver!}
            setSelected={() => setSelectedDriver(item.id!)}
          />
        )}
        ListEmptyComponent={() => (
          <View className="flex flex-col items-center justify-center py-10">
            <ActivityIndicator size="small" color="#000" />
            <Text className="text-sm text-general-800 mt-3">
              Finding available rides near you...
            </Text>
          </View>
        )}
        ListFooterComponent={() =>
          drivers.length > 0 ? (
            <View className="mx-5 mt-10">
              <CustomButton
                title="Select Ride"
                disabled={selectedDriver === null}
                onPress={() => router.push("/(root)/book-ride")}
              />
            </View>
          ) : null
        }
      />
    </RideLayout>
  );
};

export default ConfirmRide;
