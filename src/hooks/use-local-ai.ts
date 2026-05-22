import { useEffect, useRef, useState } from 'react';

export function useLocalAI(engineType: 'transformers' | 'webllm') {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'generating' | 'error'>('idle');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [cachedModels, setCachedModels] = useState<Record<string, boolean>>({});
  // Tracks whether we auto-booted in the background (so UI can show a subtle indicator
  // rather than the full loading screen that the explicit "Load" button shows).
  const [isAutoBooting, setIsAutoBooting] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const initWorker = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setStatus('idle');
    setOutput('');
    setError(null);
    setProgressMessage('');
    setIsAutoBooting(false);

    if (engineType === 'webllm') {
      workerRef.current = new Worker(new URL('../workers/webllm.worker.ts', import.meta.url), {
        type: 'module',
      });
    } else {
      workerRef.current = new Worker(new URL('../workers/transformers.worker.ts', import.meta.url), {
        type: 'module',
      });
    }

    workerRef.current.onmessage = (event) => {
      const { status: workerStatus, output: workerOutput, error: workerError, message: workerMessage } = event.data;

      if (workerStatus === 'loading') setStatus('loading');
      if (workerStatus === 'progress') setProgressMessage(workerMessage || '');
      if (workerStatus === 'ready') {
        setStatus('ready');
        setIsAutoBooting(false);
      }
      if (workerStatus === 'error') {
        setStatus('error');
        setIsAutoBooting(false);
        setError(workerError);
      }
      if (workerStatus === 'update') {
        setOutput(workerOutput);
      }
      if (workerStatus === 'cache_status') {
        setCachedModels(event.data.data);
      }
      if (workerStatus === 'complete') {
        setStatus('ready');
      }
      if (workerStatus === 'conversation_reset') {
        setOutput('');
      }
    };
  };

  useEffect(() => {
    initWorker();
    return () => {
      workerRef.current?.terminate();
    };
  }, [engineType]);

  const loadModel = (modelId: string) => {
    setStatus('loading');
    setIsAutoBooting(false);
    workerRef.current?.postMessage({ type: 'load', data: { modelId } });
  };

  // Auto-boot: silently starts loading the model in the background if it's already cached.
  // Sets isAutoBooting so the UI can show a quiet indicator instead of the full load screen.
  const autoLoad = (modelId: string) => {
    setIsAutoBooting(true);
    setStatus('loading');
    workerRef.current?.postMessage({ type: 'load', data: { modelId } });
  };

  const generate = (prompt: string) => {
    if (status !== 'ready') return;
    setStatus('generating');
    setOutput('');
    workerRef.current?.postMessage({ type: 'generate', data: { prompt } });
  };

  // Clears the conversation inside the worker WITHOUT reloading the model.
  // The KV cache system prompt stays alive; just the chat history is wiped.
  const resetConversation = () => {
    setOutput('');
    workerRef.current?.postMessage({ type: 'reset_conversation' });
  };

  const checkCache = (models: string[]) => {
    workerRef.current?.postMessage({ type: 'check_cache', data: { models } });
  };

  const reset = () => {
    initWorker();
  };

  return {
    status,
    output,
    error,
    progressMessage,
    cachedModels,
    isAutoBooting,
    loadModel,
    autoLoad,
    generate,
    checkCache,
    resetConversation,
    reset,
  };
}
