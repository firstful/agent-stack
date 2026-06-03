/**
 * Push notification context and provider for the Groupthink Expo app.
 *
 * Handles:
 *   1. Requesting permission for push notifications
 *   2. Registering the device push token with the backend
 *   3. Listening for incoming notifications (foreground, background, tapped)
 *   4. Providing notification state to the rest of the app
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { Platform, Alert } from "react-native";
import * as ExpoDevice from "expo-device";
import * as Notifications from "expo-notifications";
import { useAuth } from "./AuthContext";
import { apiGet, apiPost } from "../api/client";
import type { AuthUser } from "./AuthContext";

// ── Configure how notifications are shown while app is in foreground ──

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ── Types ──

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

interface NotificationContextValue {
  /** All notifications for the current user */
  notifications: AppNotification[];
  /** Number of unread notifications */
  unreadCount: number;
  /** Whether notifications are being loaded */
  loading: boolean;
  /** Whether more notifications are available for pagination */
  hasMore: boolean;
  /** Load the next page of notifications */
  loadMore: () => Promise<void>;
  /** Mark a single notification as read */
  markRead: (id: string) => Promise<void>;
  /** Mark all notifications as read */
  markAllRead: () => Promise<void>;
  /** The expo push token (if registered) */
  pushToken: string | null;
  /** Whether push notifications are supported on this device */
  pushSupported: boolean;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  loading: false,
  hasMore: false,
  loadMore: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
  pushToken: null,
  pushSupported: false,
});

// ── Provider ──

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const notificationListener = useRef<Notifications.EventSubscription>();
  const responseListener = useRef<Notifications.EventSubscription>();

  // ── Register for push notifications ──

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    let cancelled = false;

    async function registerPushToken() {
      if (!ExpoDevice.isDevice) {
        // Running in simulator — push tokens don't work
        setPushSupported(false);
        return;
      }

      setPushSupported(true);

      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") {
        console.log("Push notification permission not granted");
        return;
      }

      try {
        const tokenData = await Notifications.getExpoPushTokenAsync();
        if (cancelled) return;
        setPushToken(tokenData.data);

        // Register with backend
        const platform = Platform.OS === "ios" ? "ios" : "android";
        await apiPost("/api/push-tokens", {
          token: tokenData.data,
          platform,
        }, user.id);
      } catch (err) {
        console.log("Failed to get push token:", err);
      }
    }

    registerPushToken();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

  // ── Listen for incoming notifications ──

  useEffect(() => {
    // Foreground notification listener
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        // When a notification arrives while the app is open,
        // we refresh the notification list
        fetchNotifications();
        fetchUnreadCount();
      });

    // Notification response listener (user tapped on notification)
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        // Could navigate to a specific screen based on notification type
        const data = response.notification.request.content.data;
        console.log("Notification tapped:", data);
      });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(
          notificationListener.current
        );
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(
          responseListener.current
        );
      }
    };
  }, []);

  // ── Fetch notifications when authenticated ──

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await apiGet<{
        notifications: AppNotification[];
        nextCursor: string | null;
      }>(`/api/notifications?limit=20`, user.id);
      setNotifications(data.notifications);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== null);
    } catch (err) {
      console.log("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiGet<{ count: number }>(
        "/api/notifications/unread-count",
        user.id
      );
      setUnreadCount(data.count);
    } catch {
      // Silently fail
    }
  }, [user]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchNotifications();
      fetchUnreadCount();

      // Poll for unread count every 30 seconds
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    } else {
      setNotifications([]);
      setUnreadCount(0);
      setCursor(null);
    }
  }, [isAuthenticated, user, fetchNotifications, fetchUnreadCount]);

  // ── Public API ──

  const loadMore = useCallback(async () => {
    if (!cursor || !user || loading) return;
    setLoading(true);
    try {
      const data = await apiGet<{
        notifications: AppNotification[];
        nextCursor: string | null;
      }>(`/api/notifications?limit=20&cursor=${encodeURIComponent(cursor)}`, user.id);
      setNotifications((prev) => [...prev, ...data.notifications]);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== null);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [cursor, user, loading]);

  const markRead = useCallback(
    async (id: string) => {
      if (!user) return;
      try {
        await apiPost(`/api/notifications/${id}/read`, {}, user.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch {
        // Silently fail
      }
    },
    [user]
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    try {
      await apiPost("/api/notifications/read-all", {}, user.id);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch {
      // Silently fail
    }
  }, [user]);

  const value: NotificationContextValue = {
    notifications,
    unreadCount,
    loading,
    hasMore,
    loadMore,
    markRead,
    markAllRead,
    pushToken,
    pushSupported,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// ── Hook ──

export function useNotifications() {
  return useContext(NotificationContext);
}
