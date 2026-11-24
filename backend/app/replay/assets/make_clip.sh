#!/bin/sh
# Builds demo.mp4 / demo.webm from gallery-1..5.jpg (see README.md): Ken Burns per image, 0.3 s crossfades, starts and ends on gallery-1.
set -e
A=${ASSETS:-/assets}
N=48                       # frames per segment at 30 fps (1.6 s)
zp() {                     # zp ZOOM0 ZOOM1 PX0 PX1 PY0 PY1  (pan factors 0..1 across the free area of the zoom window)
  echo "zoompan=z='$1+($2-$1)*on/$N':x='(iw-iw/zoom)*($3+($4-$3)*on/$N)':y='(ih-ih/zoom)*($5+($6-$5)*on/$N)':d=$N:s=1280x720:fps=30,format=yuv420p,setsar=1"
}
CROP() { echo "crop=1600:900:0:$1,scale=3840:2160:flags=lanczos"; }  # 4:3 -> 16:9, then upscale so zoompan does not jitter

ffmpeg -y -v error \
  -i $A/gallery-1.jpg -i $A/gallery-2.jpg -i $A/gallery-3.jpg -i $A/gallery-4.jpg -i $A/gallery-5.jpg -i $A/gallery-1.jpg \
  -f lavfi -i "sine=frequency=220:duration=8.1" -f lavfi -i "sine=frequency=277.18:duration=8.1" -f lavfi -i "sine=frequency=329.63:duration=8.1" \
  -filter_complex "
[0:v]$(CROP 150),$(zp 1.0 1.15 0.5 0.5 0.5 0.5)[v0];
[1:v]$(CROP 220),$(zp 1.05 1.2 0.9 1.0 0.5 0.5)[v1];
[2:v]split[a][b];[a]scale=960:540:force_original_aspect_ratio=increase,crop=960:540,boxblur=12:3,scale=3840:2160[bg];[b]scale=-2:2160[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,$(zp 1.0 1.08 0.5 0.5 0.5 0.5)[v2];
[3:v]$(CROP 185),$(zp 1.2 1.45 0.5 0.5 0.5 0.5)[v3];
[4:v]$(CROP 266),$(zp 1.0 1.15 0.4 0.35 0.5 0.5)[v4];
[5:v]$(CROP 150),$(zp 1.15 1.0 0.5 0.5 0.5 0.5)[v5];
[v0][v1]xfade=transition=fade:duration=0.3:offset=1.3[x1];
[x1][v2]xfade=transition=fade:duration=0.3:offset=2.6[x2];
[x2][v3]xfade=transition=fade:duration=0.3:offset=3.9[x3];
[x3][v4]xfade=transition=fade:duration=0.3:offset=5.2[x4];
[x4][v5]xfade=transition=fade:duration=0.3:offset=6.5[v];
[6:a][7:a][8:a]amix=inputs=3:normalize=0,volume=0.05,afade=t=in:d=0.8,afade=t=out:st=7.1:d=1.0[a]" \
  -map "[v]" -map "[a]" -r 30 -t 8.1 -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart /out/demo.mp4
ffmpeg -y -v error -i /out/demo.mp4 -c:v libvpx-vp9 -crf 34 -b:v 0 -cpu-used 2 -row-mt 1 -pix_fmt yuv420p -c:a libopus -b:a 48k /out/demo.webm
