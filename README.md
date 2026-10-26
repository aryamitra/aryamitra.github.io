# aryamitra.me

Static site served by GitHub Pages (custom domain in `CNAME`).

| URL | File | What it is |
| --- | --- | --- |
| `/` | `index.html` | Splash card that flips into the portfolio |
| `/portfolio/` | `portfolio/index.html` | The main portfolio page |
| `/job-overlay/` | `job-overlay/` | Job overlay project (self-contained) |
| `/linear-regression/` | `linear-regression/` | Linear regression demo (GameMaker HTML5 export) |

GitHub Pages serves `folder/index.html` at `/folder/`, which is why each page is an `index.html` in its own folder.

## Layout

```
index.html            splash page
portfolio/index.html  portfolio page
assets/
  css/   style.css (shared), splash.css (splash only)
  js/    script.js, food.js (portfolio), splash.js (splash)
  fonts/ images/ videos/
job-overlay/          standalone project, its own css/js/assets
linear-regression/    standalone project
scripts/
  update-food.sh      run after adding photos to assets/images/food/; regenerates assets/js/food.js
```

Shared files under `assets/` are referenced with root-absolute paths (`/assets/...`) so they work from any page.

## Local preview

```bash
python3 -m http.server 8000
```
