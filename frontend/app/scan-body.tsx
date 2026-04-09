import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import { DeviceMotion } from "expo-sensors";
import { useRouter } from "expo-router";
import Svg, { Circle, Line, Path as SvgPath } from "react-native-svg";

import { Colors, Fonts, Radius, Spacing } from "../src/utils/theme";

const BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL || "http://10.136.221.15:8000";
const SCAN_RESULT_STORAGE_KEY = "stitchly_latest_scan_measurements";
const LEVEL_BAR_TRAVEL = 80;
const AUTO_CAPTURE_MIN_QUALITY = 0.62;
const MIN_VISIBLE_LANDMARK_CONFIDENCE = 0.2;
const OVERLAY_SMOOTHING_ALPHA = 0.62;

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

type CaptureStep = "front" | "side" | "back";

type Landmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

type SilhouettePoint = {
  x: number;
  y: number;
};

type OverlayState = {
  landmarks: Landmark[];
  silhouette: SilhouettePoint[];
  instruction: string;
  readyToCapture: boolean;
  qualityScore: number;
  imageWidth: number;
  imageHeight: number;
};

type MeasurementKey = "shoulder" | "chest" | "waist" | "hip" | "arm" | "leg" | "neck";

type MeasurementSet = {
  shoulder: number;
  chest: number;
  waist: number;
  hip: number;
  arm: number;
  leg: number;
  neck: number;
};

type ScanResult = {
  measurements: MeasurementSet;
  measurement_details?: Record<
    string,
    {
      value: number;
      confidence: number;
      method?: string;
      landmark_confidence?: number;
      silhouette_clarity?: number;
      posture_score?: number;
    }
  >;
  legacy_measurements?: Record<string, number>;
  quality?: { overall_confidence?: number; pixel_to_cm?: number };
  confidence?: Record<string, number>;
  quality_score?: number;
  warnings?: string[];
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothLandmarks(previous: Landmark[], incoming: Landmark[], alpha: number): Landmark[] {
  if (!previous.length || previous.length !== incoming.length) {
    return incoming;
  }

  return incoming.map((point, index) => {
    const current = previous[index];
    if (!current) {
      return point;
    }
    return {
      x: (current.x * (1 - alpha)) + (point.x * alpha),
      y: (current.y * (1 - alpha)) + (point.y * alpha),
      z: point.z,
      visibility: point.visibility,
    };
  });
}

function smoothSilhouette(previous: SilhouettePoint[], incoming: SilhouettePoint[], alpha: number): SilhouettePoint[] {
  if (!previous.length || previous.length !== incoming.length) {
    return incoming;
  }

  return incoming.map((point, index) => {
    const current = previous[index];
    if (!current) {
      return point;
    }
    return {
      x: (current.x * (1 - alpha)) + (point.x * alpha),
      y: (current.y * (1 - alpha)) + (point.y * alpha),
    };
  });
}

function projectNormalizedPoint(
  point: { x: number; y: number },
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
) {
  const srcW = Math.max(sourceWidth, 1);
  const srcH = Math.max(sourceHeight, 1);
  const dstW = Math.max(targetWidth, 1);
  const dstH = Math.max(targetHeight, 1);

  const scale = Math.max(dstW / srcW, dstH / srcH);
  const scaledW = srcW * scale;
  const scaledH = srcH * scale;
  const offsetX = (scaledW - dstW) * 0.5;
  const offsetY = (scaledH - dstH) * 0.5;

  return {
    x: (clampUnit(point.x) * scaledW) - offsetX,
    y: (clampUnit(point.y) * scaledH) - offsetY,
  };
}

function buildProjectedSilhouettePath(
  points: SilhouettePoint[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
) {
  if (!points || points.length < 3) {
    return "";
  }

  let path = "";
  points.forEach((point, index) => {
    const projected = projectNormalizedPoint(point, sourceWidth, sourceHeight, targetWidth, targetHeight);
    path += `${index === 0 ? "M" : "L"} ${projected.x} ${projected.y} `;
  });
  return `${path} Z`;
}

const MEASUREMENT_FIELDS: Array<{ key: MeasurementKey; label: string }> = [
  { key: "shoulder", label: "Shoulder" },
  { key: "chest", label: "Chest" },
  { key: "waist", label: "Waist" },
  { key: "hip", label: "Hip" },
  { key: "arm", label: "Arm" },
  { key: "leg", label: "Leg" },
  { key: "neck", label: "Neck" },
];

const CAPTURE_STEPS: Array<{ key: CaptureStep; title: string; hint: string }> = [
  {
    key: "front",
    title: "Step 1/3: Front",
    hint: "Face camera, stand straight, keep full body visible.",
  },
  {
    key: "side",
    title: "Step 2/3: Side",
    hint: "Turn 90° sideways with your full body visible.",
  },
  {
    key: "back",
    title: "Step 3/3: Back",
    hint: "Turn your back to camera, keep shoulders level.",
  },
];

const SKELETON_CONNECTIONS: Array<[number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

export default function ScanBody() {
  const router = useRouter();
  const cameraRef = useRef<Camera>(null);
  const checkingRef = useRef(false);
  const capturingStepRef = useRef(false);
  const isDeviceLevelRef = useRef(false);
  const gravityXRef = useRef(0);
  const gravityYRef = useRef(0);
  const gravityZRef = useRef(0);
  const tiltPitchRef = useRef(0);
  const tiltRollRef = useRef(0);
  const autoCaptureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const device = useCameraDevice("back");

  const [hasPermission, setHasPermission] = useState(false);
  const [heightCm, setHeightCm] = useState("");
  const [phase, setPhase] = useState<"height" | "capture" | "processing" | "done">("height");
  const [previewSize, setPreviewSize] = useState({ width: screenWidth, height: screenHeight });
  const [isDeviceLevel, setIsDeviceLevel] = useState(false);
  const [indicatorX, setIndicatorX] = useState(0);
  const [captureTriggered, setCaptureTriggered] = useState(false);
  const [gyroAssistEnabled, setGyroAssistEnabled] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [stabilityFrames, setStabilityFrames] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCapturingStep, setIsCapturingStep] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [editableInputs, setEditableInputs] = useState<Record<MeasurementKey, string> | null>(null);

  const [captures, setCaptures] = useState<Partial<Record<CaptureStep, string[]>>>({});
  const [overlay, setOverlay] = useState<OverlayState>({
    landmarks: [],
    silhouette: [],
    instruction: "Align your body in frame",
    readyToCapture: false,
    qualityScore: 0,
    imageWidth: screenWidth,
    imageHeight: screenHeight,
  });

  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const levelIndicatorAnim = useRef(new Animated.Value(0)).current;

  const currentStep = CAPTURE_STEPS[stepIndex];

  useEffect(() => {
    const requestPermission = async () => {
      const status = await Camera.getCameraPermissionStatus();
      if (status === "granted") {
        setHasPermission(true);
        return;
      }
      const requested = await Camera.requestCameraPermission();
      setHasPermission(requested === "granted");
    };

    requestPermission();
  }, []);

  useEffect(() => {
    DeviceMotion.setUpdateInterval(150);
    const subscription = DeviceMotion.addListener((data: any) => {
      const gravity = (data.accelerationIncludingGravity ?? {}) as Record<string, number | undefined>;
      const gx = Number(gravity.x ?? 0);
      const gy = Number(gravity.y ?? 0);
      const gz = Number(gravity.z ?? 0);

      const magnitude = Math.sqrt((gx * gx) + (gy * gy) + (gz * gz));
      const safeMagnitude = Number.isFinite(magnitude) && magnitude > 0.001 ? magnitude : 9.81;

      const normalizedX = Number.isFinite(gx) ? gx / safeMagnitude : 0;
      const normalizedY = Number.isFinite(gy) ? gy / safeMagnitude : 0;
      const normalizedZ = Number.isFinite(gz) ? gz / safeMagnitude : 0;

      gravityXRef.current = normalizedX;
      gravityYRef.current = normalizedY;
      gravityZRef.current = normalizedZ;
      tiltPitchRef.current = normalizedZ;
      tiltRollRef.current = normalizedX;

      const lateralTilt = Math.abs(normalizedX);
      const forwardTilt = Math.abs(normalizedZ);
      const level = lateralTilt <= 0.65 && forwardTilt <= 0.62;

      const normalized = Math.max(-1, Math.min(1, normalizedX));
      setIndicatorX(normalized * LEVEL_BAR_TRAVEL);

      const effectiveLevel = gyroAssistEnabled ? level : true;
      isDeviceLevelRef.current = effectiveLevel;
      setIsDeviceLevel(effectiveLevel);

      if (gyroAssistEnabled && !level) {
        setCaptureTriggered(false);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [gyroAssistEnabled]);

  useEffect(() => {
    Animated.timing(levelIndicatorAnim, {
      toValue: indicatorX,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [indicatorX, levelIndicatorAnim]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: (stepIndex + 1) / CAPTURE_STEPS.length,
      duration: 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [stepIndex, progressAnim]);

  useEffect(() => {
    if (phase !== "capture") return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 680,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 680,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [phase, pulseAnim]);

  useEffect(() => {
    if (phase !== "capture") return;
    if (countdown !== null) return;

    const interval = setInterval(() => {
      void checkPosition();
    }, 900);

    return () => clearInterval(interval);
  }, [phase, countdown, stepIndex, heightCm, stabilityFrames, isDeviceLevel]);

  useEffect(() => {
    const canAutoCapture =
      phase === "capture" &&
      countdown === null &&
      overlay.readyToCapture &&
      overlay.qualityScore >= AUTO_CAPTURE_MIN_QUALITY &&
      stabilityFrames >= 2;

    if (canAutoCapture && !captureTriggered) {
      setCaptureTriggered(true);

      if (autoCaptureTimeoutRef.current) {
        clearTimeout(autoCaptureTimeoutRef.current);
      }

      autoCaptureTimeoutRef.current = setTimeout(() => {
        autoCaptureTimeoutRef.current = null;
        void captureCurrentStep();
      }, 800);
      return;
    }

    if (!canAutoCapture) {
      if (autoCaptureTimeoutRef.current) {
        clearTimeout(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
      if (!overlay.readyToCapture || (gyroAssistEnabled && !isDeviceLevel)) {
        setCaptureTriggered(false);
      }
    }
  }, [phase, countdown, isDeviceLevel, overlay.readyToCapture, overlay.qualityScore, stabilityFrames, captureTriggered, gyroAssistEnabled]);

  useEffect(() => {
    return () => {
      if (autoCaptureTimeoutRef.current) {
        clearTimeout(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
    };
  }, []);

  const silhouettePath = useMemo(() => {
    return buildProjectedSilhouettePath(
      overlay.silhouette,
      overlay.imageWidth,
      overlay.imageHeight,
      previewSize.width,
      previewSize.height
    );
  }, [overlay.silhouette, overlay.imageWidth, overlay.imageHeight, previewSize.width, previewSize.height]);

  const checkPosition = async () => {
    if (!cameraRef.current) return;
    if (checkingRef.current) return;
    if (capturingStepRef.current) return;
    if (!currentStep) return;

    checkingRef.current = true;

    try {
      const photo = await cameraRef.current.takePhoto({
        enableShutterSound: false,
      });

      const formData = new FormData();
      formData.append(
        "image",
        {
          uri: `file://${photo.path}`,
          name: `${currentStep.key}_frame.jpg`,
          type: "image/jpeg",
        } as any
      );
      formData.append("height_cm", heightCm);
      formData.append("view", currentStep.key);
      formData.append("pitch", String(tiltPitchRef.current));
      formData.append("roll", String(tiltRollRef.current));

      const response = await fetch(`${BACKEND}/ai/check-position`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok || data?.error) {
        setErrorMessage(data?.error || "Unable to detect body");
        setStabilityFrames(0);
        setCaptureTriggered(false);
        return;
      }

      const backendReady = Boolean(data.ready_to_capture);
      const readyToCapture = backendReady && (!gyroAssistEnabled || isDeviceLevelRef.current);
      const qualityFromBackend = Number(data.quality_score || 0);
      const qualityPenalty = gyroAssistEnabled && !isDeviceLevelRef.current ? 0.04 : 0.0;
      const stabilizedQuality = clampUnit(qualityFromBackend - qualityPenalty);
      const uiQuality = readyToCapture
        ? clampUnit(Math.max(stabilizedQuality, AUTO_CAPTURE_MIN_QUALITY))
        : clampUnit((stabilizedQuality * 0.9) + 0.05);

      const landmarks = Array.isArray(data.landmarks) ? data.landmarks : [];
      const silhouette = Array.isArray(data.silhouette) ? data.silhouette : [];
      const sourceWidth = Number(data.image_width);
      const sourceHeight = Number(data.image_height);
      const normalizedSourceWidth = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : currentStep ? previewSize.width : screenWidth;
      const normalizedSourceHeight = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : currentStep ? previewSize.height : screenHeight;

      setErrorMessage(null);
      setOverlay((current) => ({
        landmarks: smoothLandmarks(current.landmarks, landmarks, OVERLAY_SMOOTHING_ALPHA),
        silhouette: smoothSilhouette(current.silhouette, silhouette, OVERLAY_SMOOTHING_ALPHA),
        instruction: readyToCapture
          ? "Good position"
          : (!gyroAssistEnabled || isDeviceLevelRef.current)
            ? data.instruction || "Adjust position"
            : "Slightly level phone for cleaner silhouette",
        readyToCapture,
        qualityScore: clampUnit((current.qualityScore * 0.35) + (uiQuality * 0.65)),
        imageWidth: normalizedSourceWidth,
        imageHeight: normalizedSourceHeight,
      }));

      if (readyToCapture) {
        const nextStable = stabilityFrames + 1;
        setStabilityFrames(nextStable);
      } else {
        setStabilityFrames(0);
        setCaptureTriggered(false);
      }
    } catch (error) {
      setErrorMessage("Camera check failed. Try again.");
      setStabilityFrames(0);
      setCaptureTriggered(false);
    } finally {
      checkingRef.current = false;
    }
  };

  const captureCurrentStep = async () => {
    if (!cameraRef.current || !currentStep) return;
    if (capturingStepRef.current) return;
    if (checkingRef.current) {
      setErrorMessage("Preparing frame. Tap capture again in a moment.");
      return;
    }

    capturingStepRef.current = true;
    setIsCapturingStep(true);

    if (autoCaptureTimeoutRef.current) {
      clearTimeout(autoCaptureTimeoutRef.current);
      autoCaptureTimeoutRef.current = null;
    }

    try {
      const burstUris: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const photo = await cameraRef.current.takePhoto({ enableShutterSound: false });
        burstUris.push(`file://${photo.path}`);
      }

      const nextCaptures = {
        ...captures,
        [currentStep.key]: burstUris,
      };
      setCaptures(nextCaptures);
      setStabilityFrames(0);
      setCaptureTriggered(false);
      setCountdown(null);

      if (currentStep.key !== "back") {
        setStepIndex((prev) => prev + 1);
        setOverlay({
          landmarks: [],
          silhouette: [],
          instruction: "Reposition for next view",
          readyToCapture: false,
          qualityScore: 0,
          imageWidth: previewSize.width,
          imageHeight: previewSize.height,
        });
        return;
      }

      setPhase("processing");
      await sendForMeasurement(nextCaptures);
    } catch (error) {
      setErrorMessage("Unable to capture image. Try again.");
      setCaptureTriggered(false);
    } finally {
      capturingStepRef.current = false;
      setIsCapturingStep(false);
    }
  };

  const sendForMeasurement = async (captured: Partial<Record<CaptureStep, string[]>>) => {
    if (!captured.front?.length || !captured.side?.length || !captured.back?.length) {
      setErrorMessage("Missing one or more captures. Please rescan.");
      setPhase("capture");
      setCaptureTriggered(false);
      return;
    }

    const formData = new FormData();

    const appendBurst = (baseName: string, uris: string[]) => {
      const fieldNames = [baseName, `${baseName}_2`, `${baseName}_3`];
      uris.slice(0, 3).forEach((uri, index) => {
        formData.append(
          fieldNames[index],
          {
            uri,
            name: `${baseName}_${index + 1}.jpg`,
            type: "image/jpeg",
          } as any
        );
      });
    };

    appendBurst("front_image", captured.front);
    appendBurst("side_image", captured.side);
    appendBurst("back_image", captured.back);
    formData.append("height_cm", heightCm);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 15000);

    try {
      const response = await fetch(`${BACKEND}/ai/measure`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const text = await response.text();
      console.log("AI RAW RESPONSE:", text);

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        setErrorMessage("Invalid response from server. Please try again.");
        Alert.alert("Scan Failed", "Invalid response from server. Please try again.");
        setPhase("capture");
        return;
      }

      const backendError = data?.error || data?.detail || null;
      if (backendError) {
        setErrorMessage(String(backendError));
        Alert.alert("Scan issue", String(backendError));
      }

      if (!response.ok && (!data?.measurements || typeof data.measurements !== "object")) {
        const message = String(backendError || "Body measurement failed. Please rescan.");
        setErrorMessage(message);
        Alert.alert("Scan Failed", message);
        setPhase("capture");
        setCaptureTriggered(false);
        return;
      }

      if (!data?.measurements || typeof data.measurements !== "object") {
        setErrorMessage("Scan completed but measurements were missing in response.");
        Alert.alert("Scan Failed", "Measurements were missing in response.");
        setPhase("capture");
        setCaptureTriggered(false);
        return;
      }

      const scanResult: ScanResult = {
        measurements: data.measurements,
        measurement_details: data.measurement_details,
        legacy_measurements: data.legacy_measurements,
        quality: data.quality,
        confidence: data.confidence,
        quality_score: data.quality_score,
        warnings: data.warnings || [],
      };

      const defaultInputs = MEASUREMENT_FIELDS.reduce((acc, field) => {
        acc[field.key] = String(scanResult.measurements[field.key] ?? "");
        return acc;
      }, {} as Record<MeasurementKey, string>);
      setEditableInputs(defaultInputs);

      setResult(scanResult);
      setErrorMessage(backendError ? String(backendError) : null);

      const overallConfidence =
        scanResult.quality?.overall_confidence ??
        scanResult.quality_score ??
        scanResult.confidence?.overall ??
        0;

      await AsyncStorage.setItem(
        SCAN_RESULT_STORAGE_KEY,
        JSON.stringify({
          height_cm: Number(heightCm),
          measurements: scanResult.measurements,
          measurement_details: scanResult.measurement_details,
          legacy_measurements: scanResult.legacy_measurements,
          quality: {
            ...(scanResult.quality || {}),
            overall_confidence: Number(overallConfidence),
          },
          confidence: scanResult.confidence,
          quality_score: scanResult.quality_score,
          warnings: scanResult.warnings || [],
        })
      );

      setPhase("done");

      router.replace({
        pathname: "/(auth)/register",
        params: {
          measurements: JSON.stringify(scanResult.measurements),
          height_cm: String(Number(heightCm)),
          warnings: JSON.stringify(scanResult.warnings || []),
          quality_score: String(scanResult.quality_score ?? 0),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setErrorMessage("Scan timed out after 15 seconds. Please try again.");
        Alert.alert("Scan Failed", "Request timed out. Please rescan.");
      } else {
        setErrorMessage("Network error while measuring. Please try again.");
        Alert.alert("Scan Failed", "Network error while measuring. Please try again.");
      }
      setPhase("capture");
      setCaptureTriggered(false);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const resetScan = () => {
    if (autoCaptureTimeoutRef.current) {
      clearTimeout(autoCaptureTimeoutRef.current);
      autoCaptureTimeoutRef.current = null;
    }

    setPhase("capture");
    setStepIndex(0);
    setCaptures({});
    setResult(null);
    setEditableInputs(null);
    setErrorMessage(null);
    setCountdown(null);
    setStabilityFrames(0);
    setCaptureTriggered(false);
    capturingStepRef.current = false;
    setIsCapturingStep(false);
    setIndicatorX(0);
    setOverlay({
      landmarks: [],
      silhouette: [],
      instruction: "Align your body in frame",
      readyToCapture: false,
      qualityScore: 0,
      imageWidth: previewSize.width,
      imageHeight: previewSize.height,
    });
  };

  const onEditMeasurement = (key: MeasurementKey, value: string) => {
    setEditableInputs((current) => {
      if (!current) return current;
      return {
        ...current,
        [key]: value,
      };
    });
  };

  const persistEditedMeasurements = async () => {
    if (!result || !editableInputs) {
      router.back();
      return;
    }

    const updatedMeasurements = MEASUREMENT_FIELDS.reduce((acc, field) => {
      const parsed = Number(editableInputs[field.key]);
      const fallbackValue = Number(result.measurements[field.key] || 0);
      const value = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
      acc[field.key] = Number(value.toFixed(2));
      return acc;
    }, {} as MeasurementSet);

    const overallConfidence =
      result.quality?.overall_confidence ?? result.quality_score ?? result.confidence?.overall ?? 0;

    await AsyncStorage.setItem(
      SCAN_RESULT_STORAGE_KEY,
      JSON.stringify({
        height_cm: Number(heightCm),
        measurements: updatedMeasurements,
        measurement_details: result.measurement_details,
        legacy_measurements: result.legacy_measurements,
        quality: {
          ...(result.quality || {}),
          overall_confidence: Number(overallConfidence),
        },
        confidence: result.confidence,
        quality_score: result.quality_score,
        warnings: result.warnings || [],
      })
    );

    router.back();
  };

  const upDownTilted = Math.abs(gravityZRef.current) > 0.7;
  const levelStatusText = !gyroAssistEnabled
    ? "Tilt assist disabled"
    : upDownTilted
      ? "Reduce forward/back tilt"
      : isDeviceLevel
        ? "Tilt assist: aligned"
        : "Tilt assist: adjust slightly";
  const captureGuidanceText =
    overlay.readyToCapture && overlay.qualityScore >= AUTO_CAPTURE_MIN_QUALITY
      ? "Great framing. Capturing soon..."
      : (gyroAssistEnabled && !isDeviceLevel)
        ? "Body detected. Level phone slightly for best edges."
        : overlay.instruction;
  const overlaySourceWidth = overlay.imageWidth > 0 ? overlay.imageWidth : previewSize.width;
  const overlaySourceHeight = overlay.imageHeight > 0 ? overlay.imageHeight : previewSize.height;

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>Camera permission is required for body scan.</Text>
      </View>
    );
  }

  if (phase === "height") {
    return (
      <View style={styles.heightScreen}>
        <View style={styles.heightCard}>
          <Text style={styles.heightTitle}>Enter Your Height (cm)</Text>
          <Text style={styles.heightSubtext}>Height calibrates all body measurements accurately.</Text>

          <TextInput
            style={styles.heightInput}
            value={heightCm}
            keyboardType="numeric"
            placeholder="e.g. 172"
            placeholderTextColor={Colors.textMuted}
            onChangeText={setHeightCm}
          />

          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              const parsed = Number(heightCm);
              if (!parsed || parsed < 120 || parsed > 230) {
                setErrorMessage("Enter a valid height between 120 and 230 cm.");
                return;
              }
              setErrorMessage(null);
              setPhase("capture");
              setStepIndex(0);
            }}
          >
            <Text style={styles.primaryButtonText}>Continue to Guided Scan</Text>
          </Pressable>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={styles.previewLayer}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0) {
            setPreviewSize({ width, height });
          }
        }}
      >
        {device ? (
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={phase !== "done"}
            photo
            enableZoomGesture
          />
        ) : (
          <View style={styles.centered}>
            <Text style={styles.permissionText}>No camera device found.</Text>
          </View>
        )}

        <Svg style={StyleSheet.absoluteFill}>
        {silhouettePath ? (
          <SvgPath
            d={silhouettePath}
            fill="rgba(20, 184, 166, 0.16)"
            stroke="rgba(20, 184, 166, 0.92)"
            strokeWidth={2}
          />
        ) : null}

        {SKELETON_CONNECTIONS.map(([from, to], index) => {
          const first = overlay.landmarks[from];
          const second = overlay.landmarks[to];
          if (!first || !second) return null;
          if ((first.visibility ?? 0) < MIN_VISIBLE_LANDMARK_CONFIDENCE) return null;
          if ((second.visibility ?? 0) < MIN_VISIBLE_LANDMARK_CONFIDENCE) return null;

          const firstProjected = projectNormalizedPoint(
            first,
            overlaySourceWidth,
            overlaySourceHeight,
            previewSize.width,
            previewSize.height
          );
          const secondProjected = projectNormalizedPoint(
            second,
            overlaySourceWidth,
            overlaySourceHeight,
            previewSize.width,
            previewSize.height
          );
          return (
            <Line
              key={`${from}-${to}-${index}`}
              x1={String(firstProjected.x)}
              y1={String(firstProjected.y)}
              x2={String(secondProjected.x)}
              y2={String(secondProjected.y)}
              stroke="rgba(252, 211, 77, 0.95)"
              strokeWidth={2.2}
            />
          );
        })}

        {overlay.landmarks.map((point, index) => (
          (point.visibility ?? 0) >= MIN_VISIBLE_LANDMARK_CONFIDENCE ? (() => {
            const projected = projectNormalizedPoint(
              point,
              overlaySourceWidth,
              overlaySourceHeight,
              previewSize.width,
              previewSize.height
            );
            return (
              <Circle
                key={`point-${index}`}
                cx={String(projected.x)}
                cy={String(projected.y)}
                r={2.8}
                fill="rgba(255,255,255,0.9)"
              />
            );
          })() : null
        ))}
        </Svg>
      </View>

      <View style={styles.topHUD}>
        <View style={styles.progressCard}>
          <Text style={styles.stepText}>{currentStep?.title || "Preparing scan"}</Text>
          <Text style={styles.hintText}>{currentStep?.hint || ""}</Text>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>
        </View>
      </View>

      {phase === "capture" ? (
        <View pointerEvents="none" style={styles.levelOverlay}>
          <View style={[styles.levelBar, isDeviceLevel ? styles.levelBarAligned : styles.levelBarTilted]}>
            <Animated.View
              style={[
                styles.levelDot,
                isDeviceLevel ? styles.levelDotAligned : styles.levelDotTilted,
                {
                  transform: [
                    { translateX: levelIndicatorAnim },
                    {
                      scale: isDeviceLevel
                        ? pulseAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.14],
                          })
                        : 1,
                    },
                  ],
                },
              ]}
            />
          </View>
          <Text style={[styles.levelText, isDeviceLevel ? styles.levelTextAligned : styles.levelTextTilted]}>
            {levelStatusText}
          </Text>
        </View>
      ) : null}

      <View style={styles.bottomHUD}>
        {phase === "processing" ? (
          <View style={styles.statusCard}>
            <ActivityIndicator color={Colors.textInverted} />
            <Text style={styles.statusText}>Processing 3-view body measurements...</Text>
          </View>
        ) : null}

        {phase === "capture" ? (
          <>
            <Animated.View
              style={[
                styles.statusCard,
                {
                  transform: [
                    {
                      scale: pulseAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.03],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  gyroAssistEnabled && !isDeviceLevel
                    ? styles.statusTextTilted
                    : overlay.readyToCapture && overlay.qualityScore >= AUTO_CAPTURE_MIN_QUALITY
                      ? styles.statusTextAligned
                      : null,
                ]}
              >
                {captureGuidanceText}
              </Text>
              <Text style={styles.qualityText}>Quality {(overlay.qualityScore * 100).toFixed(0)}%</Text>
              {countdown !== null ? <Text style={styles.countdownText}>{countdown}</Text> : null}
            </Animated.View>

            <View style={styles.captureActionRow}>
              <Pressable
                style={[styles.captureNowButton, isCapturingStep ? styles.captureNowButtonDisabled : null]}
                disabled={isCapturingStep}
                onPress={() => void captureCurrentStep()}
              >
                {isCapturingStep ? (
                  <ActivityIndicator color={Colors.textInverted} size="small" />
                ) : (
                  <Text style={styles.captureNowButtonText}>Capture This View</Text>
                )}
              </Pressable>

              <Pressable
                style={styles.gyroToggleButton}
                onPress={() => {
                  setGyroAssistEnabled((previous) => !previous);
                  setCaptureTriggered(false);
                  setStabilityFrames(0);
                }}
              >
                <Text style={styles.gyroToggleText}>
                  {gyroAssistEnabled ? "Disable Tilt Assist" : "Enable Tilt Assist"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {phase === "done" && result ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Scan Complete</Text>

            <Text style={styles.resultMeta}>
              Confidence {((result.quality_score ?? result.quality?.overall_confidence ?? 0) * 100).toFixed(0)}%
            </Text>

            <View style={styles.editGrid}>
              {MEASUREMENT_FIELDS.map((field) => (
                <View key={field.key} style={styles.editRow}>
                  <Text style={styles.editLabel}>{field.label}</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editableInputs?.[field.key] ?? String(result.measurements[field.key] ?? "")}
                    keyboardType="decimal-pad"
                    onChangeText={(value) => onEditMeasurement(field.key, value)}
                  />
                </View>
              ))}
            </View>

            {(result.warnings || []).map((warning, index) => (
              <Text key={`${warning}-${index}`} style={styles.warningLine}>
                {warning}
              </Text>
            ))}

            <Pressable style={styles.primaryButton} onPress={persistEditedMeasurements}>
              <Text style={styles.primaryButtonText}>Use Measurements</Text>
            </Pressable>

            <Pressable style={styles.secondaryButton} onPress={resetScan}>
              <Text style={styles.secondaryButtonText}>Scan Again</Text>
            </Pressable>
          </View>
        ) : null}

        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
  },
  previewLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020617",
    paddingHorizontal: Spacing.containerPadding,
  },
  permissionText: {
    fontFamily: Fonts.body,
    color: Colors.textInverted,
    fontSize: 15,
    textAlign: "center",
  },
  heightScreen: {
    flex: 1,
    backgroundColor: "#03131A",
    justifyContent: "center",
    paddingHorizontal: Spacing.containerPadding,
  },
  heightCard: {
    backgroundColor: "rgba(9, 33, 41, 0.92)",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: "rgba(45, 212, 191, 0.28)",
    padding: 22,
  },
  heightTitle: {
    fontFamily: Fonts.heading,
    color: Colors.textInverted,
    fontSize: 30,
    marginBottom: 8,
  },
  heightSubtext: {
    fontFamily: Fonts.body,
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    marginBottom: 18,
    lineHeight: 20,
  },
  heightInput: {
    height: 54,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.text,
    textAlign: "center",
    marginBottom: 14,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  primaryButtonText: {
    fontFamily: Fonts.bodyBold,
    color: Colors.textInverted,
    fontSize: 15,
  },
  secondaryButton: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryButtonText: {
    fontFamily: Fonts.bodyBold,
    color: Colors.textInverted,
    fontSize: 14,
  },
  topHUD: {
    position: "absolute",
    top: 54,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.containerPadding,
  },
  progressCard: {
    borderRadius: Radius.lg,
    backgroundColor: "rgba(2, 6, 23, 0.66)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    padding: 14,
  },
  stepText: {
    fontFamily: Fonts.bodyBold,
    color: Colors.textInverted,
    fontSize: 16,
  },
  hintText: {
    fontFamily: Fonts.body,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    marginTop: 4,
    marginBottom: 10,
  },
  progressTrack: {
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryLight,
  },
  levelOverlay: {
    position: "absolute",
    top: 126,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  levelBar: {
    width: 200,
    height: 20,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
  },
  levelBarTilted: {
    backgroundColor: "rgba(31, 41, 55, 0.9)",
    borderColor: "rgba(248, 113, 113, 0.55)",
  },
  levelBarAligned: {
    backgroundColor: "rgba(20, 83, 45, 0.9)",
    borderColor: "rgba(74, 222, 128, 0.7)",
  },
  levelDot: {
    position: "absolute",
    top: 1,
    left: 90,
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  levelDotTilted: {
    backgroundColor: "#EF4444",
  },
  levelDotAligned: {
    backgroundColor: "#22C55E",
  },
  levelText: {
    marginTop: 6,
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
  },
  levelTextTilted: {
    color: "#FCA5A5",
  },
  levelTextAligned: {
    color: "#86EFAC",
  },
  bottomHUD: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 30,
    paddingHorizontal: Spacing.containerPadding,
    alignItems: "center",
  },
  statusCard: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
    backgroundColor: "rgba(2, 6, 23, 0.74)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  captureActionRow: {
    width: "100%",
    marginTop: 10,
    gap: 10,
  },
  captureNowButton: {
    borderRadius: Radius.full,
    backgroundColor: "rgba(20, 184, 166, 0.92)",
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  captureNowButtonDisabled: {
    opacity: 0.65,
  },
  captureNowButtonText: {
    fontFamily: Fonts.bodyBold,
    color: Colors.textInverted,
    fontSize: 14,
  },
  gyroToggleButton: {
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    paddingVertical: 10,
    alignItems: "center",
  },
  gyroToggleText: {
    fontFamily: Fonts.ui,
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
  },
  statusText: {
    fontFamily: Fonts.bodyBold,
    color: Colors.textInverted,
    fontSize: 16,
    textAlign: "center",
  },
  statusTextTilted: {
    color: "#FCA5A5",
  },
  statusTextAligned: {
    color: "#86EFAC",
  },
  qualityText: {
    marginTop: 4,
    fontFamily: Fonts.ui,
    color: "rgba(255,255,255,0.84)",
    fontSize: 13,
  },
  countdownText: {
    marginTop: 4,
    fontFamily: Fonts.bodyBold,
    color: "#FCD34D",
    fontSize: 44,
    lineHeight: 52,
  },
  resultCard: {
    width: "100%",
    borderRadius: Radius.lg,
    backgroundColor: "rgba(2, 6, 23, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    padding: 18,
  },
  resultTitle: {
    fontFamily: Fonts.heading,
    color: Colors.textInverted,
    fontSize: 26,
    marginBottom: 10,
    textAlign: "center",
  },
  resultLine: {
    fontFamily: Fonts.body,
    color: Colors.textInverted,
    fontSize: 15,
    marginBottom: 4,
  },
  resultMeta: {
    fontFamily: Fonts.ui,
    color: "rgba(255,255,255,0.84)",
    fontSize: 13,
    marginBottom: 10,
    textAlign: "center",
  },
  editGrid: {
    width: "100%",
    marginBottom: 6,
  },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  editLabel: {
    width: 92,
    fontFamily: Fonts.body,
    color: Colors.textInverted,
    fontSize: 14,
  },
  editInput: {
    flex: 1,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "rgba(255,255,255,0.08)",
    color: Colors.textInverted,
    fontFamily: Fonts.bodyBold,
    paddingHorizontal: 12,
  },
  warningLine: {
    fontFamily: Fonts.body,
    color: "#FCD34D",
    fontSize: 12,
    marginBottom: 4,
  },
  errorText: {
    marginTop: 10,
    fontFamily: Fonts.bodyBold,
    color: "#FCA5A5",
    fontSize: 13,
    textAlign: "center",
  },
});