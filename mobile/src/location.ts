import * as Location from 'expo-location';

/**
 * Where you roughly are, fast, for area features (birds or people near you, alerts): the phone's last fix if it
 * is under half an hour old, else a quick network fix, giving up after 4 s rather than waiting on a cold GPS.
 * Sightings need a precise spot and ask for their own.
 */
export async function roughPosition(): Promise<Location.LocationObject> {
  const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000 });
  if (last) return last;
  return Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Couldn’t find where you are just now. Try again in a moment.')), 4000),
    ),
  ]);
}
