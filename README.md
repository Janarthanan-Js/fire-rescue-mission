# Fire Rescue Mission

A complete, playable 2D firefighting rescue game for Android — built as a native
WebView shell around an HTML5 Canvas game engine. Fully offline, no CDN, no network
calls at runtime.

Rescue civilians, extinguish fires, avoid hazards and survive a lethal dinosaur
predator across **20 campaign missions** plus an infinite **Endless Mode**.

---

## Download & Install

| | |
|---|---|
| **APK** | [`android/out/FireRescueMission-1.0.0.apk`](android/out/FireRescueMission-1.0.0.apk) |
| **Size** | ~875 KB |
| **SHA-256** | `1b9c983cb49d0f70b92640405c596958bb97824bb7a91aba8f7d19f907a8cb09` |
| **Package** | `com.firerescuemission.game` |
| **Min / Target SDK** | 24 (Android 7.0) / 34 |
| **Signature** | APK Signature Scheme v2 + v3 |

**Install:** copy the APK to your phone and open it, or run
`adb install android/out/FireRescueMission-1.0.0.apk`.
You may need to allow "Install from unknown sources" for your file manager.

---

## Gameplay

You are a firefighter inside burning buildings — houses, apartments, offices,
schools, warehouses and factories. Each mission has fires to extinguish, people
to rescue, hazards to dodge, limited water and a countdown timer.

### Touch controls (portrait)

| Control | Position | Action |
|---|---|---|
| Virtual joystick | bottom-left (dynamic, follows your thumb) | Move (8-directional, analog) |
| **WATER** | bottom-right (upper) | Hold to spray; aims in your movement direction |
| **RESCUE** | bottom-right (lower) | Hold near a victim to carry them out |

### Objective types

- **Extinguish** — knock out all fires with your water spray
- **Rescue** — reach a victim, then hold RESCUE and escort them to the exit
- **Survive** — stay alive until the timer expires

### Hazards

- **Fire** — burns you on contact and drains health
- **Explosive barrels** — detonate when damaged, damaging everything nearby
- **Toxic zones** — lingering gas clouds that drain health
- **The Dinosaur** — see below

---

## Features

- **20 hand-tuned campaign missions** with rising difficulty
- **Endless Mode** — infinite waves with escalating objectives; best-wave tracking
- **Deterministic level generation** — seeded BSP map builder, every run reproducible
- **Lethal dinosaur predator** — chases you, cannot be killed or repelled
- **100% synthesized audio** — Web Audio API only (no audio files), works offline
- **Local save games** — level progress, endless best score, settings
- **Fixed-timestep 60 fps loop** — stable physics independent of frame rate
- **Haptics** — vibration feedback on damage, bites, explosions

---

## The Dinosaur

A lethal chasing predator — **not** a fightable enemy.

- **Cannot be killed** — water spray does nothing (`hp = Infinity`)
- **Cannot be repelled** — no attack or tool pushes it back
- **Always escapable** — its speed is hard-capped at `PLAYER.SPEED × 0.86`
  (≈153 px/s) versus your 178 px/s, at *every* difficulty

### Behaviour

1. **Warning** — a "DANGER! DINOSAUR APPROACHING!" banner, a roar, screen shake
   and a red flash give you a short reaction window.
2. **Chase** — it hunts you, steering around walls (ray-probe obstacle avoidance)
   and lunging in short bursts when close.
3. **Bite** — contact deals damage and knocks you back. Enough bites can fail
   the mission.
4. **Retreat** — after a chase window it gives up, lopes away and vanishes.

It tramples and destroys explosive barrels on contact (a crunchy detonation).

### Spawn schedule

| Mode | First appears | Scaling |
|---|---|---|
| Campaign | Level 3 (never in the tutorial or Levels 1–2) | Faster and more frequent each level; hardest levels run 2 at once |
| Endless | Wave 4 | Faster and more frequent as the wave number rises |

### Audio-visual feedback

- Red danger vignette that swells as it closes in
- HUD distance/danger indicator with near/close states and a pulsing warning
- Proximity-driven low-frequency drone
- Roar, bite, footstep and departure sound effects
- Screen shake, dust stomps, ground rings and a damage flash

---

## Tech Stack

| Layer | Technology |
|---|---|
| Game engine | HTML5 Canvas 2D, fixed-timestep 60 fps loop |
| Language | Vanilla ES5 JavaScript — no framework, no build step for the game |
| Audio | Web Audio API, fully procedural synthesis |
| Persistence | `localStorage` (level progress, endless record, settings) |
| Android shell | Native `WebView` in a single `Activity` |
| Assets | Bundled FontAwesome webfonts + Nunito / Luckiest Guy TTFs |

### How the Android shell works

`android/app/src/com/firerescuemission/game/GameActivity.java` hosts a fullscreen,
portrait `WebView`. Assets under `assets/www` are served by overriding
`WebViewClient.shouldInterceptRequest` over the virtual HTTPS origin
`https://appassets.androidplatform.net/`. Serving over **HTTPS** matters — a secure
context is required for `localStorage` (save games) and reliable Web Audio. No
`androidx` dependency; only framework APIs are used.

---

## Repository Layout

```
android/
  app/
    AndroidManifest.xml              app manifest (portrait, fullscreen, minSdk 24)
    src/com/firerescuemission/game/
      GameActivity.java              WebView shell + asset loader
    assets/www/                       the game itself
      index.html
      style.css
      game/
        config.js                    tunables (player, fire, dino, endless, levels)
        levels.js                    seeded BSP map generator + campaign specs
        entities.js                  Player, Fire, Victim, Barrel, ToxicZone,
                                     WaterStation, Dino
        game.js                      game loop, camera, collisions, dino AI hooks
        fx.js                        particles, shake, flashes, text popups
        audio.js                     procedural music + SFX
        input.js                     touch joystick + on-screen buttons
        save.js                      localStorage save data
        ui.js                        menus, HUD, overlays
        main.js                      bootstrap
      assets/fa/                      FontAwesome (bundled, offline)
      fonts/                          Nunito + Luckiest Guy
    res/                              launcher icons + colors
  assemble_assets.sh                  stages public assets into assets/www
  build.sh                            Gradle-free APK build pipeline
  fonts_prelude.css                   inlined font-face prelude
  keystore/release.jks                release signing keystore
  out/FireRescueMission-1.0.0.apk     built, signed APK
```

---

## Building from Source

The build is deliberately **Gradle-free** — a hand-rolled pipeline using Android
build-tools directly. This keeps the build reproducible in environments without the
Android Gradle Plugin.

### Requirements

- JDK 21 (`javac`)
- Android SDK **build-tools r34** (`aapt2`, `d8`, `zipalign`, `apksigner`)
- Android platform **android-34** (`android.jar`)

### Steps

```bash
# 1. Stage the game assets into the APK asset tree
bash android/assemble_assets.sh

# 2. Build and sign
bash android/build.sh
# -> android/out/FireRescueMission-1.0.0.apk
```

Override toolchain locations with environment variables if they are not in the
default place:

```bash
SDK=/path/to/android-sdk bash android/build.sh
```

### Pipeline stages

1. `aapt2 compile` — compile resources
2. `javac` — compile `GameActivity` against `android.jar`
3. `d8` — convert classes to DEX
4. `aapt2 link` — link resources + assets into a base APK
5. `zip` the DEX in, then `zipalign -p 4`
6. `apksigner` — sign with APK Signature Scheme **v2 + v3**

> **Build note:** every helper class in `GameActivity.java` is a *static* nested
> class with explicitly injected dependencies. Build-tools r34's `d8` (R8
> 8.2.2-dev) throws an internal `NullPointerException` on the synthetic `this$0`
> field of non-static inner classes. Do not convert them to inner classes.

### Signing

The repo ships a demo release keystore at `android/keystore/release.jks`
(alias `firerescue`). For a real store release, replace it with your own keystore
and passwords in `android/build.sh`.

---

## Game Configuration

All tunables live in `android/app/assets/www/game/config.js`:

```js
MAX_LEVELS: 20,             // campaign length
PLAYER: { SPEED: 178 },     // player movement speed (px/s)
DINO: {
  SPEED: 92,                // base chase speed
  SPEED_CAP_MULT: 0.86,     // never exceeds SPEED_CAP_MULT * player speed
  LUNGE_MULT: 1.14,         // short burst while lunging
  INTRO_LEVEL: 3,           // campaign: first level with a dinosaur
  INTRO_WAVE: 4             // endless: first wave with a dinosaur
}
```

---

## Version History

| Version | Notes |
|---|---|
| 1.0.0 | 20 campaign levels, Endless Mode, lethal dinosaur predator |

### Recent fixes

- **Dinosaur speed** — capped below player speed (`SPEED × SPEED_CAP_MULT`) so it is
  always outrunnable, replacing a lunge multiplier that made it faster than the player.
- **Crash on dinosaur arrival** — the danger HUD no longer rewrites the DOM every
  frame; full-screen vignette gradients are cached; the audio drone is throttled
  instead of rescheduled 60×/sec.

---

## License

Released for personal and educational use. Bundled fonts (Nunito, Luckiest Guy) and
FontAwesome are distributed under their respective open licenses (SIL OFL / CC BY 4.0).
