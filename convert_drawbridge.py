import base64
from PIL import Image

# Read uploaded image
img = Image.open(r'C:\Users\chris\.gemini\antigravity\brain\e9ee07a6-a105-4363-b6eb-fb9ef36cecce\media__1782191025840.png')

# Crop the left 140x140 to grab just the castle icon
icon = img.crop((0, 0, 140, 140))
icon.thumbnail((128, 128))
icon.save('public/drawbridge_thumb.png', 'PNG')

with open('public/drawbridge_thumb.png', 'rb') as f:
    img_data = base64.b64encode(f.read()).decode('utf-8')
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image href="data:image/png;base64,{img_data}" width="128" height="128"/></svg>'

with open('public/drawbridge.svg', 'w') as f:
    f.write(svg)
