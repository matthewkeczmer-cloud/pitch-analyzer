# ⚾ MLB Pitch Analyzer

Watch any MLB game and get live, expert-level commentary on pitching strategy — powered by Claude AI. No scoreboard narration, just real baseball analysis: why was that pitch thrown there? What's the pitcher setting up? What does this sequence tell us about the matchup?

---

## What you need before you start

1. **A modern web browser** — Chrome, Firefox, Safari, or Edge. Any recent version works.
2. **An Anthropic API key** — this is what lets the app talk to Claude AI. See below for how to get one.
3. **No installation required** — just open a file in your browser.

---

## Getting an Anthropic API key

The app uses Claude AI to generate its analysis. You need a personal API key to use it. Here's how to get one:

1. Go to **[console.anthropic.com](https://console.anthropic.com)** and create a free account.
2. Once logged in, click **"API Keys"** in the left sidebar.
3. Click **"Create Key"**, give it any name you like (e.g. "Pitch Analyzer"), and copy the key it shows you.
4. Your key will look something like: `sk-ant-api03-...`

> **Cost:** The app uses Claude Haiku, Anthropic's fastest and most affordable model. Analyzing a full 9-inning game in "Each At-Bat" mode typically costs less than $0.05. You can set a monthly spending limit in the Anthropic console.

> **Privacy:** Your API key is stored only in your own browser. It is never sent to any server other than Anthropic's — the app talks to Anthropic directly from your computer.

---

## Opening the app

1. Download or clone this project to your computer.
2. Open the **`index.html`** file directly in your browser. You can do this by:
   - Double-clicking `index.html` in your file manager, or
   - Dragging it into an open browser window.
3. That's it — no servers, no installation, no accounts beyond the API key.

---

## Using the app

### Step 1 — Enter your API key

The first time you open the app, you'll see a screen asking for your Anthropic API key. Paste the key you copied from the Anthropic console and click **Save & Continue**.

Your key is saved in your browser so you won't have to enter it again.

---

### Step 2 — Pick a game

You'll see today's MLB schedule. Games are sorted with live games at the top.

- **Live** (green dot) — the game is in progress right now
- **Scheduled** (blue) — the game starts later today; you can open it but analysis won't begin until first pitch
- **Final** (gray) — the game is over; you can replay it pitch by pitch or at-bat by at-bat
- **Postponed** — not available

Click any available game to continue.

---

### Step 3 — Choose your analysis mode

**Each At-Bat** *(recommended for most fans)*
Analysis appears after each complete at-bat. You get a full breakdown of the pitch sequence, what the pitcher was trying to do, and how the matchup played out. Less frequent, more in-depth.

**Every Pitch**
A new analysis appears after every single pitch is thrown. Great if you want real-time, pitch-by-pitch commentary. More frequent and shorter responses.

Click **Start Analysis** when ready.

---

### Step 4 — Watch the feed

The analysis feed updates automatically as the game progresses. Each card shows:

- **The pitch or at-bat result** in the headline
- **Ball/strike count dots** — filled green dots are balls, red are strikes
- **▦ Show Zone** — tap to reveal a diagram of where in the strike zone the pitch landed (only appears when location data is available)
- **▸ Context** — tap to see the raw game data that was sent to Claude
- **The AI analysis** — streams in live as Claude writes it

At the top of the screen you'll also see:

- **Score and situation** — current score, inning, outs, and base runners
- **📊 Pitcher Stats** — tap to see the current pitcher's season statistics

The app checks for new pitches every 5 seconds. You don't need to refresh anything.

---

### Replaying a finished game

If you select a game marked **Final**, you'll get a replay mode instead of live updates.

- Press **Next Play →** to step through each play one at a time
- You can also press **Space** or the **right arrow key** on your keyboard
- The app will analyze each play in order, just as if you were watching it live

---

## Tips

- **Leave the tab open** — the app keeps running in the background and the feed will fill in even if you're in another tab (though your browser may slow down updates if the tab is backgrounded for a long time).
- **Scroll up freely** — the feed pauses auto-scrolling when you scroll up to read something, and resumes when you scroll back to the bottom.
- **Change your API key** — tap the "API Key" button in the top right corner of the game list screen.
- **Works offline for replay** — once a game's data is loaded, replay mode works without an internet connection for the MLB data (you still need a connection to reach Claude).

---

## Troubleshooting

**"Key must start with sk-ant-"**
You may have copied an incomplete key or the wrong thing. Go back to [console.anthropic.com](https://console.anthropic.com), find your key, and copy it again in full.

**"Invalid API key — check Settings"**
Your key was accepted by the app but rejected by Anthropic. This usually means the key was deleted or deactivated in your Anthropic console. Generate a new one.

**Games list is empty**
The MLB schedule API returns no games during the off-season (roughly November through February) or on off-days. Try again on a game day.

**Analysis stopped appearing**
The app skips a polling cycle if an analysis is still streaming. If it seems stuck for more than 30 seconds, try scrolling to the bottom of the feed — if there's a partial card there, it may still be loading. You can also go back to the game list and reopen the game to restart.

**The app looks broken or won't load**
Make sure you're opening `index.html` from the folder that also contains `styles.css` and `app.js`. All three files need to be in the same folder.

---

## MLB Season Availability

The app only shows real games during the active MLB season. The regular season typically runs **late March through late September**, with the postseason through late October. There are no games to watch in the off-season, but you can always replay past games from any day in the current season.
