import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";

type ScanStep = "front" | "side" | "back" | "processing" | "done";

type ApiResponse = {
  measurements: {
    shoulder: number;
    chest: number;
    waist: number;
    hip: number;
    arm: number;
    leg: number;
    inseam: number;
    neck: number;
    thigh: number;
  };
  mesh: string;
  texture: string;
};

const API_BASE_URL = "http://10.171.61.15:8000";

export default function ScanBodyScreen() {
  const device = useCameraDevice("back");
  const cameraRef = useRef<Camera>(null);

  const [hasPermission, setHasPermission] = useState(false);
  const [heightCm, setHeightCm] = useState("");
  const [step, setStep] = useState<ScanStep>("front");

  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [sideUri, setSideUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);

  const [result, setResult] = useState<ApiResponse | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === "granted");
    })();
  }, []);

  const canStart = useMemo(() => Number(heightCm) > 100 && Number(heightCm) < 240, [heightCm]);

  const captureCurrentStep = async () => {
    if (!cameraRef.current || !canStart || uploading) return;

    try {
      const shot = await cameraRef.current.takePhoto();
      const uri = `file://${shot.path}`;

      if (step === "front") {
        setFrontUri(uri);
        setStep("side");
        return;
      }
      if (step === "side") {
        setSideUri(uri);
        setStep("back");
        return;
      }
      if (step === "back") {
        setBackUri(uri);
        setStep("processing");
        await sendScan(frontUri, sideUri, uri);
      }
    } catch (error) {
      Alert.alert("Capture failed", "Please try again.");
      console.log(error);
    }
  };

  const sendScan = async (front: string | null, side: string | null, back: string | null) => {
    if (!front || !side || !back) {
      Alert.alert("Missing photo", "Please recapture all 3 views.");
      setStep("front");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("height_cm", heightCm);
      formData.append("front_image", { uri: front, name: "front.jpg", type: "image/jpeg" } as never);
      formData.append("side_image", { uri: side, name: "side.jpg", type: "image/jpeg" } as never);
      formData.append("back_image", { uri: back, name: "back.jpg", type: "image/jpeg" } as never);

      const response = await fetch(`${API_BASE_URL}/ai/scan-body`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data: ApiResponse = await response.json();
      setResult(data);
      setStep("done");
    } catch (error) {
      console.log(error);
      Alert.alert("Scan failed", "We could not process your scan. Please try again.");
      setStep("front");
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setStep("front");
    setResult(null);
    setFrontUri(null);
    setSideUri(null);
    setBackUri(null);
  };

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>Camera permission is required.</Text>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#0F766E" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {step !== "done" && (
        <>
          <Camera ref={cameraRef} style={styles.camera} device={device} isActive photo />
          <View style={styles.overlay}>
            <Text style={styles.title}>Stitchly Body Scan</Text>
            <Text style={styles.subtitle}>Capture: {step.toUpperCase()} VIEW</Text>

            <TextInput
              placeholder="Height in cm"
              keyboardType="numeric"
              value={heightCm}
              onChangeText={setHeightCm}
              style={styles.input}
              editable={!uploading}
            />

            <Pressable
              style={[styles.button, (!canStart || step === "processing") && styles.buttonDisabled]}
              onPress={captureCurrentStep}
              disabled={!canStart || step === "processing"}
            >
              {step === "processing" ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Capture {step}</Text>}
            </Pressable>

            <View style={styles.thumbnailRow}>
              {frontUri && <Image source={{ uri: frontUri }} style={styles.thumbnail} />}
              {sideUri && <Image source={{ uri: sideUri }} style={styles.thumbnail} />}
              {backUri && <Image source={{ uri: backUri }} style={styles.thumbnail} />}
            </View>
          </View>
        </>
      )}

      {step === "done" && result && (
        <ScrollView contentContainerStyle={styles.resultCard}>
          <Text style={styles.title}>Scan Complete</Text>
          {Object.entries(result.measurements).map(([key, value]) => (
            <Text key={key} style={styles.measurementText}>
              {key}: {value} cm
            </Text>
          ))}
          <Text style={styles.pathText}>Mesh: {result.mesh}</Text>
          <Text style={styles.pathText}>Texture: {result.texture}</Text>
          <Pressable style={styles.button} onPress={reset}>
            <Text style={styles.buttonText}>Scan Again</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  camera: { flex: 1 },
  overlay: { position: "absolute", left: 16, right: 16, bottom: 24, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, padding: 14 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700" },
  subtitle: { color: "#E5E7EB", marginTop: 4, marginBottom: 10 },
  input: { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  button: { backgroundColor: "#0F766E", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "700" },
  thumbnailRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  thumbnail: { width: 56, height: 56, borderRadius: 6, borderWidth: 1, borderColor: "#fff" },
  resultCard: { padding: 20, gap: 8, backgroundColor: "#111", minHeight: "100%" },
  measurementText: { color: "#fff", fontSize: 16 },
  pathText: { color: "#9CA3AF", fontSize: 12 },
});
