import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { TaskNotificationsHeaderButton } from '@/components/TaskNotificationsHeaderButton';
import Colors from '@/constants/Colors';
import { NatureTheme } from '@/constants/Theme';
import { isAdmin, isManagerOrAdmin, useRole } from '@/contexts/AuthContext';
import { TaskNotificationsProvider } from '@/contexts/TaskNotificationsContext';
import { NotificationBootstrap } from '@/components/NotificationBootstrap';
import {
  TabUnreadBadgesProvider,
  useTabUnreadBadges,
} from '@/contexts/TabUnreadBadgesContext';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

function TabIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

function AppTabsLayoutInner() {
  const colorScheme = useColorScheme();
  const role = useRole();
  const manager = isManagerOrAdmin(role);
  const admin = isAdmin(role);
  const { width: winW } = useWindowDimensions();
  const tabLabelFs = winW < 360 ? 9 : winW < 420 ? 10 : 11;
  const tabBarH = winW < 380 ? 52 : 56;
  const { chatBadge, communityBadge, taskNotifBadge } = useTabUnreadBadges();

  const t = NatureTheme.colors;
  const badgeStyle = {
    backgroundColor: t.checkIn,
    color: t.onAccent,
    fontSize: 10,
    fontWeight: '700' as const,
  };

  return (
    <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          tabBarInactiveTintColor: Colors[colorScheme ?? 'light'].tabIconDefault,
          tabBarStyle: {
            backgroundColor: t.tabBar,
            borderTopColor: t.tabBarBorder,
            borderTopWidth: 1,
            paddingTop: 2,
            height: tabBarH,
          },
          tabBarLabelStyle: { fontSize: tabLabelFs, fontWeight: '600' },
          tabBarItemStyle: { paddingHorizontal: winW < 400 ? 2 : 6 },
          headerStyle: { backgroundColor: t.surface },
          headerTintColor: t.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          headerShown: useClientOnlyValue(false, true),
          headerRight: () => <TaskNotificationsHeaderButton />,
        }}>
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'เวลาเข้า-ออก',
          tabBarIcon: ({ color }) => <TabIcon name="clock-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'งาน',
          tabBarIcon: ({ color }) => <TabIcon name="tasks" color={color} />,
          tabBarBadge: taskNotifBadge,
          tabBarBadgeStyle: badgeStyle,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'ตาราง',
          href: manager ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: 'ทีม',
          href: manager ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="users" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'แชทเข้า-ออก',
          tabBarIcon: ({ color }) => <TabIcon name="comments" color={color} />,
          tabBarBadge: chatBadge,
          tabBarBadgeStyle: badgeStyle,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'คอมมูนิตี้',
          tabBarIcon: ({ color }) => <TabIcon name="bullhorn" color={color} />,
          tabBarBadge: communityBadge,
          tabBarBadgeStyle: badgeStyle,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'โปรไฟล์',
          tabBarIcon: ({ color }) => <TabIcon name="user" color={color} />,
        }}
      />
      <Tabs.Screen
        name="wellbeing"
        options={{
          href: null,
          title: 'สุขภาวะทางใจ',
        }}
      />
      <Tabs.Screen
        name="tasks-assigned"
        options={{
          href: null,
          title: 'สถานะมอบหมาย',
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'แอดมิน',
          href: admin ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon name="cog" color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function AppTabsLayout() {
  return (
    <TaskNotificationsProvider>
      <TabUnreadBadgesProvider>
        <NotificationBootstrap />
        <AppTabsLayoutInner />
      </TabUnreadBadgesProvider>
    </TaskNotificationsProvider>
  );
}
