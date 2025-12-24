export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  title?: string;
  description?: string;
  place_id?: string;
}

export interface MapDirections {
  origin: {
    lat: number;
    lng: number;
    address?: string;
  };
  destination: {
    lat: number;
    lng: number;
    address?: string;
  };
  polyline?: string;
  mode?: 'driving' | 'walking' | 'bicycling' | 'transit';
  distance?: string;
  duration?: string;
}

export interface MapData {
  type: 'markers' | 'directions' | 'area';
  center: {
    lat: number;
    lng: number;
  };
  zoom: number;
  markers?: MapMarker[];
  directions?: MapDirections;
}

export interface MapToolResult {
  success: boolean;
  message: string;
  error?: string;
  map_data?: MapData;
}
