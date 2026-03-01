import React, { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import * as Linking from 'expo-linking'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import type { MapData } from '../../types/map'
import { generateMapsLink, generateMarkerLink } from '../../lib/visualization-utils'

interface Props {
  mapData: MapData
}

const BADGE_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899']

export default function MapCard({ mapData }: Props) {
  const { colors } = useTheme()

  const title =
    mapData.type === 'directions'
      ? 'Route Map'
      : mapData.markers && mapData.markers.length > 0
        ? `Location Map (${mapData.markers.length} ${mapData.markers.length === 1 ? 'place' : 'places'})`
        : 'Map View'

  const mapsLink = generateMapsLink(mapData)

  const region = useMemo(() => {
    const markers = mapData.markers ?? []
    const dirs = mapData.directions

    // Collect all points to compute a bounding region
    const lats: number[] = [mapData.center.lat]
    const lngs: number[] = [mapData.center.lng]
    for (const m of markers) { lats.push(m.lat); lngs.push(m.lng) }
    if (dirs) {
      lats.push(dirs.origin.lat, dirs.destination.lat)
      lngs.push(dirs.origin.lng, dirs.destination.lng)
    }

    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.01),
      longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.01),
    }
  }, [mapData])

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons
            name={mapData.type === 'directions' ? 'navigate' : 'location'}
            size={18}
            color={mapData.type === 'directions' ? '#22c55e' : '#3b82f6'}
          />
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        </View>
        <Pressable
          onPress={() => Linking.openURL(mapsLink)}
          style={({ pressed }) => [
            styles.openBtn,
            { backgroundColor: pressed ? colors.primaryBg : colors.bgSecondary },
          ]}
        >
          <Ionicons name="open-outline" size={14} color={colors.primary} />
          <Text style={[styles.openBtnText, { color: colors.primary }]}>Open in Maps</Text>
        </Pressable>
      </View>

      {/* Native Map */}
      <View style={[styles.mapContainer, { backgroundColor: colors.bgSecondary }]}>
        <MapView
          provider={undefined}
          style={styles.map}
          initialRegion={region}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsUserLocation={false}
          liteMode={false}
        >
          {/* Marker pins */}
          {mapData.markers?.map((marker, i) => (
            <Marker
              key={i}
              coordinate={{ latitude: marker.lat, longitude: marker.lng }}
              title={marker.title}
              description={marker.description}
              pinColor={BADGE_COLORS[i % BADGE_COLORS.length]}
            />
          ))}

          {/* Direction markers */}
          {mapData.directions && (
            <>
              <Marker
                coordinate={{
                  latitude: mapData.directions.origin.lat,
                  longitude: mapData.directions.origin.lng,
                }}
                title="Origin"
                description={mapData.directions.origin.address}
                pinColor="#22c55e"
              />
              <Marker
                coordinate={{
                  latitude: mapData.directions.destination.lat,
                  longitude: mapData.directions.destination.lng,
                }}
                title="Destination"
                description={mapData.directions.destination.address}
                pinColor="#ef4444"
              />
            </>
          )}
        </MapView>
      </View>

      {/* Markers list */}
      {mapData.markers && mapData.markers.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="location" size={14} color="#3b82f6" />
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Locations ({mapData.markers.length})
            </Text>
          </View>
          {mapData.markers.map((marker, i) => (
            <Pressable
              key={i}
              onPress={() => Linking.openURL(generateMarkerLink(marker.lat, marker.lng, marker.place_id))}
              style={({ pressed }) => [
                styles.markerRow,
                { backgroundColor: pressed ? colors.surfaceHover : colors.bgSecondary },
              ]}
            >
              <View style={[styles.markerBadge, { backgroundColor: BADGE_COLORS[i % BADGE_COLORS.length] }]}>
                <Text style={styles.markerBadgeText}>{marker.label || String.fromCharCode(65 + i)}</Text>
              </View>
              <View style={styles.markerInfo}>
                {marker.title && (
                  <Text style={[styles.markerTitle, { color: colors.text }]} numberOfLines={1}>
                    {marker.title}
                  </Text>
                )}
                {marker.description && (
                  <Text style={[styles.markerDesc, { color: colors.textMuted }]} numberOfLines={2}>
                    {marker.description}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Directions info */}
      {mapData.directions && (
        <View style={styles.section}>
          <View style={[styles.directionRow, { backgroundColor: colors.bgSecondary }]}>
            <View style={[styles.dirBadge, { backgroundColor: '#22c55e' }]}>
              <Text style={styles.dirBadgeText}>A</Text>
            </View>
            <View style={styles.dirInfo}>
              <Text style={[styles.dirLabel, { color: colors.textMuted }]}>Origin</Text>
              <Text style={[styles.dirAddress, { color: colors.text }]} numberOfLines={2}>
                {mapData.directions.origin.address ||
                  `${mapData.directions.origin.lat}, ${mapData.directions.origin.lng}`}
              </Text>
            </View>
          </View>

          <View style={styles.dirConnector}>
            <Ionicons name="ellipsis-vertical" size={14} color={colors.textMuted} />
          </View>

          <View style={[styles.directionRow, { backgroundColor: colors.bgSecondary }]}>
            <View style={[styles.dirBadge, { backgroundColor: '#ef4444' }]}>
              <Text style={styles.dirBadgeText}>B</Text>
            </View>
            <View style={styles.dirInfo}>
              <Text style={[styles.dirLabel, { color: colors.textMuted }]}>Destination</Text>
              <Text style={[styles.dirAddress, { color: colors.text }]} numberOfLines={2}>
                {mapData.directions.destination.address ||
                  `${mapData.directions.destination.lat}, ${mapData.directions.destination.lng}`}
              </Text>
            </View>
          </View>

          {(mapData.directions.distance || mapData.directions.duration || mapData.directions.mode) && (
            <View style={styles.chipRow}>
              {mapData.directions.mode && (
                <View style={[styles.chip, { backgroundColor: colors.bgSecondary }]}>
                  <Ionicons
                    name={
                      mapData.directions.mode === 'walking' ? 'walk' :
                      mapData.directions.mode === 'bicycling' ? 'bicycle' :
                      mapData.directions.mode === 'transit' ? 'bus' : 'car'
                    }
                    size={12}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.chipText, { color: colors.textSecondary }]}>
                    {mapData.directions.mode}
                  </Text>
                </View>
              )}
              {mapData.directions.distance && (
                <View style={[styles.chip, { backgroundColor: colors.bgSecondary }]}>
                  <Text style={[styles.chipText, { color: colors.textSecondary }]}>
                    {mapData.directions.distance}
                  </Text>
                </View>
              )}
              {mapData.directions.duration && (
                <View style={[styles.chip, { backgroundColor: colors.bgSecondary }]}>
                  <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
                  <Text style={[styles.chipText, { color: colors.textSecondary }]}>
                    {mapData.directions.duration}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  title: { fontSize: 14, fontWeight: '600' },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  openBtnText: { fontSize: 12, fontWeight: '500' },

  // Native map
  mapContainer: {
    height: 220,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },
  map: { width: '100%', height: '100%' },

  // Sections
  section: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  sectionTitle: { fontSize: 12, fontWeight: '600' },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  markerBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  markerInfo: { flex: 1 },
  markerTitle: { fontSize: 13, fontWeight: '500' },
  markerDesc: { fontSize: 11, marginTop: 1 },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  dirConnector: { alignItems: 'center', paddingVertical: 0 },
  dirBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dirBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dirInfo: { flex: 1 },
  dirLabel: { fontSize: 11 },
  dirAddress: { fontSize: 13, fontWeight: '500', marginTop: 1 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  chipText: { fontSize: 11, fontWeight: '500' },
})
