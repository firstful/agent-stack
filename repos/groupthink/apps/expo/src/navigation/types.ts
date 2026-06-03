/**
 * Navigation type definitions for the Groupthink Expo app.
 *
 * Screens are organised into three navigator layers:
 *   1. Root navigator — switches between Auth and Main (authenticated) stacks
 *   2. Bottom Tab navigator — the four primary tabs (Feed, Groups, Messages, Profile)
 *   3. Stack navigators within each tab — drill-down screens
 */
import type { NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";

// ── Stack screens nested inside FeedTab ──
export type FeedStackParamList = {
  Feed: undefined;
  GroupDetail: { id: string };
  Impulse: { id: string };
  Search: { query?: string } | undefined;
};

// ── Stack screens nested inside GroupsTab ──
export type GroupsStackParamList = {
  Groups: undefined;
  GroupDetail: { id: string };
};

// ── Stack screens nested inside MessagesTab ──
export type MessagesStackParamList = {
  Messages: undefined;
  Conversation: { userId: string; username: string };
};

// ── Stack screens nested inside ProfileTab ──
export type ProfileStackParamList = {
  Profile: undefined;
  Settings: undefined;
  Notifications: undefined;
};

// ── Bottom tab ──
export type MainTabParamList = {
  FeedTab: NavigatorScreenParams<FeedStackParamList>;
  GroupsTab: NavigatorScreenParams<GroupsStackParamList>;
  MessagesTab: NavigatorScreenParams<MessagesStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

// ── Root (auth gate) ──
export type RootStackParamList = {
  Auth: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
};

// ── Screen props helpers ──
export type FeedScreenProps = NativeStackScreenProps<FeedStackParamList, "Feed">;
export type GroupDetailScreenProps = NativeStackScreenProps<
  FeedStackParamList | GroupsStackParamList,
  "GroupDetail"
>;
export type ImpulseScreenProps = NativeStackScreenProps<FeedStackParamList, "Impulse">;
export type AuthScreenProps = NativeStackScreenProps<RootStackParamList, "Auth">;

// ── Navigation prop type for useNavigation ──
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
