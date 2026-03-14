import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Dimensions,
} from "react-native";

import { Camera, useCameraDevice } from "react-native-vision-camera";
import { useRouter } from "expo-router";
import Svg, { Circle, Line } from "react-native-svg";

const { height, width } = Dimensions.get("window");

const BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL || "http://10.171.61.15:8000";

/* ============================= */
/* Skeleton connections          */
/* ============================= */

const connections = [
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

/* ============================= */
/* Component                     */
/* ============================= */

export default function ScanBody() {
  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const router = useRouter();

  const [permission, setPermission] = useState(false);

  const [heightCm, setHeightCm] = useState("");
  const [startScan, setStartScan] = useState(false);

  const [step, setStep] = useState<
    "front" | "side" | "back" | "processing" | "done"
  >("front");

  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [sideImage, setSideImage] = useState<string | null>(null);

  const [landmarks, setLandmarks] = useState<any[]>([]);
  const [measurements, setMeasurements] = useState<any>(null);

  const [stableFrames, setStableFrames] = useState(0);
  const [shoulderHistory, setShoulderHistory] = useState<number[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);

  const [positionMessage, setPositionMessage] = useState(
    "Align your body inside the outline"
  );

  const checkingRef = useRef(false);

  /* ============================= */
  /* Camera Permission             */
  /* ============================= */

  useEffect(() => {
    const init = async () => {
      const status = await Camera.getCameraPermissionStatus();

      if (status === "granted") {
        setPermission(true);
        return;
      }

      const newStatus = await Camera.requestCameraPermission();
      setPermission(newStatus === "granted");
    };

    init();
  }, []);

  /* ============================= */
  /* Position Loop                 */
  /* ============================= */

  useEffect(() => {
    if (!startScan) return;
    if (step === "processing" || step === "done") return;

    const interval = setInterval(checkBodyPosition, 900);

    return () => clearInterval(interval);
  }, [startScan, step, stableFrames, countdown]);

  /* ============================= */
  /* Position Check                */
  /* ============================= */

  const checkBodyPosition = async () => {
    if (!camera.current) return;
    if (checkingRef.current) return;
    if (countdown !== null) return;

    checkingRef.current = true;

    try {
      const photo = await camera.current.takePhoto({
        qualityPrioritization: "speed",
      });

      const imagePath = "file://" + photo.path;

      const formData = new FormData();

      formData.append(
        "image",
        {
          uri: imagePath,
          name: "frame.jpg",
          type: "image/jpeg",
        } as any
      );

      formData.append("height_cm", heightCm);

      const res = await fetch(`${BACKEND}/ai/check-position`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      setLandmarks(data.landmarks || []);

      if (!data.landmarks || data.landmarks.length < 28) {
        setPositionMessage("Move into frame");
        setStableFrames(0);
        return;
      }

      const head = data.landmarks[0];
      const ankle = data.landmarks[27];

      const bodyHeight = Math.abs(head.y - ankle.y);

      if (bodyHeight < 0.45) {
        setPositionMessage("Step back - full body required");
        setStableFrames(0);
        return;
      }

      const shoulderRaw = data.measurements?.shoulder_width_cm || 0;

      const history = [...shoulderHistory, shoulderRaw].slice(-5);
      setShoulderHistory(history);

      const shoulder =
        history.reduce((a, b) => a + b, 0) / history.length;

      if (shoulder < 30) {
        setPositionMessage("Move closer");
        setStableFrames(0);
        return;
      }

      if (shoulder > 60) {
        setPositionMessage("Move back");
        setStableFrames(0);
        return;
      }

      if (data.instruction) {
        setPositionMessage(data.instruction);
        setStableFrames(0);
        return;
      }

      setPositionMessage("Perfect Position");

      const frames = stableFrames + 1;
      setStableFrames(frames);

      if (frames >= 2) startCountdown();
    } catch (err) {
      console.log("Position error", err);
    }

    checkingRef.current = false;
  };

  /* ============================= */
  /* Countdown                     */
  /* ============================= */

  const startCountdown = () => {
    if (countdown !== null) return;

    setCountdown(3);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (!prev) return null;

        if (prev === 1) {
          clearInterval(timer);
          takePicture();
          setStableFrames(0);
          return null;
        }

        return prev - 1;
      });
    }, 1000);
  };

  /* ============================= */
  /* Capture                       */
  /* ============================= */

  const takePicture = async () => {
    if (!camera.current) return;

    try {
      const photo = await camera.current.takePhoto();
      const uri = "file://" + photo.path;

      if (step === "front") {
        setFrontImage(uri);
        setStep("side");
      } else if (step === "side") {
        setSideImage(uri);
        setStep("back");
      } else if (step === "back") {
        setStep("processing");
        sendToBackend(frontImage, sideImage, uri);
      }
    } catch (err) {
      console.log("capture error", err);
    }
  };

  /* ============================= */
  /* Backend                       */
  /* ============================= */

  const sendToBackend = async (
    front: string | null,
    side: string | null,
    back: string | null
  ) => {
    if (!front || !side || !back) return;

    const formData = new FormData();

    formData.append("front_image", {
      uri: front,
      name: "front.jpg",
      type: "image/jpeg",
    } as any);

    formData.append("side_image", {
      uri: side,
      name: "side.jpg",
      type: "image/jpeg",
    } as any);

    formData.append("back_image", {
      uri: back,
      name: "back.jpg",
      type: "image/jpeg",
    } as any);

    formData.append("height_cm", heightCm);

    try {
      const res = await fetch(`${BACKEND}/ai/scan-body`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      setMeasurements(data.measurements);
      setStep("done");
    } catch (err) {
      console.log("AI error", err);
    }
  };

  /* ============================= */
  /* UI                            */
  /* ============================= */

  if (!permission)
    return (
      <View style={styles.center}>
        <Text>Camera permission required</Text>
      </View>
    );

  return (
    <View style={styles.container}>
      {!startScan ? (
        <View style={styles.heightContainer}>
          <Text style={styles.heightTitle}>Enter Your Height</Text>

          <TextInput
            style={styles.heightInput}
            value={heightCm}
            keyboardType="numeric"
            placeholder="Height in cm"
            onChangeText={setHeightCm}
          />

          <Pressable
            style={styles.startButton}
            onPress={() => {
              if (!heightCm) {
                alert("Enter your height");
                return;
              }
              setStartScan(true);
            }}
          >
            <Text style={{ color: "white" }}>Start Scan</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {device && (
            <Camera
              ref={camera}
              style={StyleSheet.absoluteFill}
              device={device}
              isActive
              photo
              fps={30}
            />
          )}

          {/* Skeleton Overlay */}

          <Svg style={StyleSheet.absoluteFill}>
            {connections.map(([a, b], i) => {
              const p1 = landmarks[a];
              const p2 = landmarks[b];

              if (!p1 || !p2) return null;

              return (
                <Line
                  key={i}
                  x1={`${p1.x * 100}%`}
                  y1={`${p1.y * 100}%`}
                  x2={`${p2.x * 100}%`}
                  y2={`${p2.y * 100}%`}
                  stroke="lime"
                  strokeWidth="2"
                />
              );
            })}

            {landmarks.map((p, i) => (
              <Circle
                key={i}
                cx={`${p.x * 100}%`}
                cy={`${p.y * 100}%`}
                r="4"
                fill="lime"
              />
            ))}
          </Svg>

          {/* Overlay UI */}

          <View style={styles.overlay}>
            <Text style={styles.stepTitle}>
              {step === "front" && "Front Scan"}
              {step === "side" && "Turn Side"}
              {step === "back" && "Turn Back"}
            </Text>

            <Text style={styles.instructions}>
              {positionMessage}
            </Text>

            {countdown !== null && (
              <Text style={styles.countdown}>{countdown}</Text>
            )}

            {step === "processing" && (
              <>
                <ActivityIndicator size="large" color="white" />
                <Text style={styles.instructions}>
                  Processing body scan...
                </Text>
              </>
            )}

            {step === "done" && measurements && (
              <View style={styles.resultBox}>
                <Text style={styles.resultTitle}>Measurements</Text>

                <Text style={styles.resultText}>
                  Shoulder: {measurements.shoulder_width_cm} cm
                </Text>

                <Text style={styles.resultText}>
                  Hip: {measurements.hip_width_cm} cm
                </Text>

                <Pressable
                  style={styles.doneButton}
                  onPress={() => router.back()}
                >
                  <Text style={{ color: "white" }}>
                    Use Measurements
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/* ============================= */
/* Styles                        */
/* ============================= */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  overlay: {
    position: "absolute",
    bottom: 60,
    width: "100%",
    alignItems: "center",
  },

  instructions: { color: "white", fontSize: 16, marginTop: 10 },

  countdown: {
    fontSize: 80,
    color: "white",
    fontWeight: "bold",
  },

  heightContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "black",
  },

  heightTitle: {
    fontSize: 28,
    color: "white",
    marginBottom: 30,
  },

  heightInput: {
    backgroundColor: "white",
    width: 200,
    height: 50,
    borderRadius: 10,
    textAlign: "center",
    fontSize: 18,
    marginBottom: 30,
  },

  startButton: {
    backgroundColor: "#0F766E",
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
  },

  stepTitle: {
    color: "white",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 10,
  },

  resultBox: {
    backgroundColor: "rgba(0,0,0,0.8)",
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
  },

  resultTitle: {
    color: "white",
    fontSize: 22,
    marginBottom: 10,
  },

  resultText: {
    color: "white",
    fontSize: 18,
    marginBottom: 5,
  },

  doneButton: {
    marginTop: 20,
    backgroundColor: "green",
    padding: 12,
    borderRadius: 8,
  },
});