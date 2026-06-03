/**
 * Auth screen — OAuth sign-in with Google, GitHub, or Apple.
 *
 * Per spec:
 *   - OAuth only (Google, GitHub, Apple) — leverages existing account reputation
 *   - Cloudflare Turnstile on sign-up as a lightweight bot barrier
 *   - No email/password or SMS flows; no phone number required
 *
 * The actual OAuth exchange (expo-auth-session / expo-apple-authentication)
 * is handled by the AuthContext provider; this screen is the UI gateway.
 */
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, type AuthProvider } from "../context/AuthContext";

const PROVIDERS: {
  id: AuthProvider;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  textColor: string;
  bgColor: string;
}[] = [
  {
    id: "google",
    label: "Continue with Google",
    icon: "logo-google",
    color: "#4285F4",
    textColor: "#222",
    bgColor: "#fff",
  },
  {
    id: "github",
    label: "Continue with GitHub",
    icon: "logo-github",
    color: "#333",
    textColor: "#fff",
    bgColor: "#24292e",
  },
  {
    id: "apple",
    label: "Continue with Apple",
    icon: "logo-apple",
    color: "#000",
    textColor: "#fff",
    bgColor: "#000",
  },
];

export function AuthScreen() {
  const { signIn, isLoading, error, clearError } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      {/* Brand */}
      <View style={styles.brandSection}>
        <View style={styles.logoWrap}>
          <Text style={styles.logo}>⧩</Text>
        </View>
        <Text style={styles.title}>Groupthink</Text>
        <Text style={styles.subtitle}>
          A group-based social platform where members vote on inter-group
          communications mediated by an LLM.
        </Text>
      </View>

      {/* OAuth buttons */}
      <View style={styles.authSection}>
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#444" />
            <Text style={styles.loadingText}>Opening {Platform.OS === "web" ? "popup" : "browser"}…</Text>
          </View>
        ) : (
          <View style={styles.buttonsWrap}>
            {PROVIDERS.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.oauthBtn, { backgroundColor: p.bgColor, borderColor: p.id === "google" ? "#ddd" : p.bgColor }]}
                onPress={() => signIn(p.id)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={p.icon}
                  size={20}
                  color={p.id === "google" ? "#4285F4" : p.textColor}
                  style={styles.oauthIcon}
                />
                <Text style={[styles.oauthBtnText, { color: p.textColor }]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {error && (
          <View style={styles.errorWrap}>
            <Ionicons name="alert-circle-outline" size={16} color="#e33" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={clearError}>
              <Text style={styles.errorDismiss}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Turnstile indicator */}
        <View style={styles.turnstileNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color="#999" />
          <Text style={styles.turnstileText}>
            Protected by Cloudflare Turnstile on sign-up
          </Text>
        </View>

        {/* Terms */}
        <Text style={styles.terms}>
          By continuing, you agree to the{"\n"}Terms of Service and Privacy Policy.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fafafa",
    paddingHorizontal: 32,
    justifyContent: "center",
  },
  brandSection: {
    alignItems: "center",
    marginBottom: 48,
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    // Shadow
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  logo: {
    fontSize: 36,
    color: "#222",
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#111",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#777",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 300,
  },
  authSection: {
    gap: 16,
  },
  buttonsWrap: {
    gap: 12,
  },
  oauthBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  oauthIcon: {
    marginRight: 10,
  },
  oauthBtnText: {
    fontSize: 16,
    fontWeight: "600",
  },
  loadingWrap: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 14,
    color: "#888",
  },
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fef2f2",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: "#e33",
  },
  errorDismiss: {
    fontSize: 13,
    fontWeight: "600",
    color: "#e33",
  },
  turnstileNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  turnstileText: {
    fontSize: 12,
    color: "#999",
  },
  terms: {
    fontSize: 12,
    color: "#aaa",
    textAlign: "center",
    lineHeight: 18,
  },
});
