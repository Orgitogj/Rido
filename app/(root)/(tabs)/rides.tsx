import { FlatList, RefreshControl, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ListState from "@/components/ListState";
import RideCard from "@/components/RideCard";
import { useApiQuery } from "@/lib/fetch";

import type { RideView } from "@/shared/contracts";

const Rides = () => {
  const rides = useApiQuery<RideView[]>("/api/rides", {
    refetchOnFocus: true,
  });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <FlatList
        data={rides.data ?? []}
        renderItem={({ item }) => <RideCard ride={item} />}
        keyExtractor={(item) => item.id}
        className="px-5"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingBottom: 100,
        }}
        refreshControl={
          <RefreshControl
            refreshing={rides.status === "loading" && rides.data !== null}
            onRefresh={rides.refetch}
          />
        }
        ListEmptyComponent={
          rides.status === "loading" ? (
            <ListState kind="loading" message="Loading your rides…" />
          ) : rides.status === "error" ? (
            <ListState
              kind="error"
              message={rides.error}
              onRetry={rides.refetch}
            />
          ) : (
            <ListState
              kind="empty"
              message="No rides yet. Your requested rides will appear here."
            />
          )
        }
        ListHeaderComponent={
          <>
            <Text className="text-2xl font-JakartaBold my-5">All Rides</Text>
            {rides.status === "error" &&
              rides.data &&
              rides.data.length > 0 && (
                <Text className="text-sm text-red-500 mb-3">
                  Couldn&apos;t refresh: {rides.error} Pull down to retry.
                </Text>
              )}
          </>
        }
      />
    </SafeAreaView>
  );
};

export default Rides;
