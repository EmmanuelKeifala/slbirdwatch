import { Share } from 'react-native';

import { API_URL } from '@/api';

// LIB-14: public web links for a species (/s/{id}) or a sighting (/o/{id}), served by the API.
// EXPO_PUBLIC_SHARE_URL sets the public address once the API is online; in development it's the API itself.
const BASE = (process.env.EXPO_PUBLIC_SHARE_URL ?? API_URL).replace(/\/$/, '');

export const shareSpecies = (id: number, name: string) =>
  Share.share({ message: `${name}, on SL Birdwatch: ${BASE}/s/${id}`, url: `${BASE}/s/${id}` }).catch(() => {});

export const shareSighting = (id: number, name: string) =>
  Share.share({ message: `A ${name} seen in Sierra Leone, on SL Birdwatch: ${BASE}/o/${id}`, url: `${BASE}/o/${id}` }).catch(() => {});
