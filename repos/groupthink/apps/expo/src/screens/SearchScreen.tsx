import { View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState, useEffect, useRef, useCallback } from "react";
import type { FeedStackParamList } from "../navigation/types";
import { apiGet } from "../api/client";
import { useAuth } from "../context/AuthContext";

type GroupResult = { id: string; name: string; bio: string; energy: string };
type MessageResult = {
  id: string; content: string; createdAt: string;
  group: { id: string; name: string };
};

type SearchResults = {
  groups: GroupResult[];
  messages: MessageResult[];
};

function highlightText(text: string, query: string) {
  if (!query.trim()) return <Text>{text}</Text>;
  // Escape regex chars in the query
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  return (
    <Text>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <Text key={i} style={styles.highlight}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

export function SearchScreen() {
  const nav = useNavigation<NativeStackNavigationProp<FeedStackParamList>>();
  const route = useRoute();
  const initialQuery = (route.params as { query?: string } | undefined)?.query ?? "";
  const { userId } = useAuth();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<"global" | "my-groups">("global");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Focus the input if navigated with a pre-filled query
  useEffect(() => {
    if (initialQuery) {
      inputRef.current?.focus();
    }
  }, [initialQuery]);

  // Debounced search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      const endpoint = scope === "my-groups" ? "/api/search/groups" : "/api/search";
      apiGet<SearchResults>(`${endpoint}?q=${encodeURIComponent(query.trim())}`, userId ?? undefined)
        .then(setResults)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, scope]);

  const hasGroups = results && results.groups.length > 0;
  const hasMessages = results && results.messages.length > 0;

  const toggleScope = useCallback(() => {
    setScope((s) => (s === "global" ? "my-groups" : "global"));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Search</Text>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          placeholder="Search groups and messages…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {loading && <ActivityIndicator style={styles.spinner} />}
      </View>

      {/* Scope toggle */}
      <View style={styles.scopeRow}>
        <TouchableOpacity
          style={[styles.scopeBtn, scope === "global" && styles.scopeActive]}
          onPress={() => setScope("global")}
        >
          <Text style={[styles.scopeText, scope === "global" && styles.scopeActiveText]}>
            Global
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.scopeBtn, scope === "my-groups" && styles.scopeActive]}
          onPress={toggleScope}
        >
          <Text style={[styles.scopeText, scope === "my-groups" && styles.scopeActiveText]}>
            My Groups
          </Text>
        </TouchableOpacity>
      </View>

      {/* Empty state (no query) */}
      {!query.trim() && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Search Groupthink</Text>
          <Text style={styles.emptyDesc}>
            Find groups by name or browse public messages
          </Text>
        </View>
      )}

      {/* Empty state (no results) */}
      {query.trim() && !loading && !hasGroups && !hasMessages && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptyDesc}>
            Try a different search term
          </Text>
        </View>
      )}

      {/* Results */}
      <FlatList
        data={[
          ...(hasGroups ? [{ type: "sectionHeader" as const, title: `Groups (${results!.groups.length})` }] : []),
          ...(hasGroups ? results!.groups.map((g) => ({ type: "group" as const, item: g })) : []),
          ...(hasMessages ? [{ type: "sectionHeader" as const, title: `Messages (${results!.messages.length})` }] : []),
          ...(hasMessages ? results!.messages.map((m) => ({ type: "message" as const, item: m })) : []),
        ]}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => {
          if (item.type === "sectionHeader") {
            return <Text style={styles.sectionTitle}>{item.title}</Text>;
          }
          if (item.type === "group") {
            const g = item.item as GroupResult;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => nav.navigate("GroupDetail", { id: g.id })}
              >
                <Text style={styles.name}>{highlightText(g.name, query)}</Text>
                {g.bio && <Text style={styles.bio}>{highlightText(g.bio, query)}</Text>}
                <Text style={styles.energy}>{g.energy}</Text>
              </TouchableOpacity>
            );
          }
          if (item.type === "message") {
            const m = item.item as MessageResult;
            return (
              <View style={styles.card}>
                <Text style={styles.groupLabel}>{m.group?.name ?? "unknown"}</Text>
                <Text style={styles.content}>{highlightText(m.content, query)}</Text>
              </View>
            );
          }
          return null;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafafa", padding: 12 },
  heading: { fontSize: 24, fontWeight: "700", marginBottom: 12, paddingTop: 48 },
  searchRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  spinner: { marginLeft: 8 },
  scopeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  scopeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fff",
  },
  scopeActive: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  scopeText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#666",
  },
  scopeActiveText: {
    color: "#fff",
  },
  emptyState: { alignItems: "center", marginTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#888" },
  emptyDesc: { fontSize: 13, color: "#aaa", marginTop: 6 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#888", marginTop: 8, marginBottom: 6 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#e0e0e0" },
  name: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
  bio: { fontSize: 13, color: "#666", marginBottom: 4 },
  energy: { fontSize: 12, color: "#44a", fontWeight: "500" },
  groupLabel: { fontSize: 12, color: "#888", fontWeight: "600", marginBottom: 4 },
  content: { fontSize: 15, lineHeight: 22 },
  highlight: { backgroundColor: "#ffeb3b", fontWeight: "600" },
});
