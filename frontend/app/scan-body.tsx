import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Dimensions
} from "react-native";

import { Camera, useCameraDevice } from "react-native-vision-camera";
import { useRouter } from "expo-router";
import Svg, { Circle, Line } from "react-native-svg";

const { height, width } = Dimensions.get("window");

/* ============================= */
/* Skeleton connections          */
/* ============================= */

const connections = [
  [11,12],
  [11,13],
  [13,15],
  [12,14],
  [14,16],
  [11,23],
  [12,24],
  [23,24],
  [23,25],
  [25,27],
  [24,26],
  [26,28]
];

/* ============================= */
/* Body Outline UI               */
/* ============================= */

function BodyOutline() {
  return (
    <View style={outlineStyles.container}>
      <View style={outlineStyles.head} />
      <View style={outlineStyles.body} />
      <View style={outlineStyles.legsContainer}>
        <View style={outlineStyles.leg} />
        <View style={outlineStyles.leg} />
      </View>
    </View>
  );
}

/* ============================= */
/* Main Component                */
/* ============================= */

export default function ScanBody() {

  const device = useCameraDevice("back");
  const camera = useRef<Camera>(null);
  const router = useRouter();

  const [hasPermission, setHasPermission] = useState(false);

  const [heightCm, setHeightCm] = useState("");
  const [startScan, setStartScan] = useState(false);

  const [step, setStep] = useState<"front"|"side"|"back"|"processing"|"done">("front");

  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [sideImage, setSideImage] = useState<string | null>(null);

  const [landmarks, setLandmarks] = useState<any[]>([]);
  const [measurements, setMeasurements] = useState<any>(null);

  const [positionMessage,setPositionMessage] = useState(
    "Align your body inside the outline"
  );

  /* ============================= */
  /* Camera Permission             */
  /* ============================= */

  useEffect(() => {

    const checkPermission = async () => {

      const status = await Camera.getCameraPermissionStatus();

      if (status === "granted") {
        setHasPermission(true);
        return;
      }

      const newStatus = await Camera.requestCameraPermission();

      if (newStatus === "granted") {
        setHasPermission(true);
      }

    };

    checkPermission();

  }, []);

  /* ============================= */
  /* Position Checking Loop        */
  /* ============================= */

  useEffect(() => {

    if (!startScan) return;

    const interval = setInterval(() => {

      checkBodyPosition();

    }, 1500);

    return () => clearInterval(interval);

  }, [startScan]);

  /* ============================= */
  /* Check Body Position           */
  /* ============================= */

  const checkBodyPosition = async () => {

    if (!camera.current) return;

    try {

      const photo = await camera.current.takePhoto({
        qualityPrioritization:"speed"
      });

      const imagePath = "file://" + photo.path;

      const formData = new FormData();

      formData.append("image",{
        uri:imagePath,
        name:"frame.jpg",
        type:"image/jpeg"
      } as any);

      formData.append("height_cm",heightCm);

      const response = await fetch(
        "http://10.171.61.15:8000/ai/check-position",
        {
          method:"POST",
          body:formData
        }
      );

      const data = await response.json();

      setLandmarks(data.landmarks || []);

      if (!data.measurements) {
        setPositionMessage("Move into frame");
        return;
      }

      const shoulder = data.measurements.shoulder_width_cm;

      if (shoulder < 30) {
        setPositionMessage("Move Closer");
      }
      else if (shoulder > 60) {
        setPositionMessage("Move Back");
      }
      else {
        setPositionMessage("Perfect Position");

        setTimeout(() => {
          takePicture();
        },1200);
      }

    } catch(err) {
      console.log("Position check error:",err);
    }

  };

  /* ============================= */
  /* Capture Images                */
  /* ============================= */

  const takePicture = async () => {

    if (!camera.current) return;

    try {

      const photo = await camera.current.takePhoto();

      const imagePath = "file://" + photo.path;

      if (step === "front") {

        setFrontImage(imagePath);
        setStep("side");

      }

      else if (step === "side") {

        setSideImage(imagePath);
        setStep("back");

      }

      else if (step === "back") {

        setStep("processing");

        sendToBackend(
          frontImage,
          sideImage,
          imagePath
        );

      }

    } catch(error) {

      console.log("Capture error:",error);

    }

  };

  /* ============================= */
  /* Send Images to Backend        */
  /* ============================= */

  const sendToBackend = async (
    frontUri:string | null,
    sideUri:string | null,
    backUri:string | null
  ) => {

    if (!frontUri || !sideUri || !backUri) return;

    try {

      const formData = new FormData();

      formData.append("front_image",{
        uri:frontUri,
        name:"front.jpg",
        type:"image/jpeg"
      } as any);

      formData.append("side_image",{
        uri:sideUri,
        name:"side.jpg",
        type:"image/jpeg"
      } as any);

      formData.append("back_image",{
        uri:backUri,
        name:"back.jpg",
        type:"image/jpeg"
      } as any);

      formData.append("height_cm",heightCm);

      const response = await fetch(
        "http://10.171.61.15:8000/ai/scan-body",
        {
          method:"POST",
          body:formData
        }
      );

      const data = await response.json();

      setMeasurements(data.measurements);
      setStep("done");

    } catch(err) {

      console.log("AI request error:",err);

    }

  };

  /* ============================= */
  /* UI                            */
  /* ============================= */

  return (

    <View style={styles.container}>

      {!hasPermission && (
        <View style={styles.center}>
          <Text>Camera permission required</Text>
        </View>
      )}

      {hasPermission && !startScan && (

        <View style={styles.heightContainer}>

          <Text style={styles.heightTitle}>
            Enter Your Height
          </Text>

          <TextInput
            placeholder="Height in cm"
            keyboardType="numeric"
            value={heightCm}
            onChangeText={setHeightCm}
            style={styles.heightInput}
          />

          <Pressable
            style={styles.startButton}
            onPress={()=>{
              if (!heightCm){
                alert("Please enter your height");
                return;
              }
              setStartScan(true);
            }}
          >

            <Text style={{color:"white",fontSize:18}}>
              Start Scan
            </Text>

          </Pressable>

        </View>

      )}

      {hasPermission && startScan && device && (

      <>

        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          photo={true}
        />

        <Svg
          style={{
            position:"absolute",
            width:"100%",
            height:"100%"
          }}
        >

          {connections.map(([a,b],i)=>{

            const p1 = landmarks[a];
            const p2 = landmarks[b];

            if(!p1 || !p2) return null;

            return(
              <Line
                key={i}
                x1={`${p1.x*100}%`}
                y1={`${p1.y*100}%`}
                x2={`${p2.x*100}%`}
                y2={`${p2.y*100}%`}
                stroke="lime"
                strokeWidth="2"
              />
            )

          })}

          {landmarks.map((p,i)=>(
            <Circle
              key={i}
              cx={`${p.x*100}%`}
              cy={`${p.y*100}%`}
              r="4"
              fill="lime"
            />
          ))}

        </Svg>

        <BodyOutline/>

        <View style={styles.overlay}>

          {step === "processing" && (
            <>
              <ActivityIndicator size="large" color="white"/>
              <Text style={styles.instructions}>
                Analyzing body measurements...
              </Text>
            </>
          )}

          {step === "done" && measurements && (
            <View style={styles.resultBox}>

              <Text style={styles.resultTitle}>
                Measurements
              </Text>

              <Text style={styles.resultText}>
                Shoulder: {measurements.shoulder_width_cm} cm
              </Text>

              <Text style={styles.resultText}>
                Hip: {measurements.hip_width_cm} cm
              </Text>

              <Pressable
                style={styles.doneButton}
                onPress={()=>router.back()}
              >
                <Text style={{color:"white"}}>
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

container:{flex:1,backgroundColor:"black"},

center:{
flex:1,
justifyContent:"center",
alignItems:"center"
},

overlay:{
position:"absolute",
bottom:60,
width:"100%",
alignItems:"center"
},

instructions:{
color:"white",
fontSize:16,
marginTop:10
},

resultBox:{
backgroundColor:"rgba(0,0,0,0.8)",
padding:20,
borderRadius:12,
alignItems:"center"
},

resultTitle:{
color:"white",
fontSize:22,
marginBottom:10
},

resultText:{
color:"white",
fontSize:18,
marginBottom:5
},

doneButton:{
marginTop:20,
backgroundColor:"green",
padding:12,
borderRadius:8
},

heightContainer:{
flex:1,
justifyContent:"center",
alignItems:"center",
backgroundColor:"black"
},

heightTitle:{
fontSize:28,
color:"white",
marginBottom:30,
fontWeight:"700"
},

heightInput:{
backgroundColor:"white",
width:200,
height:50,
borderRadius:10,
textAlign:"center",
fontSize:18,
marginBottom:30
},

startButton:{
backgroundColor:"#0F766E",
paddingVertical:14,
paddingHorizontal:40,
borderRadius:12
}

});

const outlineStyles = StyleSheet.create({

container:{
position:"absolute",
top:height*0.15,
alignSelf:"center",
alignItems:"center",
opacity:0.7
},

head:{
width:width*0.12,
height:width*0.12,
borderRadius:width*0.06,
borderWidth:3,
borderColor:"white"
},

body:{
width:width*0.35,
height:height*0.35,
borderWidth:3,
borderColor:"white",
borderRadius:20,
marginTop:10
},

legsContainer:{
flexDirection:"row",
marginTop:10
},

leg:{
width:width*0.12,
height:height*0.25,
borderWidth:3,
borderColor:"white",
marginHorizontal:10,
borderRadius:20
}

});