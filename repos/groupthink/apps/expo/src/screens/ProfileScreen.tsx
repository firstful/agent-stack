import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import type { ProfileStackParamList } from "../navigation/types";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

type Group = { id: string; name: string; bio: string };

export function ProfileScreen() {
  const nav = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/groups`)
      .then((r) => r.json())
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => nav.navigate("Settings")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="settings-outline" size={22} color="#888" />
        </TouchableOpacity>
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
