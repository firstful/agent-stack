import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { FeedScreen } from "./src/screens/FeedScreen";
import { GroupsScreen } from "./src/screens/GroupsScreen";
import { MessagesScreen } from "./src/screens/MessagesScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { GroupDetailScreen } from "./src/screens/GroupDetailScreen";
import { ImpulseScreen } from "./src/screens/ImpulseScreen";
import { Platform } from "react-native";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function FeedStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Feed" component={FeedScreen} />
      <Stack.Screen name="GroupDetail" component={GroupDetailScreen} />
      <Stack.Screen name="Impulse" component={ImpulseScreen} />
    </Stack.Navigator>
  );
}

function GroupsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Groups" component={GroupsScreen} />
      <Stack.Screen name="GroupDetail" component={GroupDetailScreen} />
    </Stack.Navigator>
  );
}

const isMobile = Platform.OS === "ios" || Platform.OS === "android";

export default function App() {
  return (
    <>
      <StatusBar style="auto" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: isMobile
              ? { paddingBottom: 8, paddingTop: 4 }
              : { maxWidth: 480, marginHorizontal: "auto" },
          }}
        >
          <Tab.Screen name="FeedTab" component={FeedStack} options={{ title: "Feed" }} />
          <Tab.Screen name="GroupsTab" component={GroupsStack} options={{ title: "Groups" }} />
          <Tab.Screen name="Messages" component={MessagesScreen} />
          <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}
