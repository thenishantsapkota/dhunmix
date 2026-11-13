# Dhunmix

An automatic DJ mixer for events. Give it your music and it mixes song to song, beat-matched, following the energy of the event. The DJ stays in control as a co-pilot.

## Run it

```sh
pnpm install
pnpm dev        # open the printed URL in Chrome or Edge
```

## Import from YouTube (laptop only)

```sh
brew install yt-dlp ffmpeg   # once
pnpm helper                  # leave it running; saves to ~/Music/Dhunmix
pnpm helper ~/Music/Weddings # or choose the music folder
```

In the app, open **Library → YouTube** and paste a playlist or video link.
- Every song downloads into a folder named after the playlist, and is analysed as soon as it lands.
- The songs are also grouped in a crate (a named list) with the same name.
- Songs you already have are skipped.

Downloading from YouTube is against YouTube's Terms of Service. Use it only for your own music on your own machine.

## Checks

```sh
pnpm test     # unit tests
pnpm lint
pnpm build
node scripts/analyze.ts <folder> [expected.csv]   # BPM/key accuracy check on real songs
```

See `PLAN.md` for the design and the status of each step.
