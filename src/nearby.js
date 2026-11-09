const EARTH_MILES = 3958.8;

export function milesBetween(a, b) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const PLACES = [
  { id: "austin-tx", name: "Austin", state: "Texas", lat: 30.2672, lng: -97.7431 },
  { id: "round-rock-tx", name: "Round Rock", state: "Texas", lat: 30.5083, lng: -97.6789, nearby_only: true, base: 61 },
  { id: "cedar-park-tx", name: "Cedar Park", state: "Texas", lat: 30.5052, lng: -97.8203, nearby_only: true, base: 58 },
  { id: "georgetown-tx", name: "Georgetown", state: "Texas", lat: 30.6333, lng: -97.677, nearby_only: true, base: 54 },
  { id: "san-marcos-tx", name: "San Marcos", state: "Texas", lat: 29.8833, lng: -97.9414, nearby_only: true, base: 52 },
  { id: "houston-tx", name: "Houston", state: "Texas", lat: 29.7604, lng: -95.3698 },
  { id: "dallas-tx", name: "Dallas", state: "Texas", lat: 32.7767, lng: -96.797 },
  { id: "new-york-ny", name: "New York", state: "New York", lat: 40.7128, lng: -74.006 },
  { id: "portland-or", name: "Portland", state: "Oregon", lat: 45.5152, lng: -122.6784 },
  { id: "portland-me", name: "Portland", state: "Maine", lat: 43.6591, lng: -70.2568 },
  { id: "south-portland-me", name: "South Portland", state: "Maine", lat: 43.6415, lng: -70.2409, nearby_only: true, base: 44 },
  { id: "saint-louis-mo", name: "Saint Louis", state: "Missouri", lat: 38.627, lng: -90.1994 },
  { id: "springfield-mo", name: "Springfield", state: "Missouri", lat: 37.209, lng: -93.2923 },
  { id: "kansas-city-mo", name: "Kansas City", state: "Missouri", lat: 39.0997, lng: -94.5786 },
  { id: "springfield-il", name: "Springfield", state: "Illinois", lat: 39.7817, lng: -89.6501 }
];

export function nearbyPlaces(anchorId, { maxMiles = 45, limit = 5 } = {}) {
  const anchor = PLACES.find((place) => place.id === anchorId);
  if (!anchor) return [];
  return PLACES
    .filter((place) => place.state === anchor.state)
    .map((place) => ({ ...place, miles: Math.round(milesBetween(anchor, place)) }))
    .filter((place) => place.miles <= maxMiles)
    .sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name))
    .slice(0, limit);
}
