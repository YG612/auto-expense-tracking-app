import {
  MaterialDesignIcons,
  type MaterialDesignIconsIconName,
} from '@react-native-vector-icons/material-design-icons/static';
import { StyleSheet, View } from 'react-native';

import { colors, radius } from '../theme/tokens';

export type TabBarIconName =
  'home' | 'transactions' | 'add' | 'analytics' | 'settings';

type TabBarIconProps = {
  color: string;
  focused: boolean;
  name: TabBarIconName;
};

const ICONS: Record<
  TabBarIconName,
  { active: MaterialDesignIconsIconName; inactive: MaterialDesignIconsIconName }
> = {
  home: { active: 'home', inactive: 'home-outline' },
  transactions: { active: 'view-list', inactive: 'view-list-outline' },
  add: { active: 'plus-circle', inactive: 'plus-circle-outline' },
  analytics: { active: 'chart-box', inactive: 'chart-box-outline' },
  settings: { active: 'cog', inactive: 'cog-outline' },
};

export function TabBarIcon({ color, focused, name }: TabBarIconProps) {
  const icon = ICONS[name];
  return (
    <View
      accessible={false}
      style={[styles.container, focused && styles.focusedContainer]}
    >
      <MaterialDesignIcons
        color={color}
        name={focused ? icon.active : icon.inactive}
        size={24}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 40,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  focusedContainer: { backgroundColor: colors.brandSoft },
});
