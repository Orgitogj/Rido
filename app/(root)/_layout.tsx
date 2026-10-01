import { useAuth } from "@clerk/expo";
import { Redirect, Stack, usePathname } from "expo-router";
import { useEffect } from "react";

import { usePendingRoute } from "@/lib/notificationRouting";
import { usePendingChatRoute, usePushRegistration } from "@/lib/notifications";
import { useAccountBoundary } from "@/lib/session";

const PushRegistration = () => {
  usePushRegistration();
  usePendingChatRoute();
  return null;
};

const Layout = () => {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const remember = usePendingRoute((s) => s.remember);
  useAccountBoundary();

  useEffect(() => {
    if (isLoaded && !isSignedIn) remember(pathname);
  }, [isLoaded, isSignedIn, pathname, remember]);

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <>
      <PushRegistration />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="find-ride" options={{ headerShown: false }} />
        <Stack.Screen name="confirm-ride" options={{ headerShown: false }} />
        <Stack.Screen name="ride/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="driver" options={{ headerShown: false }} />
        <Stack.Screen name="receipt/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="earnings" options={{ headerShown: false }} />
        <Stack.Screen name="safety/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="places" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="support/index" options={{ headerShown: false }} />
        <Stack.Screen name="support/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="delete-account" options={{ headerShown: false }} />
      </Stack>
    </>
  );
};

export default Layout;
