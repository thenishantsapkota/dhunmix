# Dhunmix — Product & Technical Plan

An installable web app (PWA) that mixes a DJ's own music automatically for any event. The DJ stays in control as a co-pilot: they can see the queue, swap the next track, skip, or take over a transition.

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Music source | DJ's own audio files, plus YouTube links turned into local files by a helper that runs on the DJ's laptop (yt-dlp) |
| Platform | Installable web app (phone, tablet, laptop) |
| Control model | Co-pilot: mixes automatically, and the DJ can override anything at any time |
| Devices | Android phones and laptops (Chrome/Edge); iOS best-effort only |
| Library size | About 1,000 songs |
| DJ controllers | None in version 1 (touch and mouse only) |
| Music | Mixed wedding variety plus Bollywood, Nepali and other regional music. Tempo often drifts, vocals start early, and the scales are not Western |
| Transitions | Adaptive: chosen per transition, from a long blend to a quick cut |
| Venue internet | Both: a cloud service when online, and a local Wi-Fi hotspot when offline |
| Test songs | A public dataset plus the DJ's own songs, checked by ear |
| Features | Event energy curves, harmonic and tempo matching, event moments with mic ducking, crowd requests |

**Out of scope:** Spotify and Apple Music audio playback. That needs partner deals, not code. Spotify also stopped giving new apps BPM, key and energy data in Nov 2024.

## 2. How a mix works (the core loop)

```
 Library (files)  ──►  Analyzer (Web Worker, essentia.js)  ──►  Track DB (IndexedDB)
                                                                    │
 Event preset + clock ──► Energy target(t) ──►  Next-track Picker ◄─┘
                                                     │
                                         Transition Planner
                                                     │
                                Mixer Engine (Web Audio, 2 decks)  ──► speakers
                                                     ▲
                                DJ co-pilot UI (queue, skip, override, moments)
```

### 2.1 Analysis (once per track, cached)
Each track is analysed in a Web Worker so the app stays responsive. The results are cached in IndexedDB, keyed by a file hash.
- **BPM and beat grid:** essentia.js `RhythmExtractor2013`. Detectors often report half or double the real tempo, so the result is folded into an 80–160 range, and the DJ can tap a button to halve or double it.
- **Key:** essentia `KeyExtractor`, then converted to Camelot notation (e.g. 8A).
- **Energy (0–1):** a mix of loudness (LUFS), onset density and spectral brightness, ranked against the rest of the DJ's library.
- **Structure:**
  - the downbeat (first beat of each bar)
  - phrase boundaries every 16 or 32 bars, found from sudden changes in energy
  - where the intro ends and where the outro starts
  - where the vocals are, using a rough spectral estimate (enough to avoid two vocals clashing)
- **Loudness normalisation gain:** so every track plays at a similar volume.
- **For Bollywood, Nepali and live-recorded songs:**
  - **Beat positions:** keep every beat the detector finds, rather than assuming one fixed BPM for the whole song.
  - **Tempo stability:** score each 32-bar section of a song from 0 to 1 for how steady its tempo is.
  - **Blends only on steady sections:** long blends happen only where both songs are steady.
  - **Key confidence:** save how sure the key detector is. It is less reliable on non-Western scales, so a low-confidence key counts for less in the picker.
  - **Tempo range:** detected tempos are folded into 60–180 BPM, wider than the 80–160 above, because slow songs are common in this music.
- **Speed target:** about 3–5 s per track on a laptop, slower on phones. Analysis runs in the background while the set is already playing.

### 2.2 Next-track picker
Each candidate track gets a score. The highest score goes to the top of the queue, and the DJ sees the top 3 alternatives.
```
score =  w_key    · camelotCompat(cur, cand)        // same=1, ±1 / relative=0.8, energy-boost +2=0.5, else 0.1
       + w_bpm    · bpmCloseness(cur, cand)         // within ±6% (incl. half/double) ≈ 1, falls off after that
       + w_energy · (1 − |cand.energy − target(t)|) // follows the event curve
       + w_fresh  · notRecentlyPlayed / artistSpacing
       + w_req    · crowdRequestBoost
```
- **Weights** come from the event preset (a wedding cares more about energy than key; a club more about BPM).
- **Hard rules:**
  - never repeat a track
  - leave at least 3 tracks between songs by the same artist
  - respect the DJ's "never play" and "must play" flags

### 2.3 Transition planner
Given the playing track A and the next track B:
1. **Choose the mix-out point** in A. It is the start of A's outro, or a phrase boundary about 60–90 s before the end.
2. **Choose the mix-in point** in B: its first downbeat, or the end of its intro.
3. **Pick a transition style:**
   - **Blend:** BPMs within 6% and keys compatible. Beat-matched over 16–32 bars, with the bass swapped from A to B on a phrase boundary.
   - **Filter blend:** BPMs within 6% but the keys clash. A high-pass filter on A, a short overlap, and vocals never overlap.
   - **Echo out / quick cut:** BPMs differ by more than 8%, or a moment is triggered. A echoes out on a downbeat, then B starts.
   - **Adaptive rules:**
     - **Long blend:** only when both overlapping sections have a steady tempo and their vocals don't overlap.
     - **Short fade (4–8 s, on the beat):** the default for vocal-heavy and regional songs.
     - **Cut or echo-out:** when either section's tempo is unsteady.
     - **Wider gaps:** slow songs to dance songs (or the reverse) also get a cut or echo-out.
4. **Tempo:** B starts at A's BPM, then slowly drifts back to its own BPM over the next few phrases. This avoids a sudden jump in tempo.

### 2.4 Mixer engine (Web Audio)
- **Per deck:** a source node, then a time-stretcher, a 3-band EQ (BiquadFilter), a filter, a gain, a crossfader bus, then a master limiter.
- **Key lock:**
  - **Problem:** speeding up a track with `playbackRate` raises its pitch.
  - **Fix:** use a SoundTouch time-stretcher running in an AudioWorklet.
  - **Limit:** keep tempo changes within ±6% so it still sounds clean.
- **Timing:** all changes are scheduled on the `AudioContext` clock, which keeps them sample-accurate. The UI only reads state; it never drives the audio timing.
- **Keeping the app alive:**
  - the Wake Lock API stops the screen from sleeping
  - Media Session API controls appear on the lock screen
  - **Known iOS risk:** Safari can pause audio when the screen locks or the app moves to the background. The UI will warn the DJ to keep the app in front.

## 3. Event features

### 3.1 Energy curves (presets)
A preset is a target energy curve over the event's length, plus picker weights and a BPM range.
- **Wedding reception:** dinner at 0.3 → first dance (moment) → slow build → peak at 0.9 → last song.
- **Club night:** warm-up at 0.4 → peaks of 0.85–0.95 in waves → closing.
- **Corporate / background:** flat at 0.3–0.5, steady and safe.
- **House party:** builds to 0.8 and holds there.

The DJ can stretch the curve to the real event length or drag it to reshape it.

### 3.2 Moments and mic ducking
- **Moment buttons:** "Speech", "First dance", "Cake", "Last song" and custom ones. Each can be pinned to a specific track and uses a quick, clean transition.
- **Speech:** fades the music down to a bed level or pauses it. Pressing "Resume" brings it back with a fade-in.
- **Automatic mic ducking:**
  - **How:** the MC's mic is fed into the device (`getUserMedia`, ideally through an audio interface). When the mic is above a threshold, the music gain drops by 10–15 dB, then recovers over about 1 s.
  - **Caveat:** a phone's built-in mic also hears the speakers, so it gets a manual push-to-talk "Duck" button instead.

### 3.3 Crowd requests (needs a small backend)
- **Guest flow:** guests scan a QR code and open a guest page. They search the DJ's library, which shows titles only and never shares any files, then tap "Request".
- **DJ side:** requests appear in a co-pilot inbox. Accepted requests get a boost in the picker, so they play at the next point where they fit the mix.
- **Two ways for guests to connect:**
  - **Online:** a small cloud service relays requests through a short-lived event room. Guests use mobile data or the venue Wi-Fi.
  - **Offline:**
    - **How it works:** the laptop helper also serves the guest page on the local network. The DJ turns on a Wi-Fi hotspot, and the QR code contains both the Wi-Fi details and the page address.
    - **Limit:** a web app on a phone can't run a server, so offline requests need the laptop. Android-only, no-internet events have no crowd requests.
  - **Switching:** the app uses the cloud when it's online and switches to the local option otherwise. Guests just scan whichever QR code is on screen.
- **Abuse limits:** one request per guest every N minutes, and the DJ can block songs.

## 4. Music sources
- **Local files:**
  - **Chrome and Edge:** the File System Access API remembers the DJ's music folder.
  - **Safari and iOS:** they don't support it, so the DJ adds files through a file picker instead.
  - **Formats:** mp3, m4a/aac, wav, flac (where the browser can decode it).
- **YouTube helper (`ytdl-helper/`):**
  - **What it is:** a small script on the DJ's laptop that wraps `yt-dlp` and `ffmpeg`.
  - **How it works:** the app sends a link or playlist URL to `http://localhost:<port>`. The helper downloads the audio as m4a into the library folder, and the app picks it up and analyses it.
  - **Whole playlists in one step (required):** the DJ pastes one YouTube playlist link and the helper downloads every track in it.
    - **Live progress:** the app shows "12/48" as it goes.
    - **No duplicates:** tracks already in the library are skipped (yt-dlp `--download-archive`).
    - **Unavailable videos:** private or blocked videos are listed as failed and the rest keep going (`--ignore-errors`).
    - **Speed:** 3–4 tracks download at once.
    - **Analysis:** each file is analysed as soon as it lands, so the first songs are ready within a minute or two.
    - **Event playlist:** the playlist becomes a crate, i.e. a named list for the event, with the same name as on YouTube.
  - **Phones:** only work while connected to the laptop. Otherwise the DJ downloads at home before the event, which is the safer workflow anyway.
  - **⚠ YouTube Terms of Service:** downloading goes against YouTube's terms. That risk is on you as the operator. Keep the helper separate from the web app, and don't host a server that downloads for other people.
- **Licensing at events:** the right to play music in public comes from the venue's licence (ASCAP, BMI, PRS etc.), as it would for any DJ. The app does not change that.

## 5. Tech stack
- **App:** Vite + React + TypeScript. Uses `vite-plugin-pwa` for install and offline support.
- **Audio:**
  - Web Audio API
  - AudioWorklet (time-stretching and the limiter)
  - essentia.js (WebAssembly, run in a Web Worker)
  - SoundTouch (soundtouchjs or a WebAssembly build)
- **Storage:** IndexedDB for the analysis cache, presets and set history. Settings live only on the device.
- **Helper:** a short shell or Node script wrapping yt-dlp. It depends on yt-dlp and ffmpeg being installed.
- **Backend (v2, crowd requests only):** a realtime store plus a guest page.

## 6. Milestones
| # | Version | Delivers | Done when |
|---|---|---|---|
| M1 | Engine | Two decks, load a file, EQ/filter/crossfader, master limiter | The DJ can crossfade two files by hand with no clicks |
| M2 | Analysis | Worker analysis, cache, library view with BPM, key and energy | 100 tracks analysed; BPM correct (allowing for half/double) on 90% of a test set |
| M3 | Automix | Picker, transition planner, beat-matched blends, co-pilot queue (swap, skip, take over) | A 1-hour unattended mix with no train-wrecks (beats colliding badly) on a test library |
| M4 | Events | Energy-curve presets, moments, push-to-talk and automatic mic ducking | A wedding preset runs a full timeline with moments |
| M5 | YouTube helper | Local yt-dlp helper and an "add link" field in the app | A 50-track YT playlist link → one paste → all available tracks downloaded, analysed and in a crate, failures listed |
| M6 | Crowd requests | Backend, QR guest page, request inbox | 20 simultaneous guests, and requests are slotted in where they fit |

Version 1 = M1–M5. Version 2 = M6.

## 7. Open questions / risks
1. **Target devices (decided):** Android phones and laptops (Chrome/Edge). Android Chrome supports the folder access, Wake Lock and background audio that the app relies on. iOS is supported on a best-effort basis only.
2. **Analysing ~1,000 songs:**
   - **Laptop:** about 3–4 s per song across several workers, so about 10–15 min for the whole library.
   - **Mid-range Android:** about 10 s per song, so roughly 2–3 hours.
   - **Recommended workflow:** analyse on the laptop, then move the results to the phone with **Export / import library analysis** (a JSON file matched by file hash). The phone then only analyses new songs.
3. **Time-stretch quality:** SoundTouch sounds fine within ±6%. Beyond that we avoid beat-matching and use an echo-out instead.
4. **Backend host for crowd requests:** decide in M6. The requirements are a realtime connection, a store that lasts one event, and no user accounts.
5. **Library size (decided): about 1,000 songs.**
   - **Picker:** scores every song each time, which takes milliseconds, so it needs no index.
   - **Storage:** the analysis data is under 5 MB in IndexedDB.
   - **Audio files:** stay in the DJ's folder and are never copied.
   - **Android storage:** a 1,000-song library is roughly 5–10 GB, so the DJ's own phone storage limits how much fits.
6. **Hardware (decided):** no DJ controller in version 1. Touch and mouse only. Web MIDI is possible later.
7. **Test library (decided):** the GiantSteps tempo and key datasets plus about 30 of the DJ's own songs.
   - **Why so many of your own:** GiantSteps is EDM only, so it can't tell us how well Bollywood and Nepali songs are handled.
   - **The 30 songs:** a mix of dance, slow, live-recorded and regional songs, with tempo and key confirmed by ear or in rekordbox.
   - **What we judge them on:** whether the transition choices sound right, more than the raw BPM accuracy.
8. **essentia.js is AGPL-3.0.**
   - **Fine for:** a personal or open-source app.
   - **Selling it closed-source needs:** a commercial licence from UPF, or a replacement analysis library.
   - **Swapping it out:** it is used only in `src/analysis/worker.ts`.

## Status
- **M1 Engine:** done. Two decks, EQ, filter, crossfader, master limiter.
- **M2 Analysis:**
  - **Built:**
    - analysis in a Web Worker pool: BPM, key (Camelot), energy, tempo steadiness, intro end and outro start, loudness trim
    - analysis saved in IndexedDB, keyed by a file fingerprint
    - library view with search and sorting, folder reconnect, and JSON export/import of the analysis
  - **Rhythm method:** `degara` instead of `multifeature`. It is about 7× faster and gave the same BPM (within 0.7) on the first 10 test songs.
  - **Accuracy check:** `node --experimental-strip-types scripts/analyze.ts <folder> [expected.csv]`
  - **Still open:** the 90%-BPM-accuracy test, which needs songs with known reference BPMs.
- **M3 Automix:**
  - **Built:**
    - picker: Camelot key match (trusted less when key detection is unsure), tempo closeness including half and double time, energy, no repeats
    - planner: long blend / filter blend / quick fade / cut on the beat, starting on 4-bar phrases
    - controller: transitions scheduled on the audio clock, a bass swap halfway through blends, tempo eased back to normal afterwards
    - co-pilot panel: Up next, Mix now, alternatives to swap in, and Play next from the library
    - touching the crossfader or a play button hands control back to the DJ
  - **Measured on the Bollywood test songs:**
    - beat offset during overlaps stays within about ±20 ms
    - a planned transition fires on its own
  - **Rule from testing:** every overlap is beat-matched, because unmatched overlaps drifted up to 370 ms. Gaps over ±6% cut on the beat instead.
  - **Open:**
    - key lock (no time-stretching yet), so beat-matching shifts pitch by up to 6% (about 1 semitone), then eases back
    - no artist spacing yet, because there's no reliable artist field
    - the energy target only nudges up slightly, until step 4's event curves replace it
- **M4 Events:**
  - **Built:**
    - presets (Wedding, Club night, Corporate, House party), each with its own energy curve and picker weights
    - curve editor: drag points, or use arrow keys
    - event length and event clock; the clock starts with Automix
    - moments: First dance, Cake cutting, Last song, plus custom ones. The current song fades out over 3 s and the moment song starts from 0:00. Last song ends the set.
    - searchable song picker
    - Speech: music drops to a bed level (-18 dB)
    - Hold to talk (-12 dB)
    - mic auto-ducking with a voice gate (opens instantly, holds 0.8 s), input choice, a trigger-level control and a meter
  - **Saving:** the event is saved in IndexedDB, so it survives a reload.
  - **Verified in Chrome:** curve dragging, preset switch, the First dance and Last song moments, the end of the set, and Speech / Hold to talk duck depths.
  - **Not verified in the browser:** mic auto-duck. The gate logic and the duck stage are unit-tested, but the real mic path (permission prompt, interface input) needs a hand test.
- **M5 YouTube helper:**
  - **Built:** `pnpm helper` runs a loopback-only Node server.
    - One pasted playlist or video link starts the import.
    - It lists the playlist, then downloads 3 songs at a time as m4a into `<music folder>/<playlist title>/`.
    - Songs already in the folder (matched by video id) are skipped.
    - Temporary YouTube errors (403/429/timeouts) are retried twice; unavailable videos are listed with the reason.
    - Live progress is streamed to the app, which adds each song to the library and analyses it as it lands.
    - The playlist becomes a crate in the library, with a crate filter.
  - **Security:**
    - only YouTube links, rebuilt from their ids
    - only localhost and configured origins can drive it
    - it serves only files it downloaded, and checks every path stays in the music folder
    - commands run without a shell
  - **Verified:**
    - a real playlist import (first 3 songs): 2 downloaded in about 4 s, and 1 temporary 403 that downloaded fine on retry
    - in the app: a fresh download, the already-downloaded path, the crate, and the helper-offline instructions
  - **Open:** phones can't use the helper, because it listens on the laptop only. Import on the laptop, then export the analysis to the phone.
- **Changes from listening feedback (2026-11-13):**
  - **Transitions use filters and EQ:**
    - bass crossover over 2 bars
    - filter sweeps, vocal dip and highs roll-off
    - a cut became an echo-out plus beat roll, with the new song opening through a filter
  - **Smoother transitions:**
    - quick fades are 32 beats
    - the incoming song starts in its intro, so its main part lands mid-transition
    - moments fade over 6 s
  - **Live moves while songs play (Live FX: Off / Subtle / Lively):** filter riser, beat roll, bass drop, echo throw and low-pass dip, placed from the phrase grid and energy envelope, and toned down at low event energy.
  - **Beat roll ("repeater"):** slip roll in the engine, plus a hold-to-roll button on each deck.
  - **Moving knobs:** the deck knobs show live values, so automation is visible.
  - **Song length:** ~0:45 (default), ~1:30 or Full. Mix-out happens on the energy-drop phrase near the target, never before 30 s.
  - **Never play:** a per-track flag that automix respects, saved with the library.
