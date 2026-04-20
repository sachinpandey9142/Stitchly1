import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';

import { useAuth } from '../src/context/AuthContext';
import { Colors, Fonts, Radius, Spacing } from '../src/utils/theme';
import {
  buildOverlayRect,
  extractTryOnAnchors,
  OverlayRect,
  PoseLandmark,
  PoseSilhouettePoint,
  smoothOverlayRect,
} from '../src/utils/aiTryOn';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const DEFAULT_HEIGHT_CM = 170;
const DETECTION_INTERVAL_MS = 320;
const FIT_GUIDE_MIN_SCORE = 0.78;

type FitGuideZone = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const FIT_GUIDE_ZONE: FitGuideZone = {
  left: 0.18,
  right: 0.82,
  top: 0.06,
  bottom: 0.95,
};

type OutfitOption = {
  key: string;
  label: string;
  source: ImageSourcePropType;
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function evaluateFitGuide(
  landmarks: PoseLandmark[] | null,
  zone: FitGuideZone
): { score: number; fits: boolean; instruction?: string } {
  if (!Array.isArray(landmarks) || landmarks.length < 29) {
    return { score: 0, fits: false, instruction: 'Move fully into guide box' };
  }

  const criticalPoints = [0, 11, 12, 23, 24, 27, 28];
  const points = criticalPoints
    .map((index) => landmarks[index])
    .filter((point): point is PoseLandmark => Boolean(point) && Number(point.visibility ?? 0) >= 0.2)
    .map((point) => ({
      x: clampUnit(Number(point.x ?? 0)),
      y: clampUnit(Number(point.y ?? 0)),
    }));

  if (points.length < 4) {
    return { score: 0, fits: false, instruction: 'Hold steady in guide box' };
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const insideRatio =
    points.filter(
      (point) => point.x >= zone.left && point.x <= zone.right && point.y >= zone.top && point.y <= zone.bottom
    ).length / points.length;

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const zoneCenterX = (zone.left + zone.right) * 0.5;
  const zoneCenterY = (zone.top + zone.bottom) * 0.5;

  const centerScore =
    clampUnit(1 - (Math.abs(centerX - zoneCenterX) / ((zone.right - zone.left) * 0.5 + 1e-6))) *
    clampUnit(1 - (Math.abs(centerY - zoneCenterY) / ((zone.bottom - zone.top) * 0.5 + 1e-6)));

  const marginLeft = clampUnit((minX - zone.left) / 0.06);
  const marginRight = clampUnit((zone.right - maxX) / 0.06);
  const marginTop = clampUnit((minY - zone.top) / 0.08);
  const marginBottom = clampUnit((zone.bottom - maxY) / 0.06);
  const containmentScore = Math.min(marginLeft, marginRight, marginTop, marginBottom);

  const score = clampUnit((insideRatio * 0.62) + (centerScore * 0.2) + (containmentScore * 0.18));

  if (minX < zone.left - 0.01) {
    return { score, fits: false, instruction: 'Move right inside guide box' };
  }
  if (maxX > zone.right + 0.01) {
    return { score, fits: false, instruction: 'Move left inside guide box' };
  }
  if (minY < zone.top - 0.01) {
    return { score, fits: false, instruction: 'Move back so head fits' };
  }
  if (maxY > zone.bottom + 0.01) {
    return { score, fits: false, instruction: 'Move back so feet fit' };
  }

  return { score, fits: score >= FIT_GUIDE_MIN_SCORE };
}

const OUTFIT_OPTIONS: OutfitOption[] = [
  {
    key: 'lehenga',
    label: 'Lehenga',
    source: require('../src/assets/designs/lehenga/bridal.png'),
  },
  {
    key: 'suit',
    label: 'Suit',
    source: require('../src/assets/designs/suits/straight.png'),
  },
  {
    key: 'blazer',
    label: 'Blazer',
    source: require('../src/assets/designs/blazers/blazer.png'),
  },
  {
    key: 'gown',
    label: 'Gown',
    source: require('../src/assets/designs/suits/anarkali.png'),
  },
];

export default function AiTryOnScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { user } = useAuth();

  const cameraRef = useRef<Camera>(null);
  const detectionBusyRef = useRef(false);
  const smoothedRectRef = useRef<OverlayRect | null>(null);

  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');

  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const preferredDevice = cameraFacing === 'front' ? frontDevice : backDevice;
  const device = preferredDevice || frontDevice || backDevice;
  const canToggleCamera = Boolean(frontDevice && backDevice);

  const [permissionResolved, setPermissionResolved] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  const [landmarks, setLandmarks] = useState<PoseLandmark[] | null>(null);
  const [selectedOutfit, setSelectedOutfit] = useState<OutfitOption>(OUTFIT_OPTIONS[0]);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [statusMessage, setStatusMessage] = useState('Fit full body inside guide box');
  const [fitScore, setFitScore] = useState(0);

  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);

  const userHeight = useMemo(() => {
    const parsed = Number(user?.height);
    if (Number.isFinite(parsed) && parsed > 80) {
      return parsed;
    }
    return DEFAULT_HEIGHT_CM;
  }, [user?.height]);

  useEffect(() => {
    let mounted = true;

    const requestCameraPermission = async () => {
      try {
        const status = await Camera.getCameraPermissionStatus();
        if (status === 'granted') {
          if (mounted) setHasPermission(true);
          return;
        }

        const requested = await Camera.requestCameraPermission();
        if (mounted) {
          setHasPermission(requested === 'granted');
        }
      } finally {
        if (mounted) {
          setPermissionResolved(true);
        }
      }
    };

    void requestCameraPermission();

    return () => {
      mounted = false;
    };
  }, []);

  const resetTrackingState = useCallback(() => {
    setLandmarks(null);
    setOverlayRect(null);
    setFitScore(0);
    smoothedRectRef.current = null;
  }, []);

  const detectBody = useCallback(async () => {
    if (!BACKEND || !hasPermission || !device || !cameraRef.current || capturedPhotoUri || captureBusy) {
      return;
    }

    if (frameSize.width < 60 || frameSize.height < 60 || detectionBusyRef.current) {
      return;
    }

    detectionBusyRef.current = true;

    try {
      const photo = await cameraRef.current.takePhoto({ enableShutterSound: false });

      const formData = new FormData();
      formData.append(
        'image',
        {
          uri: `file://${photo.path}`,
          name: 'tryon_frame.jpg',
          type: 'image/jpeg',
        } as any
      );
      formData.append('height_cm', String(userHeight));
      formData.append('view', 'front');

      const response = await fetch(`${BACKEND}/ai/check-position`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok || data?.error) {
        resetTrackingState();
        setStatusMessage('Fit full body inside guide box');
        return;
      }

      const nextLandmarks = Array.isArray(data?.landmarks) ? (data.landmarks as PoseLandmark[]) : null;
      const nextSilhouette = Array.isArray(data?.silhouette)
        ? (data.silhouette as PoseSilhouettePoint[])
        : undefined;
      const fitGuide = evaluateFitGuide(nextLandmarks, FIT_GUIDE_ZONE);

      setFitScore((current) => clampUnit((current * 0.35) + (fitGuide.score * 0.65)));
      setLandmarks(nextLandmarks);

      const anchors = extractTryOnAnchors(nextLandmarks);
      if (!anchors) {
        setOverlayRect(null);
        smoothedRectRef.current = null;
        setStatusMessage(fitGuide.instruction || 'Fit full body inside guide box');
        return;
      }

      const nextRect = buildOverlayRect(
        anchors,
        frameSize.width,
        frameSize.height,
        nextSilhouette,
        selectedOutfit.key
      );
      const smoothedRect = smoothOverlayRect(smoothedRectRef.current, nextRect, 0.3);

      smoothedRectRef.current = smoothedRect;
      setOverlayRect(smoothedRect);
      setStatusMessage(fitGuide.fits ? 'Tracking body' : fitGuide.instruction || 'Fit full body inside guide box');
    } catch {
      resetTrackingState();
      setStatusMessage('Fit full body inside guide box');
    } finally {
      detectionBusyRef.current = false;
    }
  }, [
    captureBusy,
    capturedPhotoUri,
    device,
    frameSize.height,
    frameSize.width,
    hasPermission,
    resetTrackingState,
    selectedOutfit.key,
    userHeight,
  ]);

  useEffect(() => {
    if (!isFocused || !hasPermission || !device || capturedPhotoUri || captureBusy) {
      return;
    }

    const interval = setInterval(() => {
      void detectBody();
    }, DETECTION_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [captureBusy, capturedPhotoUri, detectBody, device, hasPermission, isFocused]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || captureBusy) {
      return;
    }

    setCaptureBusy(true);
    try {
      const photo = await cameraRef.current.takePhoto({ enableShutterSound: false });
      setCapturedPhotoUri(`file://${photo.path}`);
    } finally {
      setCaptureBusy(false);
    }
  }, [captureBusy]);

  const handleRetake = useCallback(() => {
    setCapturedPhotoUri(null);
    setStatusMessage('Fit full body inside guide box');
    resetTrackingState();
  }, [resetTrackingState]);

  const handleToggleCamera = useCallback(() => {
    if (!canToggleCamera || captureBusy) {
      return;
    }

    setCapturedPhotoUri(null);
    setStatusMessage('Fit full body inside guide box');
    resetTrackingState();
    setCameraFacing((current) => (current === 'front' ? 'back' : 'front'));
  }, [canToggleCamera, captureBusy, resetTrackingState]);

  const fitGuideReady = fitScore >= FIT_GUIDE_MIN_SCORE;
  const captureEnabled = Boolean(device && overlayRect && fitGuideReady && !captureBusy);

  if (!permissionResolved) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <Pressable style={styles.backButtonInline} onPress={() => router.back()}>
          <Feather name="arrow-left" size={18} color={Colors.text} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionText}>Allow camera permission to start AI Try-On.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View
        style={styles.cameraStage}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setFrameSize({ width, height });
        }}
      >
        {device ? (
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isFocused && !capturedPhotoUri && !captureBusy}
            photo
            enableZoomGesture
          />
        ) : (
          <View style={styles.missingDeviceWrap}>
            <Text style={styles.permissionText}>No camera available on this device.</Text>
          </View>
        )}

        {capturedPhotoUri ? (
          <Image source={{ uri: capturedPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}

        {overlayRect ? (
          <Image
            source={selectedOutfit.source}
            style={[
              styles.outfitOverlay,
              {
                left: overlayRect.left,
                top: overlayRect.top,
                width: overlayRect.width,
                height: overlayRect.height,
              },
            ]}
            resizeMode="stretch"
          />
        ) : null}

        <View
          pointerEvents="none"
          style={[styles.fitGuideFrame, fitGuideReady && styles.fitGuideFrameReady]}
        />

        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <Pressable style={styles.iconButton} onPress={() => router.back()}>
              <Feather name="arrow-left" size={18} color={Colors.textInverted} />
            </Pressable>

            <Pressable
              style={[styles.iconButton, (!canToggleCamera || captureBusy) && styles.iconButtonDisabled]}
              onPress={handleToggleCamera}
              disabled={!canToggleCamera || captureBusy}
            >
              <Feather name="refresh-cw" size={16} color={Colors.textInverted} />
            </Pressable>
          </View>

          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{overlayRect && fitGuideReady ? 'Tracking body' : statusMessage}</Text>
            <Text style={styles.statusPillMeta}>
              Framing {Math.round(fitScore * 100)}% {'  '}•{'  '}
              {device?.position === 'back' ? 'Back Cam' : 'Front Cam'}
            </Text>
          </View>
        </View>

        {!overlayRect || !fitGuideReady ? (
          <View style={styles.standInFrameHint}>
            <Text style={styles.standInFrameText}>Fit full body inside guide box</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.bottomPanel}>
        <View style={styles.panelHeaderRow}>
          <Text style={styles.panelTitle}>Choose Outfit</Text>
          <Text style={styles.panelHint}>
            {landmarks ? `${landmarks.length} landmarks` : 'No body detected'}
          </Text>
        </View>

        <FlatList
          horizontal
          data={OUTFIT_OPTIONS}
          keyExtractor={(item) => item.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.outfitList}
          renderItem={({ item }) => {
            const isActive = selectedOutfit.key === item.key;

            return (
              <Pressable
                style={[styles.outfitCard, isActive && styles.outfitCardActive]}
                onPress={() => setSelectedOutfit(item)}
              >
                <Image source={item.source} style={styles.outfitThumb} resizeMode="contain" />
                <Text style={[styles.outfitLabel, isActive && styles.outfitLabelActive]}>{item.label}</Text>
              </Pressable>
            );
          }}
        />

        <View style={styles.actionsRow}>
          {capturedPhotoUri ? (
            <>
              <Pressable style={styles.secondaryAction} onPress={handleRetake}>
                <Text style={styles.secondaryActionText}>Retake</Text>
              </Pressable>
              <Pressable style={styles.primaryAction} onPress={() => router.back()}>
                <Text style={styles.primaryActionText}>Done</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.captureButtonOuter, !captureEnabled && styles.captureButtonOuterDisabled]}
              onPress={() => {
                void handleCapture();
              }}
              disabled={!captureEnabled}
            >
              {captureBusy ? (
                <ActivityIndicator color={Colors.primary} />
              ) : (
                <View style={[styles.captureButtonInner, !captureEnabled && styles.captureButtonInnerDisabled]} />
              )}
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#03131A',
  },
  permissionScreen: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.containerPadding,
  },
  permissionTitle: {
    marginTop: 16,
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.text,
  },
  permissionText: {
    marginTop: 8,
    fontFamily: Fonts.ui,
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  backButtonInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    fontFamily: Fonts.body,
    color: Colors.text,
    fontSize: 14,
  },
  cameraStage: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#020617',
  },
  missingDeviceWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.containerPadding,
  },
  topBar: {
    position: 'absolute',
    top: 12,
    left: Spacing.containerPadding,
    right: Spacing.containerPadding,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDisabled: {
    opacity: 0.42,
  },
  statusPill: {
    borderRadius: Radius.full,
    backgroundColor: 'rgba(15, 118, 110, 0.82)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusPillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textInverted,
  },
  statusPillMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui,
    fontSize: 11,
    color: Colors.textInverted,
    opacity: 0.92,
  },
  fitGuideFrame: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    top: '6%',
    bottom: '5%',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'rgba(56, 189, 248, 0.95)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(56, 189, 248, 0.04)',
  },
  fitGuideFrameReady: {
    borderColor: 'rgba(74, 222, 128, 0.95)',
    backgroundColor: 'rgba(74, 222, 128, 0.06)',
  },
  standInFrameHint: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  standInFrameText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textInverted,
  },
  outfitOverlay: {
    position: 'absolute',
    opacity: 0.86,
  },
  bottomPanel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingBottom: 20,
  },
  panelHeaderRow: {
    paddingHorizontal: Spacing.containerPadding,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.text,
  },
  panelHint: {
    fontFamily: Fonts.ui,
    fontSize: 12,
    color: Colors.textMuted,
  },
  outfitList: {
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: 12,
    gap: 10,
  },
  outfitCard: {
    width: 92,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  outfitCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  outfitThumb: {
    width: 70,
    height: 70,
  },
  outfitLabel: {
    marginTop: 6,
    fontFamily: Fonts.body,
    color: Colors.textMuted,
    fontSize: 12,
  },
  outfitLabelActive: {
    color: Colors.primary,
    fontFamily: Fonts.bodyBold,
  },
  actionsRow: {
    marginTop: 14,
    minHeight: 64,
    paddingHorizontal: Spacing.containerPadding,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  captureButtonOuter: {
    width: 66,
    height: 66,
    borderRadius: Radius.full,
    borderWidth: 3,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonOuterDisabled: {
    borderColor: Colors.border,
    opacity: 0.72,
  },
  captureButtonInner: {
    width: 50,
    height: 50,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
  },
  captureButtonInnerDisabled: {
    backgroundColor: Colors.border,
  },
  secondaryAction: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontFamily: Fonts.bodyBold,
    color: Colors.text,
    fontSize: 14,
  },
  primaryAction: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    fontFamily: Fonts.bodyBold,
    color: Colors.textInverted,
    fontSize: 14,
  },
});
