# Replay assets

Binary assets used by the `replay:*` fixtures (`../fixtures/*.json` reference them as `"asset:<filename>"`).
`agent-demo` tells a simple story: draw a set of images and make a short clip for "Peep", our yellow chick mascot.

## Provenance

The five images are **AI-generated with Gemini via the dev proxy (llm-proxy) on 2026-11-24**. The small
sparkle in the corner of each image is Gemini's watermark and is left in on purpose. The video is **not** an AI
video (Gemini could not render one at the time): it is a clip **assembled with ffmpeg from the five generated
images** (slow zoom with crossfades). The chime is synthesized with ffmpeg (sine notes), not a recording.

| File | What | Prompt |
| :--- | :--- | :--- |
| `gallery-1.jpg` | Chick on a laptop keyboard | "A cute round yellow chick mascot sitting on a laptop keyboard, soft studio light, 3D render" |
| `gallery-2.jpg` | Chick coding at night | "The same cute fluffy round yellow chick mascot wearing tiny over-ear headphones, sitting in front of a glowing computer monitor with code at night, cozy desk lamp, 3D render, soft cinematic light" |
| `gallery-3.jpg` | Sticker sheet, four poses | "Sticker sheet of a cute fluffy round yellow chick mascot in four poses: waving hello, thinking, sleeping, celebrating with confetti; glossy die-cut sticker style with thick white outlines, light grey background, no text" |
| `gallery-4.jpg` | Minimal poster | "Minimal brand poster: a cute fluffy round yellow chick mascot centered on a soft pastel yellow background with gentle shadow, lots of empty space, studio product photography, no text" |
| `gallery-5.jpg` | Morning scene | "A cute fluffy round yellow chick mascot holding a tiny coffee cup next to a stack of books and a small plant, warm morning sunlight through a window, 3D render, shallow depth of field" |
| `demo.mp4`, `demo.webm` | 8.1 s promo clip, 1280x720, 30 fps, silent-ish soft pad | assembled from `gallery-1..5.jpg` (no prompt) |
| `demo.mp3` | 2 s soft two-note notification chime (synthesized) | n/a |

## How the files were made

Images: the generated PNGs (about 2400x1800) were downscaled to 1600 px wide and saved as progressive JPEG,
quality 85 (Pillow `Image.resize(..., LANCZOS)`, `save(..., "JPEG", quality=85, optimize=True, progressive=True)`).

Clip (`make_clip.sh` below, ffmpeg 6.1 in `jrottenberg/ffmpeg:6.1-alpine`): each image gets a slow zoom or pan
centred on the chick (4:3 images cropped to 16:9; the sticker sheet is fitted whole on a blurred copy of itself), 1.6 s
per image with 0.3 s crossfades, starting and ending on `gallery-1`. Images are upscaled to 3840x2160 before `zoompan`,
which is what keeps the motion smooth.

```sh
docker run --rm --user "$(id -u):$(id -g)" -e ASSETS=/assets -v "$PWD":/assets:ro -v "$OUT":/out \
  -v "$PWD/make_clip.sh":/make_clip.sh:ro --entrypoint sh jrottenberg/ffmpeg:6.1-alpine /make_clip.sh   # then copy $OUT/demo.* here
```

Chime (ffmpeg 6.1, `jrottenberg/ffmpeg:6.1-alpine`):

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/out -w /out --entrypoint sh jrottenberg/ffmpeg:6.1-alpine -c '
ffmpeg -y -f lavfi -i "sine=frequency=659:duration=1,afade=t=out:st=0.2:d=0.8" \
  -f lavfi -i "sine=frequency=880:duration=1.5,afade=t=out:st=0.2:d=1.3" \
  -filter_complex "[0]volume=0.5[a];[1]volume=0.5,adelay=450|450[b];[a][b]amix=inputs=2:normalize=0,atrim=0:2" \
  -c:a libmp3lame -b:a 64k demo.mp3'
```

Total size of the assets must stay under 6 MB.
