import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import type { FeedStackParamList } from "../navigation/types";
import { apiGet } from "../api/client";
import { useAuth } from "../context/AuthContext";

type Post = {
  id: string;
  content: string;
  status: string;
  createdAt: string;
  group: { id: string; name: string; bio: string };
  targetGroup?: { id: string; name: string };
};

export function FeedScreen() {
  const nav = useNavigation<NativeStackNavigationProp<FeedStackParamList>>();
  const { userId } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Post[]>("/api/feed", userId ?? undefined)
      .then(setPosts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <View style={styles.container}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Feed</Text>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <TouchableOpacity onPress={() => nav.navigate("GroupDetail", { id: item.group.id })}>
              <Text style={styles.groupName}>{item.group.name}</Text>
            </TouchableOpacity>
            <Text style={styles.content}>{item.content}</Text>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.btn}><Text>Reply</Text></TouchableOpacity>
              <TouchableOpacity style={styles.btn}><Text>Endorse</Text></TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 24, fontWeight: "700", marginBottom: 12, paddingTop: 48 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#e0e0e0" },
  groupName: { fontSize: 16, fontWeight: "600" },
  content: { fontSize: 15, lineHeight: 22, marginBottom: 10 },
  actions: { flexDirection: "row", gap: 8 },
  btn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: "#ddd" },
});
