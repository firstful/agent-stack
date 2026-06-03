/**
 * Deep linking configuration for the Groupthink Expo app.
 *
 * Maps URL paths to the nested navigator hierarchy so that
 * push notifications, universal links, and manual deeplinks
 * navigate to the correct screen.
 *
 * Scheme: groupthink:// (custom) + https://groupthink.app (universal)
 *
 * Path hierarchy (tab → stack → screen):
 *   /feed           → FeedTab > Feed
 *   /feed/:group    → FeedTab > GroupDetail { id }
 *   /feed/:group/:impulse → FeedTab > Impulse { id }
 *   /groups         → GroupsTab > Groups
 *   /groups/:group  → GroupsTab > GroupDetail { id }
 *   /messages       → MessagesTab > Messages
 *   /messages/:user → MessagesTab > Conversation
 *   /profile        → ProfileTab > Profile
 *   /search         → FeedTab > Search
 */
import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["groupthink://", "https://groupthink.app"],
  config: {
    screens: {
      Auth: "auth",
      Main: {
        screens: {
          FeedTab: {
            screens: {
              Feed: "feed",
              GroupDetail: "feed/:group",
              Impulse: "feed/:impulse",
              Search: "search",
            },
          },
          GroupsTab: {
            screens: {
              Groups: "groups",
              GroupDetail: "groups/:group",
            },
          },
          MessagesTab: {
            screens: {
              Messages: "messages",
              Conversation: "messages/:user",
            },
          },
          ProfileTab: {
            screens: {
              Profile: "profile",
              Settings: "profile/settings",
              Notifications: "notifications",
            },
          },
        },
      },
    },
  },
};

export default linking;
