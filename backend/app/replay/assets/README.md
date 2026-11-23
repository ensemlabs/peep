# Replay assets

Binary assets used by the `replay:*` fixtures (`../fixtures/*.json` reference them as `"asset:<filename>"`).
They were generated once with ffmpeg 6.1 in a throwaway container (`jrottenberg/ffmpeg:6.1-alpine`):

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/out -w /out --entrypoint sh jrottenberg/ffmpeg:6.1-alpine -c '
F=/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf
label() { echo "drawtext=fontfile=$F:text=$1:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=14:x=40:y=h-th-40"; }

ffmpeg -y -v error -f lavfi -i testsrc2=s=1600x1000 -vf "$(label "Gallery 1 testsrc2")" -frames:v 1 gallery-1.png
ffmpeg -y -v error -f lavfi -i smptebars=s=1600x1000 -vf "$(label "Gallery 2 smptebars")" -frames:v 1 gallery-2.png
ffmpeg -y -v error -f lavfi -i gradients=s=1600x1000:seed=7 -vf "$(label "Gallery 3 gradients")" -frames:v 1 gallery-3.png
ffmpeg -y -v error -f lavfi -i mandelbrot=s=1600x1000:maxiter=80 -vf "$(label "Gallery 4 mandelbrot")" -frames:v 1 gallery-4.png
ffmpeg -y -v error -f lavfi -i rgbtestsrc=s=1600x1000 -vf "$(label "Gallery 5 rgbtestsrc")" -frames:v 1 gallery-5.png

V="testsrc2=s=1280x720:rate=24:duration=6"
A="sine=frequency=440:duration=6"
ffmpeg -y -v error -f lavfi -i "$V" -f lavfi -i "$A" -c:v libvpx-vp9 -crf 50 -b:v 0 -cpu-used 4 -row-mt 1 -pix_fmt yuv420p -c:a libopus -b:a 48k demo.webm
ffmpeg -y -v error -f lavfi -i "$V" -f lavfi -i "$A" -c:v libx264 -preset slow -crf 32 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart demo.mp4
ffmpeg -y -v error -f lavfi -i "sine=frequency=523:duration=5" -c:a libmp3lame -b:a 64k demo.mp3
'
```
