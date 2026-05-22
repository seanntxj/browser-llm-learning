import { CreateMLCEngine, hasModelInCache } from '@mlc-ai/web-llm';

const SYSTEM_PROMPT = 'You are a helpful and concise AI assistant.';

let engine: any = null;

// Stateful conversation history. We keep this alive in the worker so the engine
// does NOT need to re-prefill the system prompt on every single message.
// This is the key to dramatically reducing Hot TTFT.
let conversationHistory: { role: string; content: string }[] = [
  { role: 'system', content: SYSTEM_PROMPT }
];

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

      // SHADER WARMUP:
      // We immediately send a single hidden dummy token through the entire GPU pipeline.
      // This forces WebGPU to compile ALL shaders for this model architecture right now,
      // during the "loading" phase, rather than on the user's very first message.
      // The cost: ~5-15 seconds on first ever load, paid once per session.
      // The gain: the user's first real prompt returns its first token almost instantly.
      self.postMessage({ status: 'progress', message: 'Warming up GPU shaders...' });
      await engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '.' }
        ],
        max_tokens: 1,
        temperature: 0.0,
      });

      // Reset history after warmup so the dummy prompt doesn't contaminate user's chat.
      conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }];

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
      // Append the new user message to the STATEFUL history.
      // On the first real message: history = [system, user]
      // On the second message:     history = [system, user, assistant, user]
      // The engine's KV cache means it only needs to process the *new* tokens each time.
      conversationHistory.push({ role: 'user', content: data.prompt });

      const reply = await engine.chat.completions.create({
        messages: conversationHistory,
        temperature: 0.7,
        max_tokens: 4096,
      });

      const assistantContent = reply.choices[0].message.content;

      // Append the assistant's response to history to preserve context for next turn.
      conversationHistory.push({ role: 'assistant', content: assistantContent });

      self.postMessage({ status: 'update', output: assistantContent });
      self.postMessage({ status: 'complete' });
    } catch (e: any) {
      // If generation fails, remove the last user message to avoid corrupting history.
      conversationHistory.pop();
      self.postMessage({ status: 'error', error: e.message });
    }
  }

  if (type === 'reset_conversation') {
    // Wipe history but keep the system prompt alive, no model reload needed.
    conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
    self.postMessage({ status: 'conversation_reset' });
  }
});
