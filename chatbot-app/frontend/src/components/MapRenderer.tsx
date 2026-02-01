"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MapPin, Navigation, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MapData } from "@/types/map";
import { ENV_CONFIG } from "@/config/environment";

interface MapRendererProps {
  mapData: MapData;
}

// Generate Google Maps embed URL for markers
function generateMarkersEmbedUrl(mapData: MapData): string {
  const { center, zoom, markers } = mapData;
  const apiKey = ENV_CONFIG.GOOGLE_MAPS_EMBED_API_KEY;

  if (!markers || markers.length === 0) {
    return `https://www.google.com/maps/embed/v1/view?key=${apiKey}&center=${center.lat},${center.lng}&zoom=${zoom}`;
  }

  // For single marker
  if (markers.length === 1) {
    const marker = markers[0];
    const query = marker.title
      ? encodeURIComponent(marker.title)
      : `${marker.lat},${marker.lng}`;
    return `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${query}&center=${center.lat},${center.lng}&zoom=${zoom}`;
  }

  // For multiple markers - use directions mode with waypoints
  // This is a workaround since embed API doesn't support multiple custom markers
  // We'll show all markers in a search query
  const query = markers
    .map(m => m.title || `${m.lat},${m.lng}`)
    .join('|');

  return `https://www.google.com/maps/embed/v1/search?key=${apiKey}&q=${encodeURIComponent(query)}&center=${center.lat},${center.lng}&zoom=${zoom}`;
}

// Generate Google Maps embed URL for directions
function generateDirectionsEmbedUrl(mapData: MapData): string {
  const { directions } = mapData;
  const apiKey = ENV_CONFIG.GOOGLE_MAPS_EMBED_API_KEY;

  if (!directions) {
    return '';
  }

  const origin = directions.origin.address || `${directions.origin.lat},${directions.origin.lng}`;
  const destination = directions.destination.address || `${directions.destination.lat},${directions.destination.lng}`;
  const mode = directions.mode || 'driving';

  return `https://www.google.com/maps/embed/v1/directions?key=${apiKey}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=${mode}`;
}

// Generate Google Maps link for opening in new tab
function generateMapsLink(mapData: MapData): string {
  const { type, center, markers, directions } = mapData;

  if (type === 'directions' && directions) {
    const origin = directions.origin.address || `${directions.origin.lat},${directions.origin.lng}`;
    const destination = directions.destination.address || `${directions.destination.lat},${directions.destination.lng}`;
    const mode = directions.mode || 'driving';
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${mode}`;
  }

  if (type === 'markers' && markers && markers.length > 0) {
    if (markers.length === 1) {
      const marker = markers[0];
      if (marker.place_id) {
        return `https://www.google.com/maps/place/?q=place_id:${marker.place_id}`;
      }
      return `https://www.google.com/maps/search/?api=1&query=${marker.lat},${marker.lng}`;
    }
    // Multiple markers - search query
    const query = markers.map(m => m.title || `${m.lat},${m.lng}`).join('|');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  // Fallback - just show center location
  return `https://www.google.com/maps/@${center.lat},${center.lng},${mapData.zoom}z`;
}

function MarkersList({ markers }: { markers: MapData['markers'] }) {
  if (!markers || markers.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="h-4 w-4 text-blue-500" />
        <h4 className="text-label font-semibold">Locations ({markers.length})</h4>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {markers.map((marker, index) => (
          <div
            key={index}
            className="flex items-start gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
          >
            {marker.label && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-caption flex items-center justify-center font-medium">
                {marker.label}
              </div>
            )}
            <div className="flex-1 min-w-0">
              {marker.title && (
                <div className="text-label font-medium truncate">{marker.title}</div>
              )}
              {marker.description && (
                <div className="text-caption text-muted-foreground">{marker.description}</div>
              )}
              {marker.place_id && (
                <a
                  href={`https://www.google.com/maps/place/?q=place_id:${marker.place_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-caption text-blue-500 hover:underline inline-flex items-center gap-1 mt-1"
                >
                  View on Google Maps
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DirectionsInfo({ directions }: { directions: MapData['directions'] }) {
  if (!directions) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <Navigation className="h-4 w-4 text-green-500" />
        <h4 className="text-label font-semibold">Route Details</h4>
      </div>
      <div className="space-y-2 p-3 rounded-md bg-muted/50">
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 text-white text-caption flex items-center justify-center font-medium">
            A
          </div>
          <div className="flex-1">
            <div className="text-label font-medium">Origin</div>
            <div className="text-caption text-muted-foreground">
              {directions.origin.address || `${directions.origin.lat}, ${directions.origin.lng}`}
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500 text-white text-caption flex items-center justify-center font-medium">
            B
          </div>
          <div className="flex-1">
            <div className="text-label font-medium">Destination</div>
            <div className="text-caption text-muted-foreground">
              {directions.destination.address || `${directions.destination.lat}, ${directions.destination.lng}`}
            </div>
          </div>
        </div>
        {(directions.distance || directions.duration || directions.mode) && (
          <div className="pt-2 border-t border-border mt-2 flex flex-wrap gap-2 text-caption">
            {directions.mode && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-background">
                Mode: <strong>{directions.mode}</strong>
              </span>
            )}
            {directions.distance && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-background">
                Distance: <strong>{directions.distance}</strong>
              </span>
            )}
            {directions.duration && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-background">
                Duration: <strong>{directions.duration}</strong>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const MapRenderer = React.memo<MapRendererProps>(({ mapData }) => {
  const [embedError, setEmbedError] = useState(false);
  const hasApiKey = !!ENV_CONFIG.GOOGLE_MAPS_EMBED_API_KEY;

  if (!mapData) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-label text-red-600">No map data provided</div>
      </div>
    );
  }

  const embedUrl = mapData.type === 'directions'
    ? generateDirectionsEmbedUrl(mapData)
    : generateMarkersEmbedUrl(mapData);

  const mapsLink = generateMapsLink(mapData);

  const title = mapData.type === 'directions'
    ? 'Route Map'
    : mapData.markers && mapData.markers.length > 0
    ? `Location Map (${mapData.markers.length} ${mapData.markers.length === 1 ? 'place' : 'places'})`
    : 'Map View';

  const description = mapData.type === 'directions'
    ? 'Interactive route with turn-by-turn directions'
    : 'Interactive map with location markers';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-heading-lg flex items-center gap-2">
              {mapData.type === 'directions' ? (
                <Navigation className="h-5 w-5 text-green-500" />
              ) : (
                <MapPin className="h-5 w-5 text-blue-500" />
              )}
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(mapsLink, '_blank')}
            title="Open in Google Maps"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Note about API key - only show if API key is not configured */}
        {!hasApiKey && (
          <div className="mb-4 p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <p className="text-caption text-yellow-800 dark:text-yellow-200">
              <strong>Note:</strong> To display the interactive map, set NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY in your environment.
              For now, you can view the locations using the links below.
            </p>
          </div>
        )}

        {/* Map iframe or placeholder */}
        {hasApiKey && !embedError ? (
          <div className="w-full h-96 bg-muted rounded-lg overflow-hidden border border-border relative">
            <iframe
              src={embedUrl}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              onError={() => setEmbedError(true)}
            />
          </div>
        ) : (
          <div className="w-full h-96 bg-muted rounded-lg flex items-center justify-center border border-border">
            <div className="text-center space-y-2">
              <MapPin className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="text-label text-muted-foreground">
                {embedError ? 'Failed to load map' : hasApiKey ? 'Loading map...' : 'Map embed requires API key'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(mapsLink, '_blank')}
              >
                Open in Google Maps
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Markers list */}
        {mapData.markers && <MarkersList markers={mapData.markers} />}

        {/* Directions info */}
        {mapData.directions && <DirectionsInfo directions={mapData.directions} />}
      </CardContent>
    </Card>
  );
});

MapRenderer.displayName = 'MapRenderer';
