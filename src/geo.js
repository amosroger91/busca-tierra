const EARTH_RADIUS_MILES = 3958.7613;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function milesBetween(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const aLat = toRadians(lat1);
  const bLat = toRadians(lat2);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function boundingBox(latitude, longitude, radiusMiles) {
  const latDelta = radiusMiles / 69;
  const lonDelta = radiusMiles / (69 * Math.cos(toRadians(latitude)));
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLon: longitude - lonDelta,
    maxLon: longitude + lonDelta,
  };
}

export function inBoundingBox(latitude, longitude, box) {
  return (
    latitude >= box.minLat &&
    latitude <= box.maxLat &&
    longitude >= box.minLon &&
    longitude <= box.maxLon
  );
}

export function roundMiles(miles) {
  return Math.round(miles * 10) / 10;
}
