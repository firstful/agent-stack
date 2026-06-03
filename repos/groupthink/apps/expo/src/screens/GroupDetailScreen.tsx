import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import type { FeedStackParamList } from "../navigation/types";
import { apiGet } from "../api/client";
import { useAuth } from "../context/AuthContext";

type Impulse = { id: string; title: string; status: string; queuePosition: number; description: string };

export function GroupDetailScreen() {
  const nav = useNavigation<NativeStackNavigationProp<FeedStackParamList>>();
  const route = useRoute();
  const { id } = route.params as { id: string };
  const { userId } = useAuth();
  const [impulses, setImpulses] = useState<Impulse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Impulse[]>(`/api/groups/${id}/impulses`, userId ?? undefined)
      .then(setImpulses)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, userId]);

  if (loading) return <View style={styles.container}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Group</Text>
      <Text style={styles.tier}>· {impulses.length} impulses</Text>

      <TouchableOpacity style={styles.newBtn}>
        <Text style={styles.newBtnText}>+ New Impulse</Text>
      </TouchableOpacity>

      <FlatList
        data={impulses}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => nav.navigate("Impulse", { id: item.id })}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardStatus}>{item.status} · position {item.queuePosition}</Text>
            {item.description && <Text style={styles.desc}>{item.description}</Text>}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 22, fontWeight: "700", marginBottom: 4, paddingTop: 48 },
  tier: { fontSize: 13, color: "#888", marginBottom: 16 },
  newBtn: { backgroundColor: "#000", padding: 12, borderRadius: 8, alignItems: "center", marginBottom: 12 },
  newBtnText: { color: "#fff", fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#e0e0e0" },
  cardTitle: { fontSize: 15, fontWeight: "500", marginBottom: 4 },
  cardStatus: { fontSize: 12, color: "#888" },
  desc: { fontSize: 13, color: "#666", marginTop: 4 },
});
