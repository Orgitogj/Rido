import { useAuth } from "@clerk/expo";
import { Redirect, router, Slot, usePathname } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Notice } from "@/components/admin/ui";
import { AdminContext } from "@/lib/adminApi";
import { useApiQuery } from "@/lib/fetch";
import { usePendingRoute } from "@/lib/notificationRouting";

import type { OperatorMe } from "@/shared/contracts";

const NAV = [
  { href: "/admin", label: "Review queue" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/rides", label: "Rides" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/safety", label: "Safety" },
  { href: "/admin/drivers", label: "Drivers" },
  { href: "/admin/areas", label: "Service areas" },
] as const;

const AdminLayout = () => {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const pathname = usePathname();
  const remember = usePendingRoute((s) => s.remember);
  const me = useApiQuery<OperatorMe>(isSignedIn ? "/api/admin/me" : null);

  useEffect(() => {
    if (isLoaded && !isSignedIn) remember("/admin");
  }, [isLoaded, isSignedIn, remember]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  if (!me.data) {
    return (
      <View className="flex-1 items-center justify-center p-8 bg-neutral-50">
        {me.status === "error" ? (
          <>
            <Text className="text-xl font-JakartaBold">No operator access</Text>
            <Text className="text-sm text-general-200 mt-2 text-center max-w-md">
              {me.error} Operator roles are granted by an administrator with
              server access; they can&apos;t be requested from the app.
            </Text>
            <Pressable
              onPress={() => signOut()}
              className="mt-5 px-4 py-2 rounded-lg bg-neutral-200"
            >
              <Text>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <Text className="text-sm text-general-200">
            Checking operator access…
          </Text>
        )}
      </View>
    );
  }

  const operator = me.data;
  return (
    <AdminContext.Provider value={operator}>
      <View className="flex-1 bg-neutral-50">
        <View className="flex flex-row items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <View className="flex flex-row items-center">
            <Text className="text-lg font-JakartaExtraBold mr-8">
              Operations
            </Text>
            {NAV.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              return (
                <Pressable
                  key={item.href}
                  onPress={() => router.push(item.href)}
                  accessibilityRole="link"
                  className="mr-5"
                >
                  <Text
                    className={`text-sm ${active ? "font-JakartaBold text-[#0286FF]" : "text-neutral-700"}`}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View className="flex flex-row items-center">
            <Text className="text-sm text-neutral-700 mr-3">
              {operator.displayName} · {operator.permissions.join(", ")}
            </Text>
            <Pressable onPress={() => signOut()} accessibilityRole="button">
              <Text className="text-sm text-[#0286FF]">Sign out</Text>
            </Pressable>
          </View>
        </View>
        {operator.stripeMode !== "test" && (
          <View className="px-6">
            <Notice
              tone="warning"
              text={
                operator.stripeMode === "live"
                  ? "The server uses a live Stripe key. Refunds from this console are disabled; they only run in Stripe test mode."
                  : "Stripe is not configured on the server. Refunds are unavailable."
              }
            />
          </View>
        )}
        <ScrollView
          contentContainerStyle={{
            padding: 24,
            maxWidth: 1100,
            width: "100%",
            alignSelf: "center",
          }}
        >
          <Slot />
        </ScrollView>
      </View>
    </AdminContext.Provider>
  );
};

export default AdminLayout;
