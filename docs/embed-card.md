# Embedding VOID as a live card

`?demo=1` boots the piece as a self-playing card: fresh defaults, a lively
look (a strong shared heartbeat, wander, a scent field the swarm writes and
follows, gentle births and deaths), the bundled cloud as the source, the
camera at half distance so the particles read at card size, cool-white
particles on black, and no UI at all — no panel, no source card, no guide, no
first-run intro, and never a write to the visitor's own instrument state
(verified: clean storage stays clean through unload). On touch devices the
demo integrates one fixed step per frame, so a card may run dreamy but never
hot. Drag rotates the camera, wheel/pinch zooms.

## The card snippet

Drop this into any page on any domain. It ships a lazy poster image and a few
lines of script; the simulation itself loads only when the card scrolls into
view, and the iframe is removed when it leaves (scrolling your site stays
yours). On a fine pointer (desktop) the iframe is interactive — the visitor
can drag to rotate the camera; on a coarse pointer (phone) the iframe stays
inert so page scrolling never fights the demo.

```html
<!-- VOID / PARTICLE MEMORY — live card -->
<style>
  .void-card {
    position: relative;
    aspect-ratio: 16 / 10;
    background: #000;
    overflow: hidden;
    border: 1px solid #1e1e1e;
  }
  .void-card img,
  .void-card iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border: 0;
    display: block;
  }
  /* desktop: the demo is touchable — drag rotates the camera */
  .void-card iframe { pointer-events: auto; }
  /* phone: the demo yields to the page, so scrolling always wins */
  @media (pointer: coarse) {
    .void-card iframe { pointer-events: none; }
  }
  .void-card .void-card-open {
    position: absolute;
    left: 14px;
    bottom: 12px;
    z-index: 2;
    color: #cfcfcf;
    border: 1px solid #3a3a3a;
    background: rgba(5, 5, 5, 0.75);
    font: 10px ui-monospace, monospace;
    letter-spacing: 0.22em;
    padding: 8px 12px;
    text-decoration: none;
  }
  .void-card .void-card-open:hover { color: #fff; border-color: #666; }
</style>

<div class="void-card" id="void-card">
  <img
    loading="lazy"
    alt="VOID / PARTICLE MEMORY — a point-cloud memory reconstructing from particles"
    src="https://mehran-ahmadi.com/Particle-Memory-VOID/app/samples/demo-cloud.jpg"
  />
  <a class="void-card-open" href="https://mehran-ahmadi.com/Particle-Memory-VOID/" target="_blank" rel="noopener">
    OPEN THE PIECE
  </a>
</div>

<script>
  (function () {
    var card = document.getElementById("void-card");
    if (!card || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      for (var e of entries) {
        if (e.isIntersecting && !card.querySelector("iframe")) {
          var f = document.createElement("iframe");
          f.title = "VOID / PARTICLE MEMORY — live demo";
          f.allow = "fullscreen";
          f.src = "https://mehran-ahmadi.com/Particle-Memory-VOID/app/?demo=1";
          card.appendChild(f);
        } else if (!e.isIntersecting) {
          var f2 = card.querySelector("iframe");
          if (f2) f2.remove(); // off-screen: no simulation, no battery
        }
      }
    }, { rootMargin: "200px" });
    io.observe(card);
  })();
</script>
<!-- /VOID — live card -->
```

## What it costs

- **Page load:** the poster image (~45 kB, lazy) and the snippet (~2 kB).
  The app bundle (183 kB gzip eager) loads only when the card is seen.
- **While viewed:** the demo runs 6k particles on the GPU path (4k on touch),
  one readback per frame, trails off.
- **While scrolled away:** the iframe is removed; nothing runs.
- **The visitor's state:** untouched — the demo neither reads nor writes the
  instrument's localStorage.

## Tuning the card

- Density: append `&count=4000` to the iframe `src`.
- The poster is a still of the actual demo (the cloud reconstructing);
  swap the `<img src>` for any other still if you prefer.
