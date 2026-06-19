# HoopLens

HoopLens is a no-npm local NBA event video explorer.

## What is new in this version

- Removed all OVR/overall rating display from the 2K-style roster and player card.

- Site name changed to **HoopLens**.
- Fixed the player-search dropdown so it stays above the rest of the page.
- Added an always-visible **All possible HoopLens tags** guide.
- Expanded special tags beyond buzzer/clutch/game-winner tags.
- Added inferred detail tags for visible play-by-play wording like one-hand dunk, two-hand dunk, alley-oop, putback, reverse, step back, pullup, floater, fadeaway, hook shot, tip shot, bank shot, and more.
- Added defense/possession tags where basic NBA play-by-play supports them, including defensive stop, block, steal, defensive rebound, shot blocked, and forced turnover.
- Kept the Season Tape and Game Mix tabs.
- Still no `npm install` required.

## Run on Windows

1. Right-click the zip and choose **Extract All**.
2. Open the extracted folder.
3. Double-click `start-windows.bat`.
4. Open Chrome/Edge to:

```txt
http://localhost:3000
```

## How to use

1. Choose a season and season type.
2. Type a player name, such as `Josh Hart`.
3. Pick the player from the dropdown.
4. Click **Load this player's games**.
5. Use one of the three tabs:
   - **Player Game**: one player in one game.
   - **Season Tape**: one player across the whole selected season.
   - **Game Mix**: everyone in one selected game.
6. Use the event group, play type, shot type, and special tag checklists.
7. Click **Load video** on a card, or **Load visible videos**.

## Important limitation

Some ideas like **Scored On / Primary Defender** are not reliably available in basic NBA play-by-play because made-shot events usually do not identify the defender. HoopLens will label what it can infer, but it will not fake unavailable matchup-tracking data.

NBA.com controls which event clips return direct MP4 URLs. If a card does not play inside the app, click the **NBA page** button on that card.

## Requirements

Node.js 18 or newer.

To check:

```bash
node -v
```
