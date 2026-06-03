import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import type { MessagesStackParamList } from "../navigation/types";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

type DM = {
  id: string;
  content: string;
  createdAt: string;
  sender: { id: string; username: string };
  recipient: { id: string; username: string };
};

export function MessagesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MessagesStackParamList>>();
  const [dms, setDms] = useState<DM[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/messages`)
      .then((r) => r.json())
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={styles.container}><ActivityIndicator /></View>;

  // Group DMs by conversation partner for inbox view
  const conversations = dms.reduce<Record<string, { partnerId: string; partnerName: string; lastMessage: string }>>(
    (acc, dm) => {
      const partner = dm.sender ?? dm.recipient;
      if (!acc[partner.id]) {
        acc[partner.id] = {
          partnerId: partner.id,
          partnerName: partner.username,
          lastMessage: dm.content,
        };
      }
      return acc;
    },
    {},
  );

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Messages</Text>
      <FlatList
        data={Object.values(conversations)}
        keyExtractor={(item) => item.partnerId}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() =>
              nav.navigate("Conversation", {
                userId: item.partnerId,
                username: item.partnerName,
              })
            }
          >
            <View style={styles.avatar}>
              <Ionicons name="person-circle-outline" size={40} color="#aaa" />
            </View>
            <View style={styles.conversationInfo}>
              <Text style={styles.name}>{item.partnerName}</Text>
              <Text style={styles.preview} numberOfLines={1}>
                {item.lastMessage}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#ccc" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="chatbubbles-outline" size={48} color="#ddd" />
            <Text style={styles.empty}>No messages yet</Text>
            <Text style={styles.emptySub}>Start a conversation from a group</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 24, fontWeight: "700", marginBottom: 12, paddingTop: 48 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  avatar: { marginRight: 12 },
  conversationInfo: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  preview: { fontSize: 13, color: "#888" },
  emptyWrap: { alignItems: "center", marginTop: 60 },
  empty: { textAlign: "center", color: "#888", marginTop: 12, fontSize: 16 },
  emptySub: { textAlign: "center", color: "#aaa", marginTop: 4, fontSize: 13 },
});
