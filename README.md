# 🌐 BhashaMeet — भाषा Bridge Video Conferencing

A **completely free** Google Meet–quality video conferencing app with an exclusive **Bhasha Bridge** feature that provides **live AI-powered translation captions** in 15+ Indian languages — all running locally with no paid services required.

---

## ✨ Features

### Core Meeting Features (Google Meet parity)
| Feature | Status |
|---|---|
| HD Video & Audio | ✅ |
| Create Meeting Link | ✅ |
| Join via Code or Link | ✅ |
| Mute / Unmute Mic | ✅ |
| Camera On / Off | ✅ |
| Screen Sharing | ✅ |
| In-Meeting Chat | ✅ |
| Raise Hand | ✅ |
| Participant List | ✅ |
| Meeting Timer | ✅ |
| No Account Required | ✅ |

### 🌐 Bhasha Bridge (Exclusive)
- **Live Speech Recognition** — Uses browser's built-in Web Speech API (free, no API key)
- **Auto-Translation** — Translates English speech into each participant's chosen language via Google Translate (free tier)
- **Per-User Language** — Every participant independently picks their preferred language
- **Real-time Captions** — Captions appear live in the meeting UI, showing original + translated text
- **Language Switcher** — Change language mid-meeting without rejoining
- **15+ Indian Languages** supported

---

## 🇮🇳 Supported Languages

| Language | Code |
|---|---|
| English | `en` |
| Hindi (हिन्दी) | `hi` |
| Bengali (বাংলা) | `bn` |
| Telugu (తెలుగు) | `te` |
| Marathi (मराठी) | `mr` |
| Tamil (தமிழ்) | `ta` |
| Gujarati (ગુજરાતી) | `gu` |
| Kannada (ಕನ್ನಡ) | `kn` |
| Malayalam (മലയാളം) | `ml` |
| Punjabi (ਪੰਜਾਬੀ) | `pa` |
| Odia (ଓଡ଼ିଆ) | `or` |
| Assamese (অসমীয়া) | `as` |
| Urdu (اردو) | `ur` |
| Nepali (नेपाली) | `ne` |

---

## 🚀 Setup & Running

### Prerequisites
- Python 3.9+
- Google Chrome (for Web Speech API & best WebRTC support)
- Pip

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the server

```bash
python app.py
```

The server starts at **http://localhost:5000**

### 3. Open in browser

Open **http://localhost:5000** in Google Chrome.

> **⚠️ Important:** Use Google Chrome for best experience. The Web Speech API (required for Bhasha Bridge live transcription) works best in Chrome. Firefox and Safari have limited or no support.

---

## 📁 Project Structure

```
bhasha-meet/
├── app.py                 # Flask server, Socket.IO signaling, translation API
├── index.html             # Landing page template
├── meeting.html           # Meeting room template
├── index.css              # Landing page styles
├── meeting.css            # Meeting room styles
├── meeting.js             # WebRTC, Socket.IO, Bhasha Bridge logic
├── favicon.svg            # Site icon
├── requirements.txt
└── README.md
```

---

## 🏗️ Architecture

```
Browser A (Speaker)                    Browser B (Listener)
     │                                       │
     │  1. Speech → Web Speech API           │
     │  2. Text → Socket.IO "transcript"     │
     │             │                         │
     │         Flask Server                  │
     │             │ 3. Translates per-user  │
     │             │    via deep-translator  │
     │             │ 4. Emits to each peer   │
     │             │    in their language    │
     │             └──────────────────────> │
     │                                   5. Show caption
     │                                      in Hindi/Tamil/etc.
     │
     │ ── WebRTC Peer-to-Peer Video/Audio ─────────────────────>│
     │    (direct browser-to-browser, no server relay needed)
```

### Technology Stack
| Layer | Technology | Cost |
|---|---|---|
| Backend | Python + Flask | Free |
| Real-time | Socket.IO (eventlet) | Free |
| Video/Audio | WebRTC (peer-to-peer) | Free |
| Speech-to-Text | Browser Web Speech API | Free |
| Translation | deep-translator (Google Translate) | Free |
| STUN servers | Google STUN | Free |
| Frontend | Vanilla HTML/CSS/JS | Free |

---

## 🎮 Keyboard Shortcuts

| Key | Action |
|---|---|
| `D` | Toggle microphone |
| `E` | Toggle camera |
| `S` | Toggle screen share |
| `C` | Toggle chat |
| `B` | Toggle Bhasha Bridge |
| `Esc` | Close panels |

---

## 🌐 How Bhasha Bridge Works

1. **You speak** in English (or any language)
2. **Browser Speech API** transcribes your speech to text in real-time
3. **Text is sent** via Socket.IO to the Flask server
4. **Server translates** the text into each participant's preferred language using `deep-translator`
5. **Each participant sees** captions in their chosen Indian language — simultaneously

Example:
- You say: *"The meeting starts at 3 PM"*
- Hindi user sees: *"मीटिंग दोपहर 3 बजे शुरू होती है"*
- Tamil user sees: *"கூட்டம் மதியம் 3 மணிக்கு தொடங்குகிறது"*
- Telugu user sees: *"మీటింగ్ మధ్యాహ్నం 3 గంటలకు ప్రారంభమవుతుంది"*

---

## 🔒 Privacy

- **Video and audio** travel **peer-to-peer** via WebRTC — they never touch the server
- Only **speech transcripts** (text) pass through the server for translation
- **No data is stored** — meetings and transcripts exist only in memory
- **No accounts, no tracking, no ads**

---

## ⚙️ Running on a Network (LAN / public)

To let others on your network join:

```bash
# The server already binds to 0.0.0.0
python app.py

# Share your local IP, e.g.:
# http://192.168.1.100:5000
```

For the internet, deploy on any free host:
- **Railway** — `railway up`
- **Render** — connect GitHub repo
- **Fly.io** — `fly launch`

---

## 🐛 Troubleshooting

| Issue | Fix |
|---|---|
| Camera/mic not working | Allow browser permissions; use HTTPS or localhost |
| Bhasha Bridge not working | Use Google Chrome; unmute mic first |
| Can't connect to peer | Both users need to be on the same network or use a TURN server |
| Translation not working | Check internet connection (Google Translate free API) |
| Peers not connecting through NAT | Add a free TURN server like `openrelay.metered.ca` to ICE config |

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

Built by Lokesh and Chinthana  for Bharat 🇮🇳
