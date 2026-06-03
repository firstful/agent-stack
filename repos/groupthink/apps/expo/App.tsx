import { NavigationContainer } from "@react-navigation/native";
import {
  createBottomTabNavigator,
  type BottomTabNavigationOptions,
} from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Platform, View, Text, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useState } from "react";

import { FeedScreen } from "./src/screens/FeedScreen";
import { GroupsScreen } from "./src/screens/GroupsScreen";
import { MessagesScreen } from "./src/screens/MessagesScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { GroupDetailScreen } from "./src/screens/GroupDetailScreen";
import { ImpulseScreen } from "./src/screens/ImpulseScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { ConversationScreen } from "./src/screens/ConversationScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { AuthScreen } from "./src/screens/AuthScreen";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import linking from "./src/navigation/linking";
import type {
  RootStackParamList,
  MainTabParamList,
  FeedStackParamList,
  GroupsStackParamList,
  MessagesStackParamList,
  ProfileStackParamList,
} from "./src/navigation/types";

// ── Navigators ──
const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const FeedStack = createNativeStackNavigator<FeedStackParamList>();
const GroupsStack = createNativeStackNavigator<GroupsStackParamList>();
const MessagesStack = createNativeStackNavigator<MessagesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

const isWeb = Platform.OS === "web";
const isMobile = Platform.OS === "ios" || Platform.OS === "android";

// ── Tab-internal stacks ──

function FeedStackScreen() {
  return (
    <FeedStack.Navigator>
      <FeedStack.Screen name="Feed" component={FeedScreen} />
      <FeedStack.Screen name="GroupDetail" component={GroupDetailScreen} />
      <FeedStack.Screen name="Impulse" component={ImpulseScreen} />
      <FeedStack.Screen name="Search" component={SearchScreen} />
    </FeedStack.Navigator>
  );
}

function GroupsStackScreen() {
  return (
    <GroupsStack.Navigator>
      <GroupsStack.Screen name="Groups" component={GroupsScreen} />
      <GroupsStack.Screen name="GroupDetail" component={GroupDetailScreen} />
    </GroupsStack.Navigator>
  );
}

function MessagesStackScreen() {
  return (
    <MessagesStack.Navigator>
      <MessagesStack.Screen name="Messages" component={MessagesScreen} />
      <MessagesStack.Screen name="Conversation" component={ConversationScreen} />
    </MessagesStack.Navigator>
  );
}

function ProfileStackScreen() {
  return (
    <ProfileStack.Navigator>
      <ProfileStack.Screen name="Profile" component={ProfileScreen} />
      <ProfileStack.Screen name="Settings" component={SettingsScreen} />
    </ProfileStack.Navigator>
  );
}

// ── Tab definitions (shared between mobile tabs and web sidebar) ──

type TabId = "FeedTab" | "GroupsTab" | "MessagesTab" | "ProfileTab";

interface TabDefinition {
  id: TabId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  component: () => React.JSX.Element;
}

const TABS: TabDefinition[] = [
  { id: "FeedTab", label: "Feed", icon: "home-outline", activeIcon: "home", component: FeedStackScreen },
  { id: "GroupsTab", label: "Groups", icon: "people-outline", activeIcon: "people", component: GroupsStackScreen },
  { id: "MessagesTab", label: "Messages", icon: "chatbubbles-outline", activeIcon: "chatbubbles", component: MessagesStackScreen },
  { id: "ProfileTab", label: "Profile", icon: "person-outline", activeIcon: "person", component: ProfileStackScreen },
];

// ── Mobile: Bottom Tab Navigator ──

const tabScreenOptions: BottomTabNavigationOptions = {
  headerShown: false,
  tabBarStyle: isMobile
    ? { paddingBottom: 8, paddingTop: 4 }
    : { maxWidth: 480, marginHorizontal: "auto" },
};

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      {TABS.map((t) => (
        <Tab.Screen
          key={t.id}
          name={t.id}
          component={t.component}
          options={{
            title: t.label,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? t.activeIcon : t.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

// ── Web: Sidebar layout ──

function SidebarLayout() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabId>("FeedTab");

  const activeComponent = TABS.find((t) => t.id === activeTab)?.component ?? TABS[0].component;

  return (
    <View style={[webStyles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Sidebar */}
      <View style={webStyles.sidebar}>
        {/* Brand */}
        <View style={webStyles.brand}>
          <Text style={webStyles.logo}>⧩</Text>
          <Text style={webStyles.brandName}>Groupthink</Text>
        </View>

        {/* Nav items */}
        <View style={webStyles.nav}>
          {TABS.map((t) => {
            const isActive = t.id === activeTab;
            return (
              <Pressable
                key={t.id}
                style={[webStyles.navItem, isActive && webStyles.navItemActive]}
                onPress={() => setActiveTab(t.id)}
              >
                <Ionicons
                  name={isActive ? t.activeIcon : t.icon}
                  size={22}
                  color={isActive ? "#111" : "#666"}
                  style={webStyles.navIcon}
                />
                <Text style={[webStyles.navLabel, isActive && webStyles.navLabelActive]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Content area */}
      <View style={webStyles.content}>
        {activeComponent({})}
      </View>
    </View>
  );
}

const webStyles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#fafafa",
  },
  sidebar: {
    width: 240,
    backgroundColor: "#fff",
    borderRightWidth: 1,
    borderRightColor: "#e0e0e0",
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  logo: {
    fontSize: 28,
    color: "#222",
  },
  brandName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
  },
  nav: {
    gap: 4,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  navItemActive: {
    backgroundColor: "#f0f0f0",
  },
  navIcon: {
    marginRight: 12,
  },
  navLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: "#666",
  },
  navLabelActive: {
    color: "#111",
    fontWeight: "600",
  },
  content: {
    flex: 1,
  },
});

// ── Root navigator (auth gate) ──

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const insets = useSafeAreaInsets();

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#fafafa",
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ActivityIndicator size="large" color="#444" />
      </View>
    );
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <RootStack.Screen
          name="Main"
          children={isWeb ? SidebarLayout : MainTabs}
        />
      ) : (
        <RootStack.Screen
          name="Auth"
          component={AuthScreen}
          options={{ animationTypeForReplace: "pop" }}
        />
      )}
    </RootStack.Navigator>
  );
}

// ── App entry ──

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <NavigationContainer linking={linking}>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
