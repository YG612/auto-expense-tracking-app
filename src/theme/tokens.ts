export const colors = {
  brand: '#2457E6',
  brandPressed: '#1948C8',
  brandSoft: '#EEF4FF',
  brandMuted: '#DDE8FF',
  onBrandMuted: '#DDE7FF',
  onBrandSubtle: '#E3EBFF',
  incomeOnBrand: '#C5F4E4',
  expenseOnBrand: '#FFDCDC',
  canvas: '#F6F8FC',
  surface: '#FFFFFF',
  surfaceMuted: '#F8FAFD',
  surfaceRaised: '#FFFFFF',
  ink: '#101828',
  inkSecondary: '#475467',
  // Text colors target at least 4.5:1 against their paired light surfaces.
  inkMuted: '#667085',
  graphicMuted: '#7B8798',
  placeholder: '#667085',
  border: '#E4E9F1',
  borderStrong: '#CDD5E1',
  income: '#07966D',
  incomeText: '#056B50',
  incomeSoft: '#EAFBF5',
  expense: '#E45353',
  expenseText: '#B42318',
  expenseSoft: '#FFF0F0',
  warning: '#C67A00',
  warningText: '#8A4B00',
  warningSoft: '#FFF7E3',
  shadow: '#102A56',
  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  caption: 12,
  body: 14,
  bodyLarge: 16,
  title: 18,
  pageTitle: 24,
  display: 36,
} as const;

export const control = {
  minTouchTarget: 48,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
  },
  floating: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 7,
  },
} as const;
