import { CreateMLCEngine, hasModelInCache } from '@mlc-ai/web-llm';

let engine: any = null;

self.addEventListener('message', async (event: MessageEvent) => {
  const { type, data } = event.data;

  if (type === 'check_cache') {
    try {
      const statuses: Record<string, boolean> = {};
      for (const modelId of data.models) {
        statuses[modelId] = await hasModelInCache(modelId);
      }
      self.postMessage({ status: 'cache_status', data: statuses });
    } catch (e) {
      console.error('Cache check failed:', e);
    }
  }

  if (type === 'load') {
    try {
      self.postMessage({ status: 'loading', message: 'Initializing model...' });
      
      engine = await CreateMLCEngine(data.modelId, {
        initProgressCallback: (progress) => {
           self.postMessage({ status: 'progress', message: progress.text });
        }
      });

      self.postMessage({ status: 'ready' });
    } catch (error: any) {
      self.postMessage({ status: 'error', error: error.message });
    }
  }

  if (type === 'generate') {
    if (!engine) {
      self.postMessage({ status: 'error', error: 'Model not loaded' });
      return;
    }

    try {
      const messages = [
        { role: 'system', content: 'You are a helpful and concise AI assistant.' },
        { role: 'user', content: data.prompt }
      ];

      const reply = await engine.chat.completions.create({
        messages,
        temperature: 0.7,
        max_tokens: 8192,
      });

      self.postMessage({ status: 'update', output: reply.choices[0].message.content });
      self.postMessage({ status: 'complete' });
    } catch (e: any) {
      self.postMessage({ status: 'error', error: e.message });
    }
  }
});
