export type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type PoseSilhouettePoint = {
  x: number;
  y: number;
};

export type TryOnAnchors = {
  leftShoulder: PoseLandmark;
  rightShoulder: PoseLandmark;
  leftHip: PoseLandmark;
  rightHip: PoseLandmark;
};

export type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const LEFT_SHOULDER_INDEX = 11;
const RIGHT_SHOULDER_INDEX = 12;
const LEFT_HIP_INDEX = 23;
const RIGHT_HIP_INDEX = 24;
const MIN_VISIBILITY = 0.2;
const SHOULDER_TOP_OFFSET_PX = 10;
const DEFAULT_WIDTH_SCALE = 1.4;
const DEFAULT_HEIGHT_SCALE = 2.2;
const LONG_OUTFIT_HEIGHT_SCALE = 2.5;
const DEFAULT_TOP_SHIFT_RATIO = 0.08;
const LONG_OUTFIT_TOP_SHIFT_RATIO = 0.1;
const PNG_PADDING_WIDTH_BOOST = 1.08;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const hasEnoughVisibility = (landmark: PoseLandmark | undefined) => {
  if (!landmark) return false;
  if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return false;
  if (landmark.visibility == null) return true;
  return Number(landmark.visibility) >= MIN_VISIBILITY;
};

const toPixelPoint = (landmark: PoseLandmark, frameWidth: number, frameHeight: number) => ({
  x: landmark.x * frameWidth,
  y: landmark.y * frameHeight,
});

const contourWidthAtY = (
  silhouette: PoseSilhouettePoint[] | undefined,
  targetY: number,
  yBand: number,
  frameWidth: number,
  frameHeight: number
): number | null => {
  if (!silhouette || silhouette.length < 6) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let pointCount = 0;

  for (const point of silhouette) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;

    const pointY = point.y * frameHeight;
    if (Math.abs(pointY - targetY) > yBand) continue;

    const pointX = point.x * frameWidth;
    minX = Math.min(minX, pointX);
    maxX = Math.max(maxX, pointX);
    pointCount += 1;
  }

  if (pointCount < 6 || !Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) {
    return null;
  }

  return maxX - minX;
};

export const extractTryOnAnchors = (landmarks: PoseLandmark[] | null): TryOnAnchors | null => {
  if (!landmarks || landmarks.length <= RIGHT_HIP_INDEX) {
    return null;
  }

  const leftShoulder = landmarks[LEFT_SHOULDER_INDEX];
  const rightShoulder = landmarks[RIGHT_SHOULDER_INDEX];
  const leftHip = landmarks[LEFT_HIP_INDEX];
  const rightHip = landmarks[RIGHT_HIP_INDEX];

  if (
    !hasEnoughVisibility(leftShoulder) ||
    !hasEnoughVisibility(rightShoulder) ||
    !hasEnoughVisibility(leftHip) ||
    !hasEnoughVisibility(rightHip)
  ) {
    return null;
  }

  return {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
  };
};

export const buildOverlayRect = (
  anchors: TryOnAnchors,
  frameWidth: number,
  frameHeight: number,
  silhouette?: PoseSilhouettePoint[],
  outfitKey?: string
): OverlayRect => {
  if (frameWidth <= 0 || frameHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const leftShoulder = toPixelPoint(anchors.leftShoulder, frameWidth, frameHeight);
  const rightShoulder = toPixelPoint(anchors.rightShoulder, frameWidth, frameHeight);
  const leftHip = toPixelPoint(anchors.leftHip, frameWidth, frameHeight);
  const rightHip = toPixelPoint(anchors.rightHip, frameWidth, frameHeight);

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;

  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;

  const shoulderWidth = Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);
  const hipWidth = Math.hypot(rightHip.x - leftHip.x, rightHip.y - leftHip.y);
  const bodyWidth = Math.max(shoulderWidth, hipWidth);
  const bodyHeight = Math.hypot(hipMidX - shoulderMidX, hipMidY - shoulderMidY);

  const normalizedOutfit = (outfitKey || '').trim().toLowerCase();
  const isLongOutfit = normalizedOutfit === 'lehenga' || normalizedOutfit === 'gown';

  const heightScale = isLongOutfit ? LONG_OUTFIT_HEIGHT_SCALE : DEFAULT_HEIGHT_SCALE;
  const topShiftRatio = isLongOutfit ? LONG_OUTFIT_TOP_SHIFT_RATIO : DEFAULT_TOP_SHIFT_RATIO;

  const chestY = shoulderMidY + (hipMidY - shoulderMidY) * 0.35;
  const chestBand = clamp(bodyHeight * 0.12, 6, 32);
  const contourWidth = contourWidthAtY(silhouette, chestY, chestBand, frameWidth, frameHeight);

  const baseWidth = bodyWidth * DEFAULT_WIDTH_SCALE;
  const contourAdjustedWidth = contourWidth != null ? contourWidth * PNG_PADDING_WIDTH_BOOST : 0;
  const width = clamp(
    Math.max(baseWidth, contourAdjustedWidth),
    frameWidth * 0.2,
    frameWidth * 1.02
  );

  const height = clamp(bodyHeight * heightScale, frameHeight * 0.36, frameHeight * 1.35);

  const left = shoulderMidX - width / 2;
  const top = shoulderMidY - SHOULDER_TOP_OFFSET_PX + height * topShiftRatio;

  const clampedLeft = clamp(left, -frameWidth * 0.14, frameWidth - width * 0.02);
  const clampedTop = clamp(top, -frameHeight * 0.05, frameHeight - height * 0.02);

  return {
    left: clampedLeft,
    top: clampedTop,
    width,
    height,
  };
};

export const smoothOverlayRect = (
  previous: OverlayRect | null,
  next: OverlayRect,
  blendFactor: number = 0.3
): OverlayRect => {
  if (!previous) {
    return next;
  }

  const nextWeight = clamp(blendFactor, 0, 1);
  const prevWeight = 1 - nextWeight;

  return {
    left: previous.left * prevWeight + next.left * nextWeight,
    top: previous.top * prevWeight + next.top * nextWeight,
    width: previous.width * prevWeight + next.width * nextWeight,
    height: previous.height * prevWeight + next.height * nextWeight,
  };
};
