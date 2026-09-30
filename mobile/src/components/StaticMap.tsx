import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import type { MapSquare } from '@/api';
import { Pressable } from '@/components/Pressable';
import { font, radius, space, useColors } from '@/theme';

// Same open stack as MapPicker (MapLibre + OpenFreeMap, no key), optionally with GBIF's occurrence density tiles.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const LIB = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl';
const SIERRA_LEONE = { lat: 8.5, lng: -11.8 };

type Props = {
  gbifKey?: number;
  pin?: { lat: number; lng: number };
  zoom?: number;
  label: string;
  title?: string;
  route?: [number, number][]; // OBS-10: a walk, drawn as a line and fitted to the view
  squares?: MapSquare[]; // LIB-05: community sightings as shaded squares, fitted to the view
};

/**
 * A species' recorded range (GBIF hexagons, Sierra Leone pinned) or one spot (a sighting). The card is a still
 * preview; tapping it opens the same map full screen, where it can be panned and pinched.
 */
export function StaticMap(p: Props) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const preview = useMemo(() => page(p, false), [p.gbifKey, p.pin?.lat, p.pin?.lng, p.zoom, p.route?.length, p.squares?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = useMemo(() => page(p, true), [p.gbifKey, p.pin?.lat, p.pin?.lng, p.zoom, p.route?.length, p.squares?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${p.label}. Open full screen`}>
        <View style={styles.box} pointerEvents="none">
          <WebView originWhitelist={['*']} source={{ html: preview }} scrollEnabled={false} style={styles.web} />
          <View style={[styles.expand, { backgroundColor: c.surface }]}>
            <Feather name="maximize-2" size={16} color={c.ink} />
          </View>
        </View>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
          <View style={styles.bar}>
            <Text style={[styles.title, { color: c.ink }]} numberOfLines={1}>
              {p.title ?? 'Map'}
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              style={[styles.close, { backgroundColor: c.tint }]}
              accessibilityRole="button"
              accessibilityLabel="Close map"
            >
              <Feather name="x" size={22} color={c.ink} />
            </Pressable>
          </View>
          <WebView originWhitelist={['*']} source={{ html: full }} style={styles.web} />
          {!!p.gbifKey && (
            <Text style={[styles.legend, { color: c.inkMuted }]}>
              Hexagons: records on GBIF.org, darker means more. Pin: Sierra Leone. Pinch to zoom.
            </Text>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

function page({ gbifKey: key, pin: spot, zoom, route, squares }: Props, interactive: boolean) {
  const line = route && route.length >= 2 ? route : null;
  const pin = spot ?? (line ? { lat: line[0][0], lng: line[0][1] } : SIERRA_LEONE);
  const z = spot ? (zoom ?? 12) : interactive ? 2 : 1.1;
  const center = key ? '[5, 18]' : `[${pin.lng}, ${pin.lat}]`;
  const gbif = key
    ? `map.addSource('gbif', { type: 'raster', tileSize: 512, maxzoom: 14, tiles: ['https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?taxonKey=${key}&style=iNaturalist.poly&bin=hex&hexPerTile=40'] });
  map.addLayer({ id: 'gbif', type: 'raster', source: 'gbif', paint: { 'raster-opacity': 0.85 } });`
    : '';
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${LIB}.css"><script src="${LIB}.js"></script>
<style>html,body,#map{margin:0;height:100%;width:100%}</style></head><body><div id="map"></div><script>
const map = new maplibregl.Map({ container: 'map', style: '${STYLE}', center: ${center}, zoom: ${z}, interactive: ${interactive},
  dragRotate: false, attributionControl: { compact: true${key ? `, customAttribution: 'Records: <a href="https://www.gbif.org">GBIF.org</a>'` : ''} } });
${interactive ? "map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right'); map.touchZoomRotate.disableRotation();" : ''}
map.on('load', () => {
  ${gbif}
  ${line ? `const coords = ${JSON.stringify(line.map(([la, ln]) => [ln, la]))};
  map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#7B6FF0', 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  const b = coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(b, { padding: 30, duration: 0, maxZoom: 16 });` : ''}
  ${squares?.length ? `const sq = ${JSON.stringify(squares.map((q) => [q.lng, q.lat, q.cell / 2, q.n]))};
  map.addSource('sq', { type: 'geojson', data: { type: 'FeatureCollection', features: sq.map(([x, y, h, n]) => ({ type: 'Feature', properties: { n },
    geometry: { type: 'Polygon', coordinates: [[[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h], [x - h, y - h]]] } })) } });
  map.addLayer({ id: 'sq', type: 'fill', source: 'sq', paint: { 'fill-color': '#7B6FF0', 'fill-opacity': ['interpolate', ['linear'], ['get', 'n'], 1, 0.45, 10, 0.85] } });
  map.addLayer({ id: 'sq-edge', type: 'line', source: 'sq', paint: { 'line-color': '#4B3FC0', 'line-width': 1 } });
  const sb = sq.reduce((bb, [x, y, h]) => bb.extend([x - h, y - h]).extend([x + h, y + h]), new maplibregl.LngLatBounds([sq[0][0], sq[0][1]], [sq[0][0], sq[0][1]]));
  map.fitBounds(sb, { padding: 40, duration: 0, maxZoom: 9 });
  return;` : ''}
  new maplibregl.Marker({ color: '#17144B', scale: ${key ? 0.6 : 0.9} }).setLngLat([${pin.lng}, ${pin.lat}]).addTo(map);
});
</script></body></html>`;
}

const styles = StyleSheet.create({
  box: { height: 220, borderRadius: radius.tile, overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#EEF0F5' },
  expand: {
    position: 'absolute',
    top: space.m,
    right: space.m,
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.screen, paddingVertical: space.m },
  title: { flex: 1, fontFamily: font.display, fontSize: 24 },
  close: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  legend: { fontFamily: font.medium, fontSize: 12, paddingHorizontal: space.screen, paddingVertical: space.m },
});
