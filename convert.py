import base64
with open('public/favicon.png', 'rb') as f:
    img_data = base64.b64encode(f.read()).decode('utf-8')
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><image href="data:image/png;base64,{img_data}" width="128" height="128"/></svg>'
with open('public/favicon.svg', 'w') as f:
    f.write(svg)
