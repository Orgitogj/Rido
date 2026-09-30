import { useAuth, useUser } from "@clerk/expo";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { create } from "zustand";

import { useApi } from "@/lib/fetch";
import {
  authorizeRoute,
  chatRideId,
  notificationTarget,
  usePendingRoute,
} from "@/lib/notificationRouting";

import type { ChatView } from "@/shared/contracts";

const TOKEN_KEY = "expo-push-token";

let activeChatRideId: string | null = null;
export function setActiveChat(rideId: string | null) {
  activeChatRideId = rideId;
}

export function isActiveChatNotification(data: unknown) {
  const payload = (data ?? {}) as { kind?: unknown; rideId?: unknown };
  return (
    payload.kind === "chat_message" &&
    activeChatRideId !== null &&
    payload.rideId === activeChatRideId
  );
}

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const quiet = isActiveChatNotification(notification.request.content.data);
      return {
        shouldShowBanner: !quiet,
        shouldShowList: !quiet,
        shouldPlaySound: !quiet,
        shouldSetBadge: false,
      };
    },
  });
}

export function chatAuthorizer(request: Request) {
  return async (rideId: string) => {
    const chat = await request<ChatView>(`/api/rides/${rideId}/chat`);
    return chat.state !== "unavailable" && chat.state !== "expired";
  };
}

export type PushStatus =
  | "idle"
  | "registered"
  | "denied"
  | "unsupported"
  | "needs_dev_build"
  | "no_project"
  | "error";

export const usePushStatus = create<{
  status: PushStatus;
  set: (status: PushStatus) => void;
}>((set) => ({ status: "idle", set: (status) => set({ status }) }));

type Request = <T>(
  path: string,
  options?: { method?: string; body?: unknown },
) => Promise<T>;

const projectId = () =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId ??
  Constants.easConfig?.projectId ??
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

export async function registerForPush(request: Request): Promise<PushStatus> {
  if (Platform.OS === "web" || !Device.isDevice) return "unsupported";
  if (
    Platform.OS === "android" &&
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ) {
    return "needs_dev_build";
  }
  const id = projectId();
  if (!id) return "no_project";
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("rides", {
        name: "Ride updates",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return "denied";
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id }))
      .data;
    await request("/api/devices", {
      body: { token, platform: Platform.OS === "ios" ? "ios" : "android" },
    });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return "registered";
  } catch {
    return "error";
  }
}

export async function unregisterPush(request: Request) {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) {
      await request("/api/devices/unregister", { body: { token } });
    }
  } catch {
    return;
  } finally {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }
}

export function usePushRegistration() {
  const request = useApi();
  const { user } = useUser();
  const setStatus = usePushStatus((s) => s.set);
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || registeredFor.current === user.id) return;
    registeredFor.current = user.id;
    registerForPush(request).then(setStatus);
  }, [user?.id, request, setStatus]);
}

export function usePendingChatRoute() {
  const { isSignedIn } = useAuth();
  const request = useApi();

  useEffect(() => {
    if (!isSignedIn) return;
    const pending = usePendingRoute.getState().route;
    if (!pending || !chatRideId(pending)) return;
    usePendingRoute.getState().take();
    authorizeRoute(pending, chatAuthorizer(request)).then((route) => {
      if (route) router.push(route as never);
    });
  }, [isSignedIn, request]);
}

export function useNotificationRouting() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const request = useApi();
  const remember = usePendingRoute((s) => s.remember);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" || !isLoaded) return;
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const decision = notificationTarget(
        response.notification.request.content.data,
        isSignedIn ? user?.id : null,
      );
      if (decision.action === "open") {
        authorizeRoute(decision.route, chatAuthorizer(request)).then(
          (route) => {
            if (route) router.push(route as never);
          },
        );
      } else if (decision.action === "sign_in") {
        remember(decision.route);
        router.replace("/(auth)/sign-in");
      }
    };
    Notifications.getLastNotificationResponseAsync().then(handle);
    const subscription =
      Notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
  }, [isLoaded, isSignedIn, user?.id, remember, request]);
}
