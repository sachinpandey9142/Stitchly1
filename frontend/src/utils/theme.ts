export const Colors = {
  primary: '#0F766E',
  primaryLight: '#14B8A6',
  primaryDark: '#115E59',
  secondary: '#D97706',
  secondaryLight: '#F59E0B',
  secondaryDark: '#B45309',
  background: '#FAFAF9',
  surface: '#FFFFFF',
  subtle: '#F5F5F4',
  text: '#1C1917',
  textMuted: '#78716C',
  textInverted: '#FFFFFF',
  border: '#E7E5E4',
  borderActive: '#0F766E',
  success: '#15803D',
  error: '#B91C1C',
  warning: '#C2410C',
  info: '#0369A1',
};

export const Fonts = {
  heading: 'PlayfairDisplay_700Bold',
  body: 'Manrope_500Medium',
  bodyBold: 'Manrope_700Bold',
  ui: 'Manrope_400Regular',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  containerPadding: 20,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
};

export const STATUS_COLORS: Record<string, string> = {
  placed: '#0369A1',
  accepted: '#0F766E',
  pickup_assigned: '#D97706',
  delivery_assigned: '#D97706',
  delivery_accepted: '#0369A1',
  picked_up: '#D97706',
  delivered_to_tailor: '#C2410C',
  in_stitching: '#7C3AED',
  completed: '#15803D',
  ready: '#15803D',
  collected_from_tailor: '#D97706',
  out_for_delivery: '#C2410C',
  delivered: '#15803D',
  rejected: '#B91C1C',
  pending: '#D97706',
  cod: '#78716C',
};

export const STATUS_LABELS: Record<string, string> = {
  placed: 'Order Placed',
  accepted: 'Accepted by Tailor',
  pickup_assigned: 'Pickup Assigned',
  delivery_assigned: 'Delivery Assigned',
  delivery_accepted: 'Delivery Assigned',
  picked_up: 'Picked Up',
  delivered_to_tailor: 'At Tailor',
  in_stitching: 'In Stitching',
  completed: 'Completed',
  ready: 'Ready for Delivery',
  collected_from_tailor: 'Collected',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  rejected: 'Rejected',
  pending: 'Pending',
  cod: 'Cash on Delivery',
};
