import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Icon } from './Icon.jsx';
const NativeVoice = registerPlugin('VoiceSearch');
export function VoiceButton({ label, onText, onMessage }) {
  const [listening, setListening] = useState(false);
  const recognition = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const instance = recognition.current;
      if (instance) {
        instance.onresult = null;
        instance.onerror = null;
        instance.onend = null;
        instance.abort();
      }
    };
  }, []);
  async function start() {
    if (listening) {
      recognition.current?.abort();
      setListening(false);
      return;
    }
    if (Capacitor.isNativePlatform()) {
      setListening(true);
      try {
        const result = await NativeVoice.start();
        if (mounted.current && result.text.trim()) onText(result.text.trim());
      } catch (error) {
        if (mounted.current)
          onMessage(
            error instanceof Error
              ? error.message
              : 'No pudimos escuchar. Puedes escribir tu destino.'
          );
      } finally {
        if (mounted.current) setListening(false);
      }
      return;
    }
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      onMessage(
        'Este navegador no permite búsqueda por voz. Puedes escribir o usar la app Android.'
      );
      return;
    }
    const instance = new Constructor();
    recognition.current = instance;
    instance.lang = 'es-MX';
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      if (mounted.current) onText(event.results[0][0].transcript.trim());
    };
    instance.onerror = (event) => {
      if (mounted.current)
        onMessage(
          event.error === 'not-allowed'
            ? 'Permite el micrófono para buscar por voz.'
            : event.error === 'no-speech'
              ? 'No escuchamos un lugar. Inténtalo otra vez.'
              : 'La búsqueda por voz no está disponible. Puedes escribir.'
        );
    };
    instance.onend = () => {
      if (mounted.current) setListening(false);
    };
    try {
      setListening(true);
      instance.start();
    } catch {
      setListening(false);
      onMessage('No pudimos iniciar el micrófono.');
    }
  }
  return (
    <button
      type="button"
      className={`voice-button ${listening ? 'listening' : ''}`}
      aria-label={listening ? 'Detener micrófono' : `Dictar ${label}`}
      aria-pressed={listening}
      onClick={() => {
        void start();
      }}
    >
      <Icon name={listening ? 'square' : 'mic'} />
      {listening ? 'Detener' : 'Hablar'}
    </button>
  );
}
