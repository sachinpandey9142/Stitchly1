import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Colors, Fonts, Spacing, Radius } from "../../src/utils/theme";
import { designCatalog } from "../../src/data/designCatalog";
import { api } from "../../src/utils/api";

export default function SelectSpecializations() {

  const router = useRouter();

  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (item: string) => {

    if (selected.includes(item)) {
      setSelected(selected.filter(i => i !== item));
    } else {
      setSelected([...selected, item]);
    }

  };

  const handleSave = async () => {

    if (selected.length === 0) {
      Alert.alert("Please select at least one design");
      return;
    }

    try {

      await api.put("/auth/profile", {
        specialities: selected
      });

      Alert.alert(
        "Saved",
        "Your design specializations have been saved."
      );

      router.back();

    } catch (err) {

      Alert.alert(
        "Error",
        "Could not save specializations"
      );

    }

  };

  const renderCategory = (title: string, designs: string[]) => {

    return (

      <View style={styles.categorySection}>

        <Text style={styles.categoryTitle}>{title}</Text>

        <View style={styles.cardContainer}>

          {designs.map((item) => (

            <TouchableOpacity
              key={item}
              onPress={() => toggle(item)}
              style={[
                styles.card,
                selected.includes(item) && styles.cardSelected
              ]}
            >

              <Text
                style={[
                  styles.cardText,
                  selected.includes(item) && styles.cardTextSelected
                ]}
              >
                {item}
              </Text>

            </TouchableOpacity>

          ))}

        </View>

      </View>

    );

  };

  return (

    <SafeAreaView style={styles.container} edges={["top"]}>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        <Text style={styles.title}>Select Design Specializations</Text>

        <Text style={styles.subtitle}>
          Choose the stitching styles you offer
        </Text>

        <Text style={styles.genderTitle}>Women</Text>

        {Object.entries(designCatalog.women).map(([key, designs]) =>
          renderCategory(key.toUpperCase(), designs)
        )}

        <Text style={styles.genderTitle}>Men</Text>

        {Object.entries(designCatalog.men).map(([key, designs]) =>
          renderCategory(key.toUpperCase(), designs)
        )}

        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSave}
        >
          <Text style={styles.saveText}>Save Specializations</Text>
        </TouchableOpacity>

      </ScrollView>

    </SafeAreaView>

  );

}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: Colors.background
  },

  scroll: {
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: 16,
    paddingBottom: 40
  },

  title: {
    fontFamily: Fonts.heading,
    fontSize: 24,
    color: Colors.text,
    marginBottom: 6
  },

  subtitle: {
    fontFamily: Fonts.ui,
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 20
  },

  genderTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.text,
    marginTop: 16
  },

  categorySection: {
    marginTop: 10
  },

  categoryTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.textMuted,
    marginBottom: 8
  },

  cardContainer: {
    flexDirection: "row",
    flexWrap: "wrap"
  },

  card: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: Colors.surface
  },

  cardSelected: {
    backgroundColor: "#6C4CF1",
    borderColor: "#6C4CF1"
  },

  cardText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.text
  },

  cardTextSelected: {
    color: "white"
  },

  saveButton: {
    marginTop: 30,
    backgroundColor: "#6C4CF1",
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: "center"
  },

  saveText: {
    fontFamily: Fonts.bodyBold,
    color: "white",
    fontSize: 16
  }

});