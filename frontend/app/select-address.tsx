import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { api } from "../src/utils/api";

export default function SelectAddress() {

  const router = useRouter();
  const [addresses, setAddresses] = useState<any[]>([]);

  useEffect(() => {
    loadAddresses();
  }, []);

  const loadAddresses = async () => {
    const user = await api.get("/auth/me");
    setAddresses(user.addresses || []);
  };

  const selectAddress = (addr: any) => {

    router.replace({
      pathname: "/place-order/[tailorId]",
      params: {
        address: addr.address,
        lat: addr.geo_location.coordinates[1],
        lng: addr.geo_location.coordinates[0],
      }
    });

  };

  return (
    <SafeAreaView style={{ flex:1 }}>

      <Text style={styles.title}>Select Address</Text>

      <FlatList
        data={addresses}
        keyExtractor={(item, i) => i.toString()}
        renderItem={({item}) => (

          <TouchableOpacity
            style={styles.card}
            onPress={() => selectAddress(item)}
          >
            <Feather name="map-pin" size={20} />
            <View style={{marginLeft:10}}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.address}>{item.address}</Text>
            </View>
          </TouchableOpacity>

        )}
      />

      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => router.push("/select-location")}
      >
        <Feather name="plus" size={18} color="#fff"/>
        <Text style={{color:"#fff"}}>Add New Address</Text>
      </TouchableOpacity>

    </SafeAreaView>
  );

}

const styles = StyleSheet.create({

title:{
fontSize:20,
fontWeight:"600",
margin:20
},

card:{
flexDirection:"row",
alignItems:"center",
backgroundColor:"#fff",
padding:16,
marginHorizontal:20,
marginBottom:10,
borderRadius:10
},

label:{
fontWeight:"600"
},

address:{
color:"#666",
marginTop:2
},

addBtn:{
backgroundColor:"#2563EB",
margin:20,
padding:16,
borderRadius:30,
flexDirection:"row",
alignItems:"center",
justifyContent:"center",
gap:6
}

});

