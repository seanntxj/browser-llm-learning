import { useEffect, useRef, useState } from 'react';

export function useLocalAI(engineType: 'transformers' | 'webllm') {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'generating' | 'error'>('idle');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Terminate existing worker if switching engines
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    
    setStatus('idle');
    setOutput('');
    setError(null);
    setProgressMessage('');

    // Create the worker based on engine selection
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
  }, [engineType]);

  const loadModel = (modelId: string) => {
    setStatus('loading');
    workerRef.current?.postMessage({ type: 'load', data: { modelId } });
  };

  const generate = (prompt: string) => {
    if (status !== 'ready') return;
    setStatus('generating');
    setOutput('');
    workerRef.current?.postMessage({ type: 'generate', data: { prompt } });
  };

  return { status, output, error, progressMessage, loadModel, generate };
}