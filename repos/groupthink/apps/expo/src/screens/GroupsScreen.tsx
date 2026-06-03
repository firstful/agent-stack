import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import type { GroupsStackParamList } from "../navigation/types";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

type Group = { id: string; name: string; bio: string; energy: string };

export function GroupsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<GroupsStackParamList>>();
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
      <Text style={styles.heading}>Groups</Text>
      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => nav.navigate("GroupDetail", { id: item.id })}
          >
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.bio}>{item.bio}</Text>
            <Text style={styles.energy}>{item.energy}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 24, fontWeight: "700", marginBottom: 12, paddingTop: 48 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#e0e0e0" },
  name: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
  bio: { fontSize: 13, color: "#666", marginBottom: 4 },
  energy: { fontSize: 12, color: "#44a", fontWeight: "500" },
});
