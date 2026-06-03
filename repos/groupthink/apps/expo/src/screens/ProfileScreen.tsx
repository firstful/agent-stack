import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
import type { ProfileStackParamList } from "../navigation/types";
import { apiGet } from "../api/client";

type Group = { id: string; name: string; bio: string };

export function ProfileScreen() {
  const nav = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user, userId } = useAuth();
  const { unreadCount } = useNotifications();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Group[]>("/api/groups", userId ?? undefined)
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <View style={styles.container}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={32} color="#888" />
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.username}>{user?.username ?? "User"}</Text>
          <Text style={styles.providerBadge}>
            {user?.provider ? user.provider.charAt(0).toUpperCase() + user.provider.slice(1) : ""}
          </Text>
          <Text style={styles.joined}>Groupthink member</Text>
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => nav.navigate("Notifications")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={unreadCount > 0 ? "notifications" : "notifications-outline"}
              size={22}
              color={unreadCount > 0 ? "#58a6ff" : "#888"}
            />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => nav.navigate("Settings")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="settings-outline" size={22} color="#888" />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Groups</Text>
      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.groupRow}>
            <Ionicons name="people-outline" size={18} color="#666" style={{ marginRight: 10 }} />
            <View>
              <Text style={styles.groupName}>{item.name}</Text>
              {item.bio && <Text style={styles.groupBio}>{item.bio}</Text>}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No groups yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 16 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  profileInfo: { flex: 1 },
  username: { fontSize: 20, fontWeight: "600", marginBottom: 2 },
  providerBadge: {
    fontSize: 12,
    fontWeight: "500",
    color: "#666",
    marginBottom: 2,
  },
  joined: { fontSize: 13, color: "#888" },
  settingsBtn: { padding: 4 },
  iconBtn: { padding: 4, position: "relative" },
  actionRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#f85149",
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12 },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  groupName: { fontSize: 15, fontWeight: "500" },
  groupBio: { fontSize: 12, color: "#888", marginTop: 2 },
  empty: { textAlign: "center", color: "#888", marginTop: 40 },
});
