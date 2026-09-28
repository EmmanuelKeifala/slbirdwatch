import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScroll } from '@/FormScroll';
import { ProfileEditor } from '@/ProfileEditor';
import { ScreenHeader } from '@/ScreenHeader';
import { space, useColors } from '@/theme';

/** ACC-05 profile form, opened from the profile header's "Edit profile". */
export default function ProfileEdit() {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenHeader title="Edit profile" back />
      <View style={{ flex: 1 }}>
        <FormScroll contentContainerStyle={{ padding: space.screen, paddingBottom: space.xxl * 2 }}>
          <ProfileEditor />
        </FormScroll>
      </View>
    </SafeAreaView>
  );
}
