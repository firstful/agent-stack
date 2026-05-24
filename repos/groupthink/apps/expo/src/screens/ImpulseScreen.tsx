import { View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { useRoute } from "@react-navigation/native";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

type Draft = { id: string; content: string; createdAt: string; user: { username: string } };

export function ImpulseScreen() {
  const route = useRoute();
  const { id } = route.params as { id: string };
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftText, setDraftText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/impulses/${id}/drafts`)
      .then((r) => r.json())
      .then(setDrafts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const sendDraft = async () => {
    if (!draftText.trim()) return;
    const userId = "";
    await fetch(`${API}/api/impulses/${id}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ impulseId: id, content: draftText }),
    });
    setDraftText("");
    const updated = await fetch(`${API}/api/impulses/${id}/drafts`).then((r) => r.json());
    setDrafts(updated);
  };

  if (loading) return <View style={styles.container}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Impulse</Text>
      <Text style={styles.status}>Status: composing</Text>

      <FlatList
        data={drafts}
        keyExtractor={(item) => item.id}
        style={styles.draftThread}
        renderItem={({ item }) => (
          <View style={styles.draftEntry}>
            <Text style={styles.author}>{item.user?.username ?? "unknown"}</Text>
            <Text>{item.content}</Text>
          </View>
        )}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draftText}
          onChangeText={setDraftText}
          placeholder="Add to draft thread..."
          multiline
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendDraft}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 18, fontWeight: "700", marginBottom: 4, paddingTop: 48 },
  status: { fontSize: 13, color: "#888", marginBottom: 16 },
  draftThread: { flex: 1 },
  draftEntry: { backgroundColor: "#fff", borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#e0e0e0" },
  author: { fontWeight: "600", fontSize: 13, marginBottom: 4 },
  inputRow: { flexDirection: "row", gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#e0e0e0" },
  input: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, minHeight: 60, backgroundColor: "#fff" },
  sendBtn: { backgroundColor: "#000", paddingHorizontal: 20, borderRadius: 8, justifyContent: "center" },
  sendText: { color: "#fff", fontWeight: "600" },
});
