import { useAuth } from "@clerk/expo";
import { Redirect, router, Slot, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Notice } from "@/components/admin/ui";
import { AdminContext } from "@/lib/adminApi";
import { useApi, useApiQuery } from "@/lib/fetch";
import { usePendingRoute } from "@/lib/notificationRouting";

import type { AdminBadges } from "@/shared/account";
import type { OperatorMe } from "@/shared/contracts";

const NAV = [
  { href: "/admin", label: "Review queue", badge: "review" },
  { href: "/admin/support", label: "Support", badge: "support" },
  { href: "/admin/rides", label: "Rides", badge: null },
  { href: "/admin/feedback", label: "Feedback", badge: null },
  { href: "/admin/safety", label: "Safety", badge: "safety" },
  { href: "/admin/drivers", label: "Drivers", badge: "drivers" },
  { href: "/admin/areas", label: "Service areas", badge: null },
  { href: "/admin/system", label: "System", badge: null },
] as const;

const BADGE_REFRESH_MS = 30_000;

const AdminLayout = () => {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const pathname = usePathname();
  const remember = usePendingRoute((s) => s.remember);
  const me = useApiQuery<OperatorMe>(isSignedIn ? "/api/admin/me" : null);
  const request = useApi();
  const [badges, setBadges] = useState<AdminBadges | null>(null);
  const isOperator = Boolean(me.data);

  useEffect(() => {
    if (!isOperator) return;
    let stopped = false;
    const load = () =>
      request<AdminBadges>("/api/admin/badges")
        .then((next) => {
          if (!stopped) setBadges(next);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, BADGE_REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [isOperator, request, pathname]);

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
          <View className="flex flex-row items-center flex-wrap flex-1">
            <Text className="text-lg font-JakartaExtraBold mr-8">
              Operations
            </Text>
            {NAV.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              const count = item.badge ? (badges?.[item.badge] ?? 0) : 0;
              return (
                <Pressable
                  key={item.href}
                  onPress={() => router.push(item.href)}
                  accessibilityRole="link"
                  accessibilityLabel={
                    count > 0 ? `${item.label}, ${count} waiting` : item.label
                  }
                  className="mr-5 flex flex-row items-center"
                >
                  <Text
                    className={`text-sm ${active ? "font-JakartaBold text-[#0066CC]" : "text-neutral-700"}`}
                  >
                    {item.label}
                  </Text>
                  {count > 0 && (
                    <View className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 items-center justify-center">
                      <Text className="text-[11px] text-white font-JakartaBold">
                        {count > 99 ? "99+" : count}
                      </Text>
                    </View>
                  )}
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
