import { useEffect, useRef, useState } from 'react';

export function useLocalAI(modelId: string) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'generating' | 'error'>('idle');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Create the worker
    workerRef.current = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), {
      type: 'module',
    });

    workerRef.current.onmessage = (event) => {
      const { status: workerStatus, output: workerOutput, error: workerError } = event.data;
      
      if (workerStatus === 'loading') setStatus('loading');
      if (workerStatus === 'ready') setStatus('ready');
      if (workerStatus === 'error') {
        setStatus('error');
        setError(workerError);
      }
      if (workerStatus === 'update') {
        setOutput(workerOutput);
      }
      if (workerStatus === 'complete') {
        setStatus('ready');
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const loadModel = () => {
    setStatus('loading');
    workerRef.current?.postMessage({ type: 'load', data: { modelId } });
  };

  const generate = (prompt: string) => {
    if (status !== 'ready') return;
    setStatus('generating');
    setOutput('');
    workerRef.current?.postMessage({ type: 'generate', data: { prompt } });
  };

  return { status, output, error, loadModel, generate };
}