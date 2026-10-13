# 3D delivery tracker — UI component

**[Live demo](https://domvybe.com/components/delivery-tracker/)** · [Step-by-step tutorial](https://domvybe.com/library/delivery-tracker/) · [Download the ZIP](https://github.com/UlviShabanbayli/domvybe-delivery-tracker/releases/latest/download/delivery-tracker-source.zip)

A live pizza delivery tracker: a glass order panel over a toy 3D town where the pizza bakes, flies into its box and rides a scooter to your door, from day to night.

Open `index.html` through any local static server (for example `python3 -m http.server`) and try it with a mouse,
a finger or the keyboard. Plain HTML, CSS and JavaScript; no build step; one library, three.js (vendored in vendor/three/, MIT).

- `index.html` — the order-status page: nav, hero, the glass order panel, the timeline, the dialogs and the phone sheet
- `css` — tracker.css: the page, the glass panel, the progress, the dialogs, the phone bottom sheet
- `js` — tracker.js (one number t drives the status, ETA, timeline and demo bar), timeline.js, scene3d.js + models.js (the three.js town, kitchen and ride), tiles.js, and the SVG fallback (scene.js, iso.js)
- `assets` — the stage tiles, rendered in code
- `vendor` — three.js r186 and the addons it uses, with its MIT LICENSE

pizzatime, its orders, couriers and phone numbers are made up. The 3D is made in code with three.js: the town, the oven,
the pizza, the box, the scooter and the courier are real-time renders, and the stage tiles and sign textures are drawn
in code; no photos and no AI pictures. three.js (r186) is in `vendor/three/` under its own MIT licence
(`vendor/three/LICENSE`). Without WebGL (or with `?svg`) the page shows the flat SVG town.

It respects `prefers-reduced-motion`. Made by Ulvi (Code with Ulvi) · domvybe.com

## Licence

MIT — see [LICENSE](LICENSE). Use it in your own projects, commercial ones included.
