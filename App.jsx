import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, Play, Square, Download, Volume2, Sparkles, UserCheck, 
  Upload, Sliders, Users, Wand2, RefreshCw, AudioWaveform, 
  CheckCircle2, AlertCircle, Trash2, HelpCircle, FileAudio,
  Key, Eye, EyeOff, ShieldCheck
} from 'lucide-react';

// --- CONFIGURATION DES VOIX GEMINI ---
const GEMINI_VOICES = [
  { id: 'Kore', name: 'Kore', desc: 'Ferme, posée et professionnelle', gender: 'Féminin', tags: ['calme', 'ferme', 'pro'] },
  { id: 'Puck', name: 'Puck', desc: 'Enjouée, dynamique et chaleureuse', gender: 'Masculin', tags: ['dynamique', 'jeune', 'enjoué'] },
  { id: 'Charon', name: 'Charon', desc: 'Profonde, informative et rassurante', gender: 'Masculin', tags: ['grave', 'informatif', 'documentaire'] },
  { id: 'Zephyr', name: 'Zephyr', desc: 'Claire, lumineuse et expressive', gender: 'Féminin', tags: ['clair', 'lumineux', 'publicité'] },
  { id: 'Fenrir', name: 'Fenrir', desc: 'Énergique, enthousiaste et vive', gender: 'Masculin', tags: ['énergique', 'fort', 'enthousiaste'] },
  { id: 'Aoede', name: 'Aoede', desc: 'Douce, naturelle et fluide', gender: 'Féminin', tags: ['doux', 'naturel', 'narration'] },
  { id: 'Orus', name: 'Orus', desc: 'Autoritaire, claire et grave', gender: 'Masculin', tags: ['autoritaire', 'sérieux', 'corporate'] },
  { id: 'Leda', name: 'Leda', desc: 'Jeune, fraîche et spontanée', gender: 'Féminin', tags: ['jeune', 'frais', 'spontané'] },
];

const STYLE_PRESETS = [
  { label: 'Naturel', instruction: 'Parle de manière naturelle, fluide et posée' },
  { label: 'Publicité Dynamique', instruction: 'Parle avec un ton enthousiaste, souriant, commercial et très dynamique' },
  { label: 'Documentaire', instruction: 'Parle avec une voix grave, posée, captivante et sérieuse comme dans un documentaire' },
  { label: 'Conteur / Histoire', instruction: 'Parle avec un ton chaleureux, mystérieux et expressif comme pour raconter une histoire' },
  { label: 'Journal Télévisé', instruction: 'Parle avec un débit rapide, professionnel, articulé et informatif' },
  { label: 'Chuchotement ASMR', instruction: 'Parle en chuchotant doucement et calmement près du microphone' }
];

// --- UTILITAIRES AUDIO (PCM16 vers WAV) ---
function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function pcmToWav(pcm16, sampleRate = 24000) {
  const buffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(buffer);

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 pour PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true);  // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true);  // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(view, 36, 'data');
  view.setUint32(40, pcm16.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) {
    view.setInt16(offset, pcm16[i], true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Toutes les requêtes Gemini passent par le proxy (Cloudflare Worker).
// La clé Gemini reste côté serveur : elle n'est jamais envoyée au navigateur.
async function requestGemini(model, payload) {
  const response = await fetch(`/api/gemini/${encodeURIComponent(model)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.error?.message || result?.message || `Erreur serveur (${response.status})`;
    throw new Error(message);
  }
  return result;
}

export default function App() {
  // Navigation & Mode
  const [activeTab, setActiveTab] = useState('studio'); // 'studio' | 'clone' | 'dialogue'

  // État du service (la clé est gérée côté serveur, dans /admin)
  const [apiStatus, setApiStatus] = useState({ ready: false, generationAllowed: false });

  useEffect(() => {
    fetch('/api/status', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setApiStatus({ ready: Boolean(d?.ready), generationAllowed: Boolean(d?.generationAllowed) }))
      .catch(() => {});
  }, []);

  // État du Studio Voix Off Simple
  const [scriptText, setScriptText] = useState(
    "Bienvenue dans votre studio de création vocale propulsé par Gemini. Transformez n'importe quel texte en une voix off ultra-réaliste en quelques secondes !"
  );
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [styleInstruction, setStyleInstruction] = useState(STYLE_PRESETS[0].instruction);
  const [speed, setSpeed] = useState('normal'); // 'lent' | 'normal' | 'rapide'
  const [ttsModel, setTtsModel] = useState('gemini-3.1-flash-tts-preview');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptTopic, setScriptTopic] = useState('');

  // État du Mode Dialogue Multi-Voix
  const [speaker1Name, setSpeaker1Name] = useState('Alex');
  const [speaker1Voice, setSpeaker1Voice] = useState('Puck');
  const [speaker2Name, setSpeaker2Name] = useState('Sophie');
  const [speaker2Voice, setSpeaker2Voice] = useState('Kore');
  const [dialogueScript, setDialogueScript] = useState(
    "Alex: Salut Sophie ! Tu as testé le nouveau générateur de voix off avec Gemini ?\nSophie: Oui Alex, c'est impressionnant ! On peut même créer des dialogues complets et cloner le style d'une voix."
  );

  // État des profils de style vocal
  const [clonedVoices, setClonedVoices] = useState([
    {
      id: 'clone-demo-1',
      name: 'Ma Voix Expressive (Démo)',
      baseVoice: 'Fenrir',
      stylePrompt: 'Parle avec un ton chaleureux, dynamique, légèrement grave et très articulé, avec des pauses naturelles',
      characteristics: 'Ton chaleureux, rythme soutenu, énergie communicative',
      createdAt: 'Préréglage'
    }
  ]);
  const [activeCloneId, setActiveCloneId] = useState(null);
  const [cloneName, setCloneName] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedPreviewUrl, setRecordedPreviewUrl] = useState(null);
  const [isAnalyzingVoice, setIsAnalyzingVoice] = useState(false);

  // État de Génération Audio & Historique
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [audioHistory, setAudioHistory] = useState([]);
  const [currentAudio, setCurrentAudio] = useState(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackVolume, setPlaybackVolume] = useState(1);
  const [audioEffect, setAudioEffect] = useState('none');

  // Références
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const mainAudioPlayerRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioFilterRef = useRef(null);

  // Contrôles de lecture et chaîne d'effets (lecture en temps réel).
  useEffect(() => {
    const player = mainAudioPlayerRef.current;
    if (player) { player.playbackRate = playbackRate; player.volume = playbackVolume; }
  }, [playbackRate, playbackVolume, currentAudio]);

  useEffect(() => {
    const filter = audioFilterRef.current;
    if (!filter) return;
    const presets = {
      none: { type: 'allpass', frequency: 1000, Q: 0.7 },
      bass: { type: 'lowshelf', frequency: 180, Q: 0.7, gain: 7 },
      bright: { type: 'highshelf', frequency: 2800, Q: 0.7, gain: 5 },
      telephone: { type: 'bandpass', frequency: 1500, Q: 0.8 },
      deep: { type: 'lowshelf', frequency: 140, Q: 0.7, gain: 4 }
    };
    const preset = presets[audioEffect] || presets.none;
    filter.type = preset.type; filter.frequency.value = preset.frequency; filter.Q.value = preset.Q;
    if (preset.gain !== undefined) filter.gain.value = preset.gain;
  }, [audioEffect]);

  const enableAudioEffects = async () => {
    const player = mainAudioPlayerRef.current;
    if (!player) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current) {
        const ctx = new AudioCtx();
        const source = ctx.createMediaElementSource(player);
        const filter = ctx.createBiquadFilter();
        source.connect(filter); filter.connect(ctx.destination);
        audioContextRef.current = ctx; audioSourceRef.current = source; audioFilterRef.current = filter;
      }
      await audioContextRef.current.resume();
    } catch (error) {
      showToast('Effets audio indisponibles dans ce navigateur.', true);
    }
  };

  // Nettoyage du timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      audioContextRef.current?.close?.();
      audioHistory.forEach(track => track.url && URL.revokeObjectURL(track.url));
      if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl);
    };
  }, []);

  const showToast = (msg, isError = false) => {
    if (isError) {
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(null), 6000);
    } else {
      setSuccessMessage(msg);
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  };

  // --- 1. ASSISTANT IA DE RÉDACTION DE SCRIPT ---
  const handleGenerateScriptWithAI = async () => {
    if (!scriptTopic.trim()) {
      showToast("Veuillez décrire le sujet de votre script.", true);
      return;
    }
    setIsGeneratingScript(true);
    setErrorMessage(null);

    try {
      let systemPrompt = "";
      let prompt = "";

      if (activeTab === 'dialogue') {
        systemPrompt = `Tu es un scénariste audio expert. Écris uniquement le dialogue entre ${speaker1Name} et ${speaker2Name}, sans didascalies entre parenthèses, prêt à être lu par un moteur TTS. Format strict : "${speaker1Name}: texte\n${speaker2Name}: texte".`;
        prompt = `Rédige un court dialogue captivant (environ 4 à 6 répliques) en français sur le sujet suivant : ${scriptTopic}`;
      } else {
        systemPrompt = "Tu es un rédacteur professionnel de voix off (publicité, YouTube, documentaire, formation). Écris uniquement le texte à lire à voix haute, sans indications de mise en scène ni crochets. Le texte doit être fluide, percutant et prêt à être prononcé.";
        prompt = `Rédige un script de voix off en français (environ 50 à 80 mots) sur le sujet suivant : ${scriptTopic}`;
      }

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      };

      const result = await requestGemini('gemini-3-flash-preview', payload);
      const generatedText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (generatedText) {
        if (activeTab === 'dialogue') {
          setDialogueScript(generatedText.trim());
        } else {
          setScriptText(generatedText.trim());
        }
        showToast("Script généré avec succès par Gemini !");
      } else {
        throw new Error("Réponse inattendue de l'API.");
      }
    } catch (err) {
      showToast("Erreur lors de la génération du script : " + err.message, true);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // --- 2. GÉNÉRATION DE LA VOIX OFF (TTS GEMINI) ---
  const handleGenerateVoiceover = async () => {
    setErrorMessage(null);
    setIsSynthesizing(true);

    try {
      let payload = {};
      let titleLabel = "";
      let voiceUsedLabel = "";

      if (activeTab === 'dialogue') {
        if (!dialogueScript.trim()) {
          throw new Error("Veuillez saisir un dialogue à synthétiser.");
        }
        if (dialogueScript.length > 12000) throw new Error('Le dialogue dépasse la limite de 12 000 caractères.');
        payload = {
          contents: [{
            parts: [{
              text: `TTS the following conversation between ${speaker1Name} and ${speaker2Name}:\n${dialogueScript}`
            }]
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  { speaker: speaker1Name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker1Voice } } },
                  { speaker: speaker2Name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker2Voice } } }
                ]
              }
            }
          }
        };
        titleLabel = `Dialogue (${speaker1Name} & ${speaker2Name})`;
        voiceUsedLabel = `${speaker1Voice} + ${speaker2Voice}`;
      } else {
        if (!scriptText.trim()) {
          throw new Error("Veuillez entrer le texte de la voix off.");
        }
        if (scriptText.length > 12000) throw new Error('Le texte dépasse la limite de 12 000 caractères.');

        // Vérifier si on utilise un clone vocal ou une voix standard
        const activeClone = clonedVoices.find(c => c.id === activeCloneId);
        const targetVoiceName = activeClone ? activeClone.baseVoice : selectedVoice;
        const baseInstruction = activeClone ? activeClone.stylePrompt : styleInstruction;

        const speedNote = speed === 'lent' ? 'avec un débit lent et posé' : speed === 'rapide' ? 'avec un débit rapide et énergique' : '';
        const fullPrompt = `${baseInstruction} ${speedNote} : ${scriptText}`;

        payload = {
          contents: [{
            parts: [{ text: fullPrompt }]
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: targetVoiceName }
              }
            }
          }
        };

        titleLabel = scriptText.slice(0, 45) + (scriptText.length > 45 ? '...' : '');
        voiceUsedLabel = activeClone ? `Profil : ${activeClone.name}` : `Voix : ${targetVoiceName}`;
      }

      const result = await requestGemini(ttsModel, payload);

      const part = result?.candidates?.[0]?.content?.parts?.[0];
      const audioData = part?.inlineData?.data;
      const mimeType = part?.inlineData?.mimeType || "audio/L16;rate=24000";

      if (audioData) {
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
        const audioBuffer = base64ToArrayBuffer(audioData);
        const audioBytes = new Uint8Array(audioBuffer);
        const isWavFile = audioBytes.length >= 12 &&
          String.fromCharCode(...audioBytes.slice(0, 4)) === 'RIFF' &&
          String.fromCharCode(...audioBytes.slice(8, 12)) === 'WAVE';
        // Gemini 3.8 TTS renvoie un WAV complet par défaut ; les anciens modèles
        // peuvent encore renvoyer du PCM brut, qui doit être encapsulé en WAV.
        const wavBlob = isWavFile
          ? new Blob([audioBuffer], { type: 'audio/wav' })
          : pcmToWav(new Int16Array(audioBuffer), sampleRate);
        const audioUrl = URL.createObjectURL(wavBlob);

        const newTrack = {
          id: Date.now().toString(),
          title: titleLabel,
          voiceLabel: voiceUsedLabel,
          url: audioUrl,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setCurrentAudio(newTrack);
        setAudioHistory(prev => [newTrack, ...prev]);
        showToast("Voix off générée avec succès !");

        setTimeout(() => {
          if (mainAudioPlayerRef.current) {
            mainAudioPlayerRef.current.play().catch(() => {});
          }
        }, 150);
      } else {
        throw new Error("Aucune donnée audio reçue du modèle.");
      }
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // --- 3. ENREGISTREMENT & CLONAGE VOCAL (ANALYSE MULTIMODALE GEMINI) ---
  const startRecording = async () => {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        const previewUrl = URL.createObjectURL(audioBlob);
        setRecordedBlob(audioBlob);
        setRecordedPreviewUrl(previewUrl);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      showToast("Impossible d'accéder au microphone. Vérifiez les permissions de votre navigateur ou importez un fichier audio.", true);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') || file.size > 5 * 1024 * 1024) {
      showToast('Fichier invalide : choisissez un audio de 5 Mo maximum.', true);
      e.target.value = '';
      return;
    }
    setRecordedBlob(file);
    setRecordedPreviewUrl(URL.createObjectURL(file));
    showToast(`Fichier "${file.name}" chargé pour l'analyse du profil.`);
  };

  const handleAnalyzeAndCloneVoice = async () => {
    if (!recordedBlob) {
      showToast("Veuillez d'abord enregistrer ou importer un échantillon audio.", true);
      return;
    }
    if (!cloneName.trim()) {
      showToast("Veuillez donner un nom à votre profil vocal.", true);
      return;
    }

    setIsAnalyzingVoice(true);
    setErrorMessage(null);

    try {
      const base64Audio = await blobToBase64(recordedBlob);
      const mimeType = recordedBlob.type || 'audio/webm';

      const prompt = `Analyse attentivement cet échantillon vocal pour créer un profil de style vocal. Il ne s'agit pas de reproduire l'identité de la personne.
      Détermine :
      1. "baseVoice" : Choisis parmi ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Aoede', 'Orus', 'Leda'] la voix qui correspond le mieux au timbre et au registre (Masculin : Puck, Charon, Fenrir, Orus ; Féminin : Kore, Zephyr, Aoede, Leda).
      2. "stylePrompt" : Rédige une directive précise en français pour le moteur TTS afin d'imiter exactement cette manière de parler (rythme, intonation, chaleur, énergie, émotion, accentuation). Commence par "Parle avec...".
      3. "characteristics" : Un résumé court en français (max 12 mots) des caractéristiques acoustiques détectées.`;

      const payload = {
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Audio
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              baseVoice: { type: "STRING" },
              stylePrompt: { type: "STRING" },
              characteristics: { type: "STRING" }
            },
            propertyOrdering: ["baseVoice", "stylePrompt", "characteristics"]
          }
        }
      };

      const result = await requestGemini('gemini-3-flash-preview', payload);
      const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!jsonText) {
        throw new Error("Impossible d'analyser l'échantillon vocal.");
      }

      const parsed = JSON.parse(jsonText);
      const validVoice = GEMINI_VOICES.some(v => v.id === parsed.baseVoice) ? parsed.baseVoice : 'Kore';

      const newClone = {
        id: 'clone-' + Date.now(),
        name: cloneName.trim(),
        baseVoice: validVoice,
        stylePrompt: parsed.stylePrompt || 'Parle de manière naturelle et expressive',
        characteristics: parsed.characteristics || 'Profil vocal personnalisé',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setClonedVoices(prev => [newClone, ...prev]);
      setActiveCloneId(newClone.id);
      setCloneName('');
      showToast(`Profil vocal "${newClone.name}" créé et activé !`);
      setActiveTab('studio');
    } catch (err) {
      showToast("Erreur lors de l'analyse vocale : " + err.message, true);
    } finally {
      setIsAnalyzingVoice(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* BARRE DE NAVIGATION SUPÉRIEURE */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <AudioWaveform className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">VoxGemini Studio</h1>
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  STUDIO AUDIO IA
                </span>
              </div>
              <p className="text-xs text-slate-400">Voix off, profils de style et dialogues multi-voix</p>
            </div>
          </div>

          {/* Onglets de navigation + Bouton Clé API */}
          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('studio')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'studio'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Volume2 className="w-4 h-4" />
                <span>Voix Off Solo</span>
              </button>
              <button
                onClick={() => setActiveTab('clone')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'clone'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>Profil vocal</span>
                <span className="w-5 h-5 rounded-full bg-indigo-500/30 text-indigo-200 text-xs flex items-center justify-center">
                  {clonedVoices.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('dialogue')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'dialogue'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Dialogue Multi-Voix</span>
              </button>
            </nav>

            {/* Accès à l'espace administrateur (la clé API se configure là-bas) */}
            <a
              href="/admin"
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                (apiStatus.ready && apiStatus.generationAllowed)
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-indigo-500/50'
              }`}
              title="Espace administrateur"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{!apiStatus.ready ? 'Service non configuré' : !apiStatus.generationAllowed ? 'Connexion requise' : 'Admin'}</span>
            </a>
          </div>
        </div>

      </header>

      {/* NOTIFICATIONS TOAST */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-4">
        {errorMessage && (
          <div className="mb-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span className="text-sm">{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-xs text-rose-300 hover:underline">Fermer</button>
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span className="text-sm">{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="text-xs text-emerald-300 hover:underline">OK</button>
          </div>
        )}
      </div>

      {/* CONTENU PRINCIPAL */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* COLONNE GAUCHE (8 cols) : ÉDITEUR OU STUDIO DE CLONAGE */}
        <div className="lg:col-span-8 space-y-6">

          {/* === ONGLET 1 : STUDIO VOIX OFF SOLO === */}
          {activeTab === 'studio' && (
            <>
              {/* Sélecteur de Voix ou Clone Actif */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    1. Choisir une voix ou un profil de style
                  </h2>
                  <button
                    onClick={() => setActiveTab('clone')}
                    className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    + Créer un profil vocal
                  </button>
                </div>

                {/* Vos profils vocaux */}
                {clonedVoices.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-fuchsia-400">Vos Profils de style enregistrés</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {clonedVoices.map((clone) => {
                        const isSelected = activeCloneId === clone.id;
                        return (
                          <div
                            key={clone.id}
                            onClick={() => setActiveCloneId(clone.id)}
                            className={`cursor-pointer p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                              isSelected
                                ? 'bg-fuchsia-950/40 border-fuchsia-500 shadow-lg shadow-fuchsia-500/10'
                                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-white">{clone.name}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">
                                  Profil ({clone.baseVoice})
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 line-clamp-1">{clone.characteristics}</p>
                            </div>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center mt-1 ${
                              isSelected ? 'border-fuchsia-400 bg-fuchsia-500' : 'border-slate-600'
                            }`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Voix Studio Native Gemini */}
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Voix Studio Haute Définition</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {GEMINI_VOICES.map((voice) => {
                      const isSelected = !activeCloneId && selectedVoice === voice.id;
                      return (
                        <button
                          key={voice.id}
                          onClick={() => {
                            setActiveCloneId(null);
                            setSelectedVoice(voice.id);
                          }}
                          className={`text-left p-3 rounded-xl border transition-all ${
                            isSelected
                              ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md shadow-indigo-500/10'
                              : 'bg-slate-950/60 border-slate-800/90 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm">{voice.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                              {voice.gender}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-2 leading-tight">{voice.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Direction d'Acteur & Intonation */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    2. Direction d'Acteur & Intonation
                  </h2>
                  <label className="text-[11px] text-slate-400 flex items-center gap-2">Modèle TTS
                    <select value={ttsModel} onChange={e => setTtsModel(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
                      <option value="gemini-3.1-flash-tts-preview">Gemini 3.1 Flash TTS (qualité)</option>
                      <option value="gemini-2.5-flash-preview-tts">Gemini 2.5 Flash TTS (compatibilité)</option>
                    </select>
                  </label>
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                    {['lent', 'normal', 'rapide'].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => setSpeed(spd)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-all ${
                          speed === spd ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Débit {spd}
                      </button>
                    ))}
                  </div>
                </div>

                {activeCloneId ? (
                  <div className="p-3.5 rounded-xl bg-fuchsia-950/30 border border-fuchsia-500/30 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-fuchsia-300">Style actif : profil vocal personnalisé</p>
                      <p className="text-xs text-slate-300 mt-0.5">
                        {clonedVoices.find(c => c.id === activeCloneId)?.stylePrompt}
                      </p>
                    </div>
                    <button
                      onClick={() => setActiveCloneId(null)}
                      className="text-xs text-fuchsia-300 hover:underline shrink-0"
                    >
                      Désactiver le profil
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {STYLE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => setStyleInstruction(preset.instruction)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            styleInstruction === preset.instruction
                              ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">
                        Instruction d'intonation personnalisée (modifiable) :
                      </label>
                      <input
                        type="text"
                        value={styleInstruction}
                        onChange={(e) => setStyleInstruction(e.target.value)}
                        placeholder="Ex: Parle avec un ton enthousiaste et chaleureux..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Script de la Voix Off */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-indigo-400" />
                    3. Texte de la Voix Off
                  </h2>
                  <span className="text-xs text-slate-400">{scriptText.length} caractères</span>
                </div>

                {/* Générateur de script par IA */}
                <div className="flex flex-col sm:flex-row gap-2 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
                  <input
                    type="text"
                    value={scriptTopic}
                    onChange={(e) => setScriptTopic(e.target.value)}
                    placeholder="Besoin d'inspiration ? Ex: Pub pour une application de fitness, intro YouTube tech..."
                    className="flex-1 bg-transparent px-2.5 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none"
                  />
                  <button
                    onClick={handleGenerateScriptWithAI}
                    disabled={isGeneratingScript}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shrink-0"
                  >
                    {isGeneratingScript ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>Rédiger avec Gemini</span>
                  </button>
                </div>

                <textarea
                  rows={5}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder="Saisissez ou collez ici le texte que la voix off doit lire..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-100 text-base leading-relaxed focus:outline-none focus:border-indigo-500 resize-y"
                />

                <button
                  onClick={handleGenerateVoiceover}
                  disabled={isSynthesizing}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white font-semibold text-base shadow-xl shadow-indigo-600/25 flex items-center justify-center gap-3 transition-all disabled:opacity-50"
                >
                  {isSynthesizing ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>Synthèse vocale haute définition en cours...</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-5 h-5" />
                      <span>Générer la Voix Off Maintenant</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {/* === ONGLET 2 : CLONAGE DE VOIX (EMPREINTE VOCALE IA) === */}
          {activeTab === 'clone' && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-fuchsia-400">
                    Analyse de profil vocal par Gemini
                  </span>
                  <h2 className="text-xl font-bold text-white mt-1">
                    Créez un profil de style vocal réutilisable
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Enregistrez 10 à 20 secondes de votre voix ou importez un fichier audio. Gemini analyse les caractéristiques perceptibles de l'échantillon et propose une voix Gemini ainsi qu'une directive de style. Cette fonction ne clone pas réellement l'identité vocale.
                  </p>
                </div>
              </div>

              {/* Étape 1 : Nom du clone */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-200">
                  1. Nommez votre profil vocal
                </label>
                <input
                  type="text"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="Ex: Ma Voix YouTube, Voix Narrateur Studio..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-fuchsia-500"
                />
              </div>

              {/* Étape 2 : Texte de référence suggéré */}
              <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800/80 space-y-1.5">
                <p className="text-xs font-medium text-indigo-400 uppercase tracking-wider">
                  Texte suggéré à lire pendant l'enregistrement :
                </p>
                <p className="text-sm text-slate-200 italic leading-relaxed">
                  "Bonjour ! J'enregistre actuellement ma voix pour permettre à l'intelligence artificielle Gemini d'analyser mon timbre, mon rythme naturel et mon énergie afin de générer mes futures voix off."
                </p>
              </div>

              {/* Étape 3 : Enregistrer au micro ou Importer un fichier */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Carte Microphone */}
                <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center text-center space-y-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                    isRecording ? 'bg-rose-500/20 text-rose-400 animate-pulse ring-4 ring-rose-500/30' : 'bg-indigo-500/10 text-indigo-400'
                  }`}>
                    <Mic className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-white">Enregistrer au Microphone</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {isRecording ? `Enregistrement en cours : ${recordingTime}s` : 'Parlez clairement pendant 10 à 20 secondes'}
                    </p>
                  </div>
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-all"
                    >
                      <Mic className="w-4 h-4" />
                      <span>Démarrer l'enregistrement</span>
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-2 transition-all"
                    >
                      <Square className="w-4 h-4" />
                      <span>Arrêter ({recordingTime}s)</span>
                    </button>
                  )}
                </div>

                {/* Carte Import Fichier */}
                <label className="p-5 rounded-2xl bg-slate-950 border border-dashed border-slate-700 hover:border-indigo-500 cursor-pointer flex flex-col items-center justify-center text-center space-y-4 transition-all">
                  <div className="w-16 h-16 rounded-full bg-fuchsia-500/10 text-fuchsia-400 flex items-center justify-center">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-white">Importer un Fichier Audio</h3>
                    <p className="text-xs text-slate-400 mt-0.5">WAV, MP3, M4A ou WebM (max 5 Mo)</p>
                  </div>
                  <span className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-medium">
                    Choisir un fichier
                  </span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Aperçu de l'échantillon enregistré */}
              {recordedPreviewUrl && (
                <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-300 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Échantillon prêt pour l'analyse
                    </span>
                    <button
                      onClick={() => {
                        setRecordedBlob(null);
                        setRecordedPreviewUrl(null);
                      }}
                      className="text-xs text-rose-400 hover:underline"
                    >
                      Supprimer l'échantillon
                    </button>
                  </div>
                  <audio src={recordedPreviewUrl} controls className="w-full h-10" />
                </div>
              )}

              {/* Bouton Lancer le Clonage IA */}
              <button
                onClick={handleAnalyzeAndCloneVoice}
                disabled={isAnalyzingVoice || !recordedBlob}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white font-semibold text-base shadow-xl shadow-fuchsia-600/20 flex items-center justify-center gap-3 transition-all disabled:opacity-50"
              >
                {isAnalyzingVoice ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Analyse du profil vocal par Gemini...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-5 h-5" />
                    <span>Analyser et créer le profil</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* === ONGLET 3 : DIALOGUE MULTI-VOIX === */}
          {activeTab === 'dialogue' && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-400" />
                  Studio Dialogue & Podcast Multi-Locuteurs
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Faites converser deux voix distinctes dans un seul fichier audio (idéal pour les podcasts, interviews ou publicités à deux voix).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Locuteur 1 */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">Locuteur 1</span>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Prénom dans le script</label>
                    <input
                      type="text"
                      value={speaker1Name}
                      onChange={(e) => setSpeaker1Name(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Voix attribuée</label>
                    <select
                      value={speaker1Voice}
                      onChange={(e) => setSpeaker1Voice(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {GEMINI_VOICES.map(v => (
                        <option key={v.id} value={v.id}>{v.name} ({v.gender} - {v.desc})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Locuteur 2 */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-fuchsia-400">Locuteur 2</span>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Prénom dans le script</label>
                    <input
                      type="text"
                      value={speaker2Name}
                      onChange={(e) => setSpeaker2Name(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Voix attribuée</label>
                    <select
                      value={speaker2Voice}
                      onChange={(e) => setSpeaker2Voice(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {GEMINI_VOICES.map(v => (
                        <option key={v.id} value={v.id}>{v.name} ({v.gender} - {v.desc})</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Assistant IA pour écrire le dialogue */}
              <div className="flex flex-col sm:flex-row gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <input
                  type="text"
                  value={scriptTopic}
                  onChange={(e) => setScriptTopic(e.target.value)}
                  placeholder="Sujet du dialogue (ex: Débat sur l'intelligence artificielle, pub café...)"
                  className="flex-1 bg-transparent px-2.5 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  onClick={handleGenerateScriptWithAI}
                  disabled={isGeneratingScript}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  {isGeneratingScript ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Générer le dialogue</span>
                </button>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-2">
                  Script du dialogue (Format : <code className="text-indigo-300">{speaker1Name}: ...</code> puis <code className="text-fuchsia-300">{speaker2Name}: ...</code>)
                </label>
                <textarea
                  rows={6}
                  value={dialogueScript}
                  onChange={(e) => setDialogueScript(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-100 text-sm font-mono leading-relaxed focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                onClick={handleGenerateVoiceover}
                disabled={isSynthesizing}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white font-semibold text-base shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-3 transition-all disabled:opacity-50"
              >
                {isSynthesizing ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Production du dialogue multi-voix en cours...</span>
                  </>
                ) : (
                  <>
                    <Users className="w-5 h-5" />
                    <span>Générer le Dialogue Audio</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* COLONNE DROITE (4 cols) : LECTEUR PRINCIPAL & HISTORIQUE DES VOIX OFF */}
        <div className="lg:col-span-4 space-y-6">
          {/* Lecteur Audio Actif */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <FileAudio className="w-4 h-4 text-indigo-400" />
              Sortie Master Audio
            </h2>

            {currentAudio ? (
              <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/60 via-slate-950 to-fuchsia-950/40 border border-indigo-500/30 space-y-4">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300 bg-indigo-500/20 px-2.5 py-0.5 rounded-full">
                    {currentAudio.voiceLabel}
                  </span>
                  <h3 className="text-sm font-medium text-white mt-2 line-clamp-2">
                    "{currentAudio.title}"
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1">Généré à {currentAudio.createdAt} • WAV 24kHz</p>
                </div>

                <audio
                  ref={mainAudioPlayerRef}
                  src={currentAudio.url}
                  controls
                  className="w-full h-10"
                />

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-2"><Sliders className="w-3.5 h-3.5" /> Effets & lecture</span>
                    <button onClick={() => { setPlaybackRate(1); setPlaybackVolume(1); setAudioEffect('none'); }} className="text-[11px] text-indigo-300 hover:underline">Réinitialiser</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-[11px] text-slate-400">Vitesse <strong className="text-white">{playbackRate.toFixed(2)}×</strong>
                      <input aria-label="Vitesse de lecture" type="range" min="0.75" max="1.5" step="0.05" value={playbackRate} onChange={e => setPlaybackRate(Number(e.target.value))} className="w-full accent-indigo-500" />
                    </label>
                    <label className="text-[11px] text-slate-400">Volume <strong className="text-white">{Math.round(playbackVolume * 100)}%</strong>
                      <input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={playbackVolume} onChange={e => setPlaybackVolume(Number(e.target.value))} className="w-full accent-indigo-500" />
                    </label>
                  </div>
                  <label className="block text-[11px] text-slate-400">Coloration sonore
                    <select value={audioEffect} onChange={e => { setAudioEffect(e.target.value); enableAudioEffects(); }} className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white">
                      <option value="none">Original</option><option value="bass">Basses renforcées</option><option value="bright">Voix brillante</option><option value="telephone">Effet téléphone / radio</option><option value="deep">Voix plus chaleureuse</option>
                    </select>
                  </label>
                  <p className="text-[10px] text-slate-500">Les effets s'appliquent à l'écoute. Le téléchargement conserve le WAV original.</p>
                </div>

                <a
                  href={currentAudio.url}
                  download={`voix-off-gemini-${currentAudio.id}.wav`}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>Télécharger le fichier WAV</span>
                </a>
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center space-y-2">
                <Volume2 className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">
                  Aucune voix off générée pour le moment. Cliquez sur "Générer la Voix Off" pour écouter et télécharger votre audio.
                </p>
              </div>
            )}
          </div>

          {/* Historique des Générations */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Historique de Session</h2>
              <span className="text-xs text-slate-500">{audioHistory.length} piste(s)</span>
            </div>

            {audioHistory.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">
                Vos pistes audio générées apparaîtront ici.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                {audioHistory.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border transition-all ${
                      currentAudio?.id === item.id
                        ? 'bg-indigo-950/30 border-indigo-500/40'
                        : 'bg-slate-950 border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[11px] font-medium text-indigo-300">{item.voiceLabel}</span>
                      <span className="text-[10px] text-slate-500">{item.createdAt}</span>
                    </div>
                    <p className="text-xs text-slate-300 line-clamp-1 mb-2">"{item.title}"</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentAudio(item)}
                        className="flex-1 py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white font-medium flex items-center justify-center gap-1.5"
                      >
                        <Play className="w-3 h-3" />
                        <span>Écouter</span>
                      </button>
                      <a
                        href={item.url}
                        download={`voix-off-${item.id}.wav`}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                        title="Télécharger WAV"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}