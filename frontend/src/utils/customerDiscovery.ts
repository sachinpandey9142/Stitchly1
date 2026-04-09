import { designCatalog } from '../data/designCatalog';

export type CatalogGroup = 'women' | 'men';

export type CategoryItem = {
  key: string;
  label: string;
  group: CatalogGroup;
};

export type TailorRecord = {
  id: string;
  name: string;
  city?: string;
  pincode?: string;
  address?: string;
  rating?: number;
  rating_count?: number;
  min_price?: number;
  specialities?: string[];
  experience?: string;
  geo_location?: { type: 'Point'; coordinates: [number, number] } | null;
  distanceKm?: number | null;
};

export const CATEGORY_CAROUSEL: CategoryItem[] = [
  { key: 'lehenga', label: 'Lehenga', group: 'women' },
  { key: 'blouse', label: 'Blouse', group: 'women' },
  { key: 'suits', label: 'Gown / Suit', group: 'women' },
  { key: 'sherwani', label: 'Sherwani', group: 'men' },
  { key: 'kurta', label: 'Kurta', group: 'men' },
  { key: 'shirts', label: 'Shirts', group: 'men' },
  { key: 'pants', label: 'Pants', group: 'men' },
  { key: 'blazers', label: 'Blazers', group: 'men' },
];

export const DESIGN_IMAGES: Record<string, Record<string, any>> = {
  lehenga: {
    'Bridal Lehenga': require('../assets/designs/lehenga/bridal.png'),
    'A-Line Lehenga': require('../assets/designs/lehenga/a-line.png'),
    'Circular Lehenga': require('../assets/designs/lehenga/circular.png'),
    'Panelled Lehenga': require('../assets/designs/lehenga/panelled.png'),
  },
  blouse: {
    'Boat Neck Blouse': require('../assets/designs/blouse/boat-neck.png'),
    'Backless Blouse': require('../assets/designs/blouse/backless.png'),
    'Princess Cut Blouse': require('../assets/designs/blouse/princess-cut.png'),
    'High Neck Blouse': require('../assets/designs/blouse/high-neck.png'),
  },
  suits: {
    'Anarkali Suit': require('../assets/designs/suits/anarkali.png'),
    'Straight Suit': require('../assets/designs/suits/straight.png'),
    'Palazzo Suit': require('../assets/designs/suits/palazzo.png'),
  },
  shirts: {
    'Formal Shirt': require('../assets/designs/shirts/shirt.png'),
    'Casual Shirt': require('../assets/designs/shirts/shirt.png'),
    'Half Sleeve Shirt': require('../assets/designs/shirts/shirt.png'),
  },
  pants: {
    'Formal Pants': require('../assets/designs/pants/pants.png'),
    'Chino Pants': require('../assets/designs/pants/pants.png'),
    'Pleated Trousers': require('../assets/designs/pants/pants.png'),
  },
  kurta: {
    'Straight Kurta': require('../assets/designs/kurta/kurta.png'),
    'Pathani Kurta': require('../assets/designs/kurta/kurta.png'),
    'Short Kurta': require('../assets/designs/kurta/kurta.png'),
  },
  blazers: {
    'Single Breasted Blazer': require('../assets/designs/blazers/blazer.png'),
    'Double Breasted Blazer': require('../assets/designs/blazers/blazer.png'),
  },
  sherwani: {
    'Wedding Sherwani': require('../assets/designs/sherwani/sherwani.png'),
    'Prince Coat': require('../assets/designs/sherwani/sherwani.png'),
    Bandhgala: require('../assets/designs/sherwani/sherwani.png'),
  },
};

export const CATEGORY_SPECIALITY_MAP: Record<string, string> = {
  lehenga: 'Lehenga',
  blouse: 'Blouse',
  suits: 'Dress',
  shirts: "Men's Suit",
  pants: "Men's Suit",
  kurta: 'Sherwani',
  blazers: "Men's Suit",
  sherwani: 'Sherwani',
};

export function getDesignsForCategory(categoryKey: string): string[] {
  if (categoryKey in designCatalog.women) {
    return designCatalog.women[categoryKey as keyof typeof designCatalog.women] || [];
  }
  if (categoryKey in designCatalog.men) {
    return designCatalog.men[categoryKey as keyof typeof designCatalog.men] || [];
  }
  return [];
}

export function getCategoryItem(categoryKey: string | null): CategoryItem | null {
  if (!categoryKey) return null;
  return CATEGORY_CAROUSEL.find((item) => item.key === categoryKey) || null;
}

export function getAllDesigns(): Array<{ category: string; design: string }> {
  const items: Array<{ category: string; design: string }> = [];
  for (const category of CATEGORY_CAROUSEL) {
    const designs = getDesignsForCategory(category.key);
    for (const design of designs) {
      items.push({ category: category.key, design });
    }
  }
  return items;
}

export function getTailorSpecialty(categoryKey: string | null, designName?: string | null): string | null {
  if (categoryKey && CATEGORY_SPECIALITY_MAP[categoryKey]) {
    return CATEGORY_SPECIALITY_MAP[categoryKey];
  }

  const normalized = (designName || '').toLowerCase();
  if (normalized.includes('lehenga')) return 'Lehenga';
  if (normalized.includes('blouse')) return 'Blouse';
  if (normalized.includes('sherwani') || normalized.includes('kurta')) return 'Sherwani';
  if (normalized.includes('shirt') || normalized.includes('blazer') || normalized.includes('pant') || normalized.includes('trouser')) return "Men's Suit";
  if (normalized.includes('suit') || normalized.includes('gown') || normalized.includes('dress')) return 'Dress';

  return null;
}

export function getDesignImage(categoryKey: string, designName: string): any | null {
  return DESIGN_IMAGES[categoryKey]?.[designName] || null;
}

export function getCategoryPreviewImage(categoryKey: string): any | null {
  const firstDesign = getDesignsForCategory(categoryKey)[0];
  if (!firstDesign) return null;
  return getDesignImage(categoryKey, firstDesign);
}

export function haversineKm(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number }
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const deltaLat = toRad(second.latitude - first.latitude);
  const deltaLon = toRad(second.longitude - first.longitude);
  const lat1 = toRad(first.latitude);
  const lat2 = toRad(second.latitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function sortTailorsByDistance(
  tailors: TailorRecord[],
  userCoords: { latitude: number; longitude: number } | null,
  maxKm?: number
): TailorRecord[] {
  const enriched = tailors.map((tailor) => {
    const geo = tailor.geo_location?.coordinates;
    if (!userCoords || !geo || geo.length !== 2) {
      return { ...tailor, distanceKm: null };
    }

    const distanceKm = haversineKm(userCoords, {
      latitude: Number(geo[1]),
      longitude: Number(geo[0]),
    });

    return { ...tailor, distanceKm };
  });

  const filtered =
    typeof maxKm === 'number'
      ? enriched.filter((tailor) => tailor.distanceKm === null || tailor.distanceKm <= maxKm)
      : enriched;

  return filtered.sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return 0;
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}
