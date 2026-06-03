/**
 * Notifications screen — in-app notification center.
 *
 * Displays all notifications for the current user, newest first.
 * Supports infinite scroll, mark-as-read, and mark-all-read.
 */
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNotifications, type AppNotification } from "../context/NotificationContext";

// ── Helpers ──

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString();
}

function notifIcon(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case "message":
      return "chatbubble-outline";
    case "impulse":
      return "bulb-outline";
    case "vote":
      return "checkbox-outline";
    case "member":
      return "person-add-outline";
    case "endorsement":
      return "heart-outline";
    case "kick":
      return "alert-circle-outline";
    case "split":
      return "git-branch-outline";
    case "merge":
      return "git-merge-outline";
    case "sabbatical":
      return "moon-outline";
    case "system":
      return "information-circle-outline";
    default:
      return "notifications-outline";
  }
}

function notifColor(type: string): string {
  switch (type) {
    case "message": return "#58a6ff";
    case "impulse": return "#d29922";
    case "vote": return "#3fb950";
    case "member": return "#bc8cff";
    case "endorsement": return "#f85149";
    case "system": return "#8b949e";
    default: return "#58a6ff";
  }
}

// ── Component ──

function NotificationRow({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: () => void;
}) {
  const isUnread = !item.readAt;

  return (
    <TouchableOpacity
      style={[styles.notifCard, isUnread && styles.notifCardUnread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: notifColor(item.type) + "20" },
        ]}
      >
        <Ionicons
          name={notifIcon(item.type)}
          size={20}
          color={notifColor(item.type)}
        />
      </View>
      <View style={styles.notifBody}>
        <Text style={[styles.notifTitle, isUnread && styles.notifTitleUnread]}>
          {item.title}
        </Text>
        {item.body && <Text style={styles.notifBodyText}>{item.body}</Text>}
        <Text style={styles.notifTime}>{timeAgo(item.createdAt)}</Text>
      </View>
      {isUnread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

export function NotificationsScreen() {
  const {
    notifications,
    unreadCount,
    loading,
    hasMore,
    loadMore,
    markRead,
    markAllRead,
    pushSupported,
    pushToken,
  } = useNotifications();
  const insets = useSafeAreaInsets();

  const handlePress = (item: AppNotification) => {
    if (!item.readAt) {
      markRead(item.id);
    }
  };

  const renderFooter = () => {
    if (loading && notifications.length > 0) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator size="small" color="#888" />
        </View>
      );
    }
    if (!hasMore && notifications.length > 0) {
      return <Text style={styles.footerText}>All caught up</Text>;
    }
    return null;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.heading}>Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            style={styles.markAllBtn}
            onPress={markAllRead}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="checkmark-done-outline" size={18} color="#58a6ff" />
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Push notification status */}
      {!pushSupported && (
        <View style={styles.pushBanner}>
          <Ionicons name="information-circle-outline" size={16} color="#d29922" />
          <Text style={styles.pushBannerText}>
            Push notifications are only available on physical devices
          </Text>
        </View>
      )}

      {/* Loading state */}
      {loading && notifications.length === 0 && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#888" />
        </View>
      )}

      {/* Empty state */}
      {!loading && notifications.length === 0 && (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="notifications-off-outline" size={48} color="#ccc" />
          </View>
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptyDesc}>
            When someone messages your group or an impulse reaches a milestone,
            you'll see it here
          </Text>
        </View>
      )}

      {/* Notification list */}
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationRow item={item} onPress={() => handlePress(item)} />
        )}
        onEndReached={hasMore ? loadMore : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fafafa",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    backgroundColor: "#fff",
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111",
  },
  markAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  markAllText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#58a6ff",
  },
  pushBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fefce8",
    padding: 10,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 8,
  },
  pushBannerText: {
    flex: 1,
    fontSize: 12,
    color: "#92400e",
  },
  listContent: {
    paddingVertical: 8,
  },
  notifCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fff",
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  notifCardUnread: {
    borderColor: "#58a6ff",
    borderLeftWidth: 3,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    marginTop: 2,
  },
  notifBody: {
    flex: 1,
    minWidth: 0,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
    marginBottom: 2,
  },
  notifTitleUnread: {
    fontWeight: "700",
    color: "#111",
  },
  notifBodyText: {
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
    marginBottom: 4,
  },
  notifTime: {
    fontSize: 11,
    color: "#999",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#58a6ff",
    marginLeft: 8,
    marginTop: 6,
  },
  footer: {
    padding: 16,
    alignItems: "center",
  },
  footerText: {
    textAlign: "center",
    color: "#999",
    fontSize: 12,
    padding: 16,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#888",
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: "#aaa",
    textAlign: "center",
    lineHeight: 20,
  },
});
