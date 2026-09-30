import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { radius, useColors } from '@/theme';

// Open & free maps (no API key): MapLibre GL JS rendering OpenFreeMap vector tiles of OpenStreetMap data.
// Runs in a WebView so it works in Expo Go; swap for @maplibre/maplibre-react-native if we move to dev builds.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const LIB = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl';

type LatLng = { lat: number; lng: number };

/** Map with one draggable pin; tap anywhere to move it. Reports every move via onPick. */
export function MapPicker({
  pin,
  onPick,
  style,
}: {
  pin: LatLng | null; // null = no pin yet (world view)
  onPick: (p: LatLng) => void;
  style?: ViewStyle;
}) {
  const c = useColors();
  const web = useRef<WebView>(null);
  const last = useRef<string | null>(null); // last position the map itself reported, to avoid echoing it back

  // Built once: later pin changes are pushed with injectJavaScript so the map doesn't reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => page(pin, c.accent), []);

  useEffect(() => {
    if (!pin) return;
    const key = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`;
    if (key === last.current) return;
    web.current?.injectJavaScript(`window.setPin(${pin.lng}, ${pin.lat}, true); true;`);
  }, [pin]);

  return (
    <View style={[styles.box, style]}>
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={(e) => {
          const p = JSON.parse(e.nativeEvent.data) as LatLng;
          last.current = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
          onPick(p);
        }}
        style={{ backgroundColor: '#EEF0F5' }}
        setSupportMultipleWindows={false}
        nestedScrollEnabled
      />
    </View>
  );
}

function page(pin: LatLng | null, color: string) {
  const center = pin ? `[${pin.lng}, ${pin.lat}]` : '[0, 15]';
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${LIB}.css"><script src="${LIB}.js"></script>
<style>html,body,#map{margin:0;height:100%;width:100%}</style></head><body><div id="map"></div><script>
const map = new maplibregl.Map({ container: 'map', style: '${STYLE}', center: ${center}, zoom: ${pin ? 15 : 1.5},
  attributionControl: { compact: true } });
let marker = null;
const send = (p) => window.ReactNativeWebView.postMessage(JSON.stringify({ lat: p.lat, lng: p.lng }));
window.setPin = (lng, lat, fly) => {
  if (!marker) {
    marker = new maplibregl.Marker({ color: '${color}', draggable: true }).setLngLat([lng, lat]).addTo(map);
    marker.on('dragend', () => send(marker.getLngLat()));
  } else marker.setLngLat([lng, lat]);
  if (fly) map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14) });
};
map.on('click', (e) => { window.setPin(e.lngLat.lng, e.lngLat.lat, false); send(e.lngLat); });
${pin ? `window.setPin(${pin.lng}, ${pin.lat}, false);` : ''}
</script></body></html>`;
}

const styles = StyleSheet.create({
  box: { height: 240, borderRadius: radius.tile, overflow: 'hidden' },
});
