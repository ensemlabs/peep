# Replay assets

Binary assets used by the `replay:*` fixtures (`../fixtures/*.json` reference them as `"asset:<filename>"`).
`agent-demo` tells the story "make `is_prime` faster": the tools produce benchmark charts, a short animated
video and an audio clip. The numbers in the charts are **illustrative**, not measured (every chart says so in a
footnote).

| File | What |
| :--- | :--- |
| `gallery-1.png` | Bar chart: time per 1M checks, five algorithms |
| `gallery-2.png` | Line chart: runtime vs input size (log-log) |
| `gallery-3.png` | Speedup vs trial division |
| `gallery-4.png` | Memory use (log scale) |
| `gallery-5.png` | Summary card, winner highlighted |
| `demo.webm`, `demo.mp4` | 6 s, 1280x720: the speedup chart animates (bars grow, winner highlights) |
| `demo.mp3` | 5 s soft tone (used by the `text_to_speech` tool) |

Charts (1600x1000) and video frames are drawn by `make_charts.py` with matplotlib; ffmpeg only encodes. Run these in
this directory (nothing is installed on the host).

## Charts and frames

```sh
S=$(mktemp -d)   # scratch dir for the video frames
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/src:ro -v "$PWD":/out -v "$S":/frames \
  python:3.13-slim sh -c 'pip install -q --user matplotlib && python /src/make_charts.py /out --frames /frames'
```

## Video and audio (ffmpeg 6.1, `jrottenberg/ffmpeg:6.1-alpine`)

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/out -v "$S":/frames:ro -w /out --entrypoint sh \
  jrottenberg/ffmpeg:6.1-alpine -c '
A="sine=frequency=330:duration=6,volume=0.08,afade=t=in:d=0.5,afade=t=out:st=5:d=1"
ffmpeg -y -framerate 24 -i /frames/frame_%04d.png -f lavfi -i "$A" -c:v libvpx-vp9 -crf 38 -b:v 0 -cpu-used 2 -row-mt 1 -pix_fmt yuv420p -c:a libopus -b:a 48k -shortest demo.webm
ffmpeg -y -framerate 24 -i /frames/frame_%04d.png -f lavfi -i "$A" -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart -shortest demo.mp4
ffmpeg -y -f lavfi -i "sine=frequency=523:duration=5" -c:a libmp3lame -b:a 64k demo.mp3
'
```

Keep the total size of the assets under 3 MB (currently about 0.8 MB).
