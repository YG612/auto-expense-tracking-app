import {
  createStaticNavigation,
  type StaticParamList,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, Text } from 'react-native';

import { TabBarIcon } from '../components/TabBarIcon';
import { ManualEntryScreen } from '../features/manual-bookkeeping/ManualEntryScreen';
import { RuleEditorScreen } from '../features/personalization/RuleEditorScreen';
import { RuleManagementScreen } from '../features/personalization/RuleManagementScreen';
import {
  AnalyticsScreen,
  HomeScreen,
  PendingScreen,
  SettingsScreen,
  SmartEntryScreen,
  TransactionsScreen,
} from '../screens';
import { colors, control, typography } from '../theme/tokens';

function TabLabel({ color, children }: { color: string; children: string }) {
  return (
    <Text
      adjustsFontSizeToFit
      maxFontSizeMultiplier={1.6}
      minimumFontScale={0.75}
      numberOfLines={1}
      style={[styles.tabLabel, { color }]}
    >
      {children}
    </Text>
  );
}

const MainTabs = createBottomTabNavigator({
  screenOptions: {
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.surface },
    headerTitleStyle: {
      color: colors.ink,
      fontSize: typography.title,
      fontWeight: '800',
    },
    headerTitleAlign: 'center',
    sceneStyle: { backgroundColor: colors.canvas },
    tabBarActiveTintColor: colors.brand,
    tabBarInactiveTintColor: colors.inkMuted,
    tabBarHideOnKeyboard: true,
    tabBarIconStyle: { marginTop: 4 },
    tabBarItemStyle: {
      minHeight: control.minTouchTarget,
      paddingVertical: 3,
    },
    tabBarLabel: ({ children, color }) => (
      <TabLabel color={color}>{children}</TabLabel>
    ),
    tabBarLabelPosition: 'below-icon',
    tabBarStyle: {
      minHeight: 66,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.05,
      shadowRadius: 12,
      elevation: 10,
    },
  },
  screens: {
    Home: {
      screen: HomeScreen,
      options: {
        title: '首页',
        tabBarIcon: ({ color, focused }) => (
          <TabBarIcon color={color} focused={focused} name="home" />
        ),
      },
    },
    Transactions: {
      screen: TransactionsScreen,
      options: {
        title: '流水',
        tabBarIcon: ({ color, focused }) => (
          <TabBarIcon color={color} focused={focused} name="transactions" />
        ),
      },
    },
    SmartEntry: {
      screen: SmartEntryScreen,
      options: {
        title: '智能记账',
        tabBarIcon: ({ color, focused }) => (
          <TabBarIcon color={color} focused={focused} name="add" />
        ),
      },
    },
    Analytics: {
      screen: AnalyticsScreen,
      options: {
        title: '分析',
        tabBarIcon: ({ color, focused }) => (
          <TabBarIcon color={color} focused={focused} name="analytics" />
        ),
      },
    },
    Settings: {
      screen: SettingsScreen,
      options: {
        title: '设置',
        tabBarIcon: ({ color, focused }) => (
          <TabBarIcon color={color} focused={focused} name="settings" />
        ),
      },
    },
  },
});

const RootStack = createNativeStackNavigator({
  screenOptions: {
    contentStyle: { backgroundColor: colors.canvas },
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.ink,
    headerTitleStyle: {
      color: colors.ink,
      fontSize: typography.title,
      fontWeight: '800',
    },
    headerTitleAlign: 'center',
  },
  screens: {
    Main: {
      screen: MainTabs,
      options: { headerShown: false },
    },
    Pending: {
      screen: PendingScreen,
      options: { title: '待确认' },
    },
    ManualEntry: {
      screen: ManualEntryScreen,
      options: { title: '手动记账' },
    },
    RuleManagement: {
      screen: RuleManagementScreen,
      options: { title: '分类规则' },
    },
    RuleEditor: {
      screen: RuleEditorScreen,
      options: { title: '编辑规则' },
    },
  },
});

export type RootStackParamList = StaticParamList<typeof RootStack>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export const RootNavigator = createStaticNavigation(RootStack);

const styles = StyleSheet.create({
  tabLabel: {
    marginBottom: 3,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
});
