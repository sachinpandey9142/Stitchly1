import os

folder = "output/images"

# keywords we want to keep
valid_keywords = [
    "lehenga", "blouse", "sherwani", "suit",
    "blazer", "shirt", "kurta", "coat",
    "gown", "salwar"
]

for file in os.listdir(folder):
    name = file.lower()

    if not any(k in name for k in valid_keywords):
        path = os.path.join(folder, file)
        print("Removing:", file)
        os.remove(path)