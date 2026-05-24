import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

type Group = { id: string; name: string; bio: string };

export function ProfileScreen() {
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
      <Text style={styles.heading}>Profile</Text>
      <View style={styles.profileCard}>
        <Text style={styles.username}>User</Text>
        <Text style={styles.joined}>Groupthink member</Text>
      </View>
      <Text style={styles.sectionTitle}>Groups</Text>
      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.groupRow}>
            <Text style={styles.groupName}>{item.name}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 24, fontWeight: "700", marginBottom: 12, paddingTop: 48 },
  profileCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#e0e0e0" },
  username: { fontSize: 20, fontWeight: "600" },
  joined: { fontSize: 13, color: "#888", marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  groupRow: { padding: 12, backgroundColor: "#fff", borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: "#e0e0e0" },
  groupName: { fontSize: 14, fontWeight: "500" },
});
