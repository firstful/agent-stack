import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

type DM = { id: string; content: string; createdAt: string; sender: { username: string }; recipient: { username: string } };

export function MessagesScreen() {
  const [dms, setDms] = useState<DM[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/groups`)
      .then((r) => r.json())
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={styles.container}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Messages</Text>
      <FlatList
        data={dms}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.from}>{item.sender?.username ?? "unknown"}</Text>
            </View>
            <Text style={styles.preview}>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 24, fontWeight: "700", marginBottom: 12, paddingTop: 48 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#e0e0e0" },
  row: { flexDirection: "row", gap: 8, marginBottom: 6 },
  from: { fontSize: 14, fontWeight: "600" },
  preview: { fontSize: 14, color: "#555" },
  empty: { textAlign: "center", color: "#888", marginTop: 40 },
});
