#!/bin/bash
# Lighthouse mobile (default config = Moto G Power emulation, simulated slow 4G), 3 runs per URL.
cd "$(dirname "$0")"
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
G=7855be62-4526-4fd2-97cd-cab389676ac1
PORT=${PORT:-3111}
OUT=${OUT:-lh}
mkdir -p "$OUT"
i=0
for path in / /g/customs /g/customs/leaderboard /g/customs/games /g/customs/games/$G /g/customs/stats; do
  i=$((i+1))
  for run in 1 2 3; do
    npx -y lighthouse@13.5.0 "http://localhost:$PORT$path" --only-categories=performance --output=json \
      --output-path="$OUT/r$i-$run.json" --chrome-flags="--headless=new" --quiet || echo "FAIL $path $run"
  done
done
echo done
