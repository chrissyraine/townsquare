import base64
from PIL import Image

# Resize first to keep the SVG file size manageable
img = Image.open('theherald.png')
img.thumbnail((256, 256))
img.save('theherald_thumb.png', 'PNG')

with open('theherald_thumb.png', 'rb') as f:
    img_data = base64.b64encode(f.read()).decode('utf-8')
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image href="data:image/png;base64,{img_data}" width="256" height="256"/></svg>'
with open('theherald.svg', 'w') as f:
    f.write(svg)
