import requests
import os
import json

# YOUR PEXELS API KEY
API_KEY = "yemQUBTSXOYzN7g1C2dMRWwDe2ypOYqFiKxfHHeFuvlg81Evotrrh853"

headers = {
    "Authorization": API_KEY
}

# Tailoring / clothing search queries
queries = [

    # WOMEN
    "bridal lehenga design",
    "lehenga embroidery design",
    "designer blouse back design",
    "boat neck blouse design",
    "salwar kameez design",
    "anarkali suit design",
    "palazzo suit design",
    "indian party wear gown",

    # MEN
    "mens formal shirt design",
    "mens casual shirt fashion",
    "mens blazer suit",
    "mens wedding sherwani",
    "mens bandhgala suit",
    "mens prince coat wedding",
    "mens kurta pajama design",
    "mens tuxedo suit",
]

save_folder = "output/images"
os.makedirs(save_folder, exist_ok=True)

catalog = []

for q in queries:

    print("Downloading:", q)

    url = f"https://api.pexels.com/v1/search?query={q}&per_page=25"

    response = requests.get(url, headers=headers)

    data = response.json()

    if "photos" not in data:
        continue

    for i, photo in enumerate(data["photos"]):

        # FILTER irrelevant results
        alt_text = photo.get("alt", "").lower()

        if "fashion" not in alt_text and "clothing" not in alt_text and "dress" not in alt_text:
            continue

        img_url = photo["src"]["large"]

        try:
            img_data = requests.get(img_url).content
        except:
            continue

        filename = f"{q.replace(' ','_')}_{i}.jpg"

        path = os.path.join(save_folder, filename)

        with open(path, "wb") as f:
            f.write(img_data)

        catalog.append({
            "id": filename.replace(".jpg", ""),
            "category": q,
            "image": filename
        })


# Save catalogue JSON
with open("output/designCatalog.json", "w") as f:
    json.dump(catalog, f, indent=2)

print("\n✅ Catalog generated successfully")
print("Total images saved:", len(catalog))