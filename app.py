import os
import uuid
import json
import time
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_cors import CORS

# Translation setup — try multiple backends
def translate(text, target_lang, source_lang='auto'):
    if target_lang == source_lang or target_lang == 'en':
        return text
    try:
        from deep_translator import GoogleTranslator
        t = GoogleTranslator(source=source_lang, target=target_lang)
        return t.translate(text) or text
    except Exception:
        pass
    try:
        from googletrans import Translator
        t = Translator()
        result = t.translate(text, dest=target_lang, src=source_lang if source_lang != 'auto' else 'en')
        return result.text or text
    except Exception:
        pass
    return text  # graceful fallback: return original

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, template_folder=ROOT_DIR, static_folder=ROOT_DIR, static_url_path='')
app.config['SECRET_KEY'] = 'bhasha-meet-secret-2024'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', ping_timeout=60, ping_interval=25)

meetings = {}
participants = {}

SUPPORTED_LANGUAGES = {
    'en': 'English',
    'hi': 'Hindi (हिन्दी)',
    'bn': 'Bengali (বাংলা)',
    'te': 'Telugu (తెలుగు)',
    'mr': 'Marathi (मराठी)',
    'ta': 'Tamil (தமிழ்)',
    'gu': 'Gujarati (ગુજરાતી)',
    'kn': 'Kannada (ಕನ್ನಡ)',
    'ml': 'Malayalam (മലയാളം)',
    'pa': 'Punjabi (ਪੰਜਾਬੀ)',
    'or': 'Odia (ଓଡ଼ିଆ)',
    'as': 'Assamese (অসমীয়া)',
    'ur': 'Urdu (اردو)',
    'ne': 'Nepali (नेपाली)',
    'si': 'Sinhala (සිංහල)',
}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/meeting/<room_id>')
def meeting(room_id):
    room_id = room_id.upper()
    if room_id not in meetings:
        return render_template('index.html', error="Meeting not found")
    return render_template('meeting.html', room_id=room_id)

@app.route('/api/create-meeting', methods=['POST'])
def create_meeting():
    room_id = str(uuid.uuid4())[:8].upper()
    meetings[room_id] = {
        'id': room_id,
        'participants': {},
        'chat': [],
        'created_at': time.time(),
        'host': None
    }
    return jsonify({'room_id': room_id, 'link': f'/meeting/{room_id}'})

@app.route('/api/meeting/<room_id>', methods=['GET'])
def get_meeting(room_id):
    if room_id not in meetings:
        return jsonify({'error': 'Meeting not found'}), 404
    m = meetings[room_id]
    return jsonify({
        'id': room_id,
        'participant_count': len(m['participants']),
        'created_at': m['created_at']
    })

@app.route('/api/languages', methods=['GET'])
def get_languages():
    return jsonify(SUPPORTED_LANGUAGES)

@app.route('/api/translate', methods=['POST'])
def translate_endpoint():
    data = request.json
    text = data.get('text', '')
    target_lang = data.get('target_lang', 'hi')
    source_lang = data.get('source_lang', 'auto')
    if not text:
        return jsonify({'error': 'No text provided'}), 400
    translated = translate(text, target_lang, source_lang)
    return jsonify({'original': text, 'translated': translated, 'target_lang': target_lang})

# ─── Socket.IO ────────────────────────────────────────────────────────────────

@socketio.on('connect')
def on_connect():
    print(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    if sid in participants:
        p = participants[sid]
        room_id = p['room_id']
        name = p['name']
        if room_id in meetings:
            meetings[room_id]['participants'].pop(sid, None)
            emit('participant-left', {
                'sid': sid,
                'name': name,
                'participant_count': len(meetings[room_id]['participants'])
            }, room=room_id)
            leave_room(room_id)
        del participants[sid]

@socketio.on('join-meeting')
def on_join_meeting(data):
    room_id = data.get('room_id')
    name = data.get('name', 'Anonymous')
    language = data.get('language', 'en')
    sid = request.sid

    if room_id not in meetings:
        emit('error', {'message': 'Meeting not found'})
        return

    join_room(room_id)
    participants[sid] = {'room_id': room_id, 'name': name, 'language': language}
    meetings[room_id]['participants'][sid] = {'name': name, 'language': language, 'sid': sid}

    if meetings[room_id]['host'] is None:
        meetings[room_id]['host'] = sid

    emit('participant-joined', {
        'sid': sid, 'name': name, 'language': language,
        'is_host': meetings[room_id]['host'] == sid,
        'participant_count': len(meetings[room_id]['participants'])
    }, room=room_id)

    existing = [
        {'sid': s, 'name': p['name'], 'language': p['language']}
        for s, p in meetings[room_id]['participants'].items()
        if s != sid
    ]
    emit('meeting-joined', {
        'room_id': room_id, 'sid': sid, 'name': name,
        'is_host': meetings[room_id]['host'] == sid,
        'existing_participants': existing,
        'participant_count': len(meetings[room_id]['participants'])
    })

@socketio.on('leave-meeting')
def on_leave_meeting(data):
    room_id = data.get('room_id')
    sid = request.sid
    if room_id in meetings:
        name = participants.get(sid, {}).get('name', 'Someone')
        meetings[room_id]['participants'].pop(sid, None)
        emit('participant-left', {'sid': sid, 'name': name}, room=room_id)
        leave_room(room_id)
    if sid in participants:
        del participants[sid]

@socketio.on('offer')
def on_offer(data):
    emit('offer', {'offer': data['offer'], 'from': request.sid}, room=data['to'])

@socketio.on('answer')
def on_answer(data):
    emit('answer', {'answer': data['answer'], 'from': request.sid}, room=data['to'])

@socketio.on('ice-candidate')
def on_ice_candidate(data):
    emit('ice-candidate', {'candidate': data['candidate'], 'from': request.sid}, room=data['to'])

@socketio.on('chat-message')
def on_chat_message(data):
    room_id = data.get('room_id')
    sid = request.sid
    if room_id not in meetings:
        return
    name = participants.get(sid, {}).get('name', 'Anonymous')
    msg = {'sid': sid, 'name': name, 'message': data.get('message', ''), 'timestamp': time.time()}
    meetings[room_id]['chat'].append(msg)
    emit('chat-message', msg, room=room_id)

@socketio.on('transcript')
def on_transcript(data):
    room_id = data.get('room_id')
    sid = request.sid
    if room_id not in meetings:
        return

    speaker_name = participants.get(sid, {}).get('name', 'Speaker')
    original_text = data.get('text', '')
    source_lang = data.get('detected_lang', 'en')

    emit('transcript-original', {
        'sid': sid, 'name': speaker_name,
        'text': original_text, 'source_lang': source_lang,
        'timestamp': time.time()
    }, room=room_id)

    room_participants = meetings[room_id]['participants']
    target_langs = set()
    for p_sid, p_info in room_participants.items():
        if p_sid != sid:
            target_langs.add(p_info.get('language', 'en'))

    translations = {}
    for lang in target_langs:
        if lang == source_lang:
            translations[lang] = original_text
        else:
            translations[lang] = translate(original_text, lang, source_lang)

    for p_sid, p_info in room_participants.items():
        if p_sid != sid:
            p_lang = p_info.get('language', 'en')
            translated = translations.get(p_lang, original_text)
            emit('transcript-translated', {
                'sid': sid, 'name': speaker_name,
                'original': original_text,
                'translated': translated,
                'source_lang': source_lang,
                'target_lang': p_lang,
                'timestamp': time.time()
            }, room=p_sid)

@socketio.on('update-language')
def on_update_language(data):
    sid = request.sid
    lang = data.get('language', 'en')
    room_id = data.get('room_id')
    if sid in participants:
        participants[sid]['language'] = lang
    if room_id in meetings and sid in meetings[room_id]['participants']:
        meetings[room_id]['participants'][sid]['language'] = lang

@socketio.on('media-state')
def on_media_state(data):
    room_id = data.get('room_id')
    emit('media-state', {
        'sid': request.sid, 'audio': data.get('audio'), 'video': data.get('video')
    }, room=room_id, include_self=False)

@socketio.on('screen-share-started')
def on_screen_share(data):
    emit('screen-share-started', {'sid': request.sid}, room=data.get('room_id'), include_self=False)

@socketio.on('screen-share-stopped')
def on_screen_share_stopped(data):
    emit('screen-share-stopped', {'sid': request.sid}, room=data.get('room_id'), include_self=False)

@socketio.on('raise-hand')
def on_raise_hand(data):
    room_id = data.get('room_id')
    name = participants.get(request.sid, {}).get('name', 'Someone')
    emit('hand-raised', {'sid': request.sid, 'name': name}, room=room_id)

@socketio.on('lower-hand')
def on_lower_hand(data):
    emit('hand-lowered', {'sid': request.sid}, room=data.get('room_id'))

if __name__ == '__main__':
    print("🚀 BhashaMeet starting on http://localhost:5000")
    print("🌐 Bhasha Bridge: live translation for 15+ Indian languages")
    print("📋 Open in Google Chrome for best experience")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False)
