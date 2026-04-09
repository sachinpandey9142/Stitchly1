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
  const isDeviceLevelRef = useRef(false);
  const gravityXRef = useRef(0);
  const gravityYRef = useRef(0);
  const gravityZRef = useRef(0);
  const autoCaptureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const device = useCameraDevice("back");

  const [hasPermission, setHasPermission] = useState(false);
  const [heightCm, setHeightCm] = useState("");
  const [phase, setPhase] = useState<"height" | "capture" | "processing" | "done">("height");
  const [isDeviceLevel, setIsDeviceLevel] = useState(false);
  const [indicatorX, setIndicatorX] = useState(0);
  const [captureTriggered, setCaptureTriggered] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [stabilityFrames, setStabilityFrames] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [editableInputs, setEditableInputs] = useState<Record<MeasurementKey, string> | null>(null);

  const [captures, setCaptures] = useState<Partial<Record<CaptureStep, string[]>>>({});
  const [overlay, setOverlay] = useState<OverlayState>({
    landmarks: [],
    silhouette: [],
    instruction: "Align your body in frame",
    readyToCapture: false,
    qualityScore: 0,
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

      gravityXRef.current = Number.isFinite(gx) ? gx : 0;
      gravityYRef.current = Number.isFinite(gy) ? gy : 0;
      gravityZRef.current = Number.isFinite(gz) ? gz : 0;

      const tolerance = 0.35;
      const isVertical = Math.abs(gravityZRef.current) < tolerance;
      const isStraight = Math.abs(gravityYRef.current) < tolerance;
      const level = isVertical && isStraight;

      const normalized = Math.max(-1, Math.min(1, gravityXRef.current));
      setIndicatorX(normalized * LEVEL_BAR_TRAVEL);

      isDeviceLevelRef.current = level;
      setIsDeviceLevel(level);

      if (!level) {
        setCaptureTriggered(false);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

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
    }, 1600);

    return () => clearInterval(interval);
  }, [phase, countdown, stepIndex, heightCm, stabilityFrames, isDeviceLevel]);

  useEffect(() => {
    const canAutoCapture =
      phase === "capture" &&
      countdown === null &&
      isDeviceLevel &&
      overlay.readyToCapture &&
      overlay.qualityScore >= 0.8 &&
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
      if (!isDeviceLevel || !overlay.readyToCapture) {
        setCaptureTriggered(false);
      }
    }
  }, [phase, countdown, isDeviceLevel, overlay.readyToCapture, overlay.qualityScore, stabilityFrames, captureTriggered]);

  useEffect(() => {
    return () => {
      if (autoCaptureTimeoutRef.current) {
        clearTimeout(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
    };
  }, []);

  const silhouettePath = useMemo(() => {
    if (!overlay.silhouette || overlay.silhouette.length < 3) return "";

    let path = "";
    overlay.silhouette.forEach((point, index) => {
      const x = point.x * screenWidth;
      const y = point.y * screenHeight;
      path += `${index === 0 ? "M" : "L"} ${x} ${y} `;
    });
    return `${path} Z`;
  }, [overlay.silhouette]);

  const checkPosition = async () => {
    if (!cameraRef.current) return;
    if (checkingRef.current) return;
    if (!currentStep) return;
    if (!isDeviceLevelRef.current) {
      const upDownTilted = Math.abs(gravityZRef.current) > 0.7;
      setOverlay((current) => ({
        ...current,
        instruction: upDownTilted ? "Do not point camera up/down" : "Tilt phone to align",
        readyToCapture: false,
        qualityScore: Math.min(Number(current.qualityScore || 0), 0.25),
      }));
      setErrorMessage(null);
      setStabilityFrames(0);
      setCaptureTriggered(false);
      return;
    }

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

      const readyToCapture = Boolean(data.ready_to_capture) && isDeviceLevelRef.current;

      setErrorMessage(null);
      setOverlay({
        landmarks: data.landmarks || [],
        silhouette: data.silhouette || [],
        instruction: readyToCapture ? data.instruction || "Adjust position" : data.instruction || "Adjust position",
        readyToCapture,
        qualityScore: readyToCapture
          ? Number(data.quality_score || 0)
          : Math.min(Number(data.quality_score || 0), 0.25),
      });

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
    if (!isDeviceLevelRef.current) {
      setErrorMessage(null);
      setStabilityFrames(0);
      setCaptureTriggered(false);
      return;
    }

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
        });
        return;
      }

      setPhase("processing");
      await sendForMeasurement(nextCaptures);
    } catch (error) {
      setErrorMessage("Unable to capture image. Try again.");
      setCaptureTriggered(false);
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
    setIndicatorX(0);
    setOverlay({
      landmarks: [],
      silhouette: [],
      instruction: "Align your body in frame",
      readyToCapture: false,
      qualityScore: 0,
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
  const levelStatusText = upDownTilted
    ? "Do not point camera up/down"
    : isDeviceLevel
      ? "Perfect! Hold still..."
      : "Tilt phone to align";
  const captureGuidanceText =
    upDownTilted
      ? "Do not point camera up/down"
      : !isDeviceLevel
        ? "Tilt phone to align"
      : overlay.readyToCapture && overlay.qualityScore >= 0.8
        ? "Perfect! Hold still..."
        : overlay.instruction;

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
          return (
            <Line
              key={`${from}-${to}-${index}`}
              x1={String(first.x * screenWidth)}
              y1={String(first.y * screenHeight)}
              x2={String(second.x * screenWidth)}
              y2={String(second.y * screenHeight)}
              stroke="rgba(252, 211, 77, 0.95)"
              strokeWidth={2.2}
            />
          );
        })}

        {overlay.landmarks.map((point, index) => (
          <Circle
            key={`point-${index}`}
            cx={String(point.x * screenWidth)}
            cy={String(point.y * screenHeight)}
            r={2.8}
            fill="rgba(255,255,255,0.9)"
          />
        ))}
      </Svg>

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
                !isDeviceLevel
                  ? styles.statusTextTilted
                  : overlay.readyToCapture && overlay.qualityScore >= 0.8
                    ? styles.statusTextAligned
                    : null,
              ]}
            >
              {captureGuidanceText}
            </Text>
            <Text style={styles.qualityText}>Quality {(overlay.qualityScore * 100).toFixed(0)}%</Text>
            {countdown !== null ? <Text style={styles.countdownText}>{countdown}</Text> : null}
          </Animated.View>
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