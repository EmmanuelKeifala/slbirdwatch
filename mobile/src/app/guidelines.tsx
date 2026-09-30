import { SafeAreaView } from 'react-native-safe-area-context';

import { Guidelines } from '@/components/Guidelines';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/theme';

/** Community guidelines, readable any time from the profile. */
export default function GuidelinesScreen() {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Community guidelines" back />
      <Guidelines />
    </SafeAreaView>
  );
}
