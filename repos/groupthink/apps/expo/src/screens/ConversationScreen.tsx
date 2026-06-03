/**
 * Conversation screen — direct message thread view.
 *
 * Displays messages between the current user and another user.
 * Referenced from MessagesTab stack navigation.
 */
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useEffect, useState } from "react";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

type Message = {
  id: string;
  content: string;
  createdAt: string;
  sender: { id: string; username: string };
};

export function ConversationScreen() {
  const route = useRoute();
  const { userId, username } = route.params as { userId: string; username: string };
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");

  useEffect(() => {
    fetch(`${API}/api/messages/${userId}`)
      .then((r) => r.json())
      .then(setMessages)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    await fetch(`${API}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: userId, content: inputText }),
    });
    setInputText("");
    const updated = await fetch(`${API}/api/messages/${userId}`).then((r) => r.json());
    setMessages(updated);
  };

  if (loading) return <View style={styles.container}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{username}</Text>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        style={styles.thread}
        renderItem={({ item }) => (
          <View style={styles.bubble}>
            <Text style={styles.sender}>{item.sender?.username ?? "unknown"}</Text>
            <Text>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet</Text>}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Write a message..."
          multiline
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 22, fontWeight: "700", marginBottom: 12, paddingTop: 48 },
  thread: { flex: 1 },
  bubble: { backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#e0e0e0" },
  sender: { fontWeight: "600", fontSize: 13, marginBottom: 4, color: "#555" },
  empty: { textAlign: "center", color: "#888", marginTop: 40 },
  inputRow: { flexDirection: "row", gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#e0e0e0" },
  input: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, minHeight: 60, backgroundColor: "#fff" },
  sendBtn: { backgroundColor: "#000", paddingHorizontal: 20, borderRadius: 8, justifyContent: "center" },
  sendText: { color: "#fff", fontWeight: "600" },
});
