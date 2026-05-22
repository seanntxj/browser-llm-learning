# TTFT Optimization Deep Dive

## What is TTFT?

**Time To First Token (TTFT)** is the delay between a user submitting a prompt and the model outputting its very first word. It is the single most important latency metric for perceived AI responsiveness. A model that generates 100 tokens/second but takes 8 seconds to start feels far slower than a model that generates 50 tokens/second but starts in 1 second.

In a browser-based LLM, TTFT has two completely separate bottlenecks with completely different solutions:

| Phase | When it occurs | Root cause |
|---|---|---|
| **Cold Start TTFT** | First use after page load | Disk I/O + VRAM transfer + shader compilation |
| **Hot TTFT** | Every subsequent prompt | KV Cache re-prefill of the full context window |

We attacked both.

---

## Cold Start TTFT: The Shader Warmup

### What was happening before

WebGPU does not ship pre-compiled GPU programs. Every time a mathematical operation (matrix multiply, attention, softmax, etc.) runs for the very first time in a given browser session, the browser must **Just-In-Time compile** the WebGPU shader for that operation from WGSL source code into native GPU machine code.

For a transformer model, this means hundreds of unique shader compilations. The browser does them lazily — the first time each one is needed. This is why your **very first prompt after loading** felt absurdly slow even though the model was sitting in VRAM ready to go. The GPU was not actually processing your text; it was spending 10-20 seconds compiling programs before it could even start.

### The Fix: Hidden Dummy Generation

Immediately after `CreateMLCEngine()` resolves (model is in VRAM), we fire a single hidden inference call before emitting `ready` to the React UI:

```typescript
// webllm.worker.ts

self.postMessage({ status: 'progress', message: 'Warming up GPU shaders...' });

await engine.chat.completions.create({
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: '.' }       // Minimal single-token input
  ],
  max_tokens: 1,      // We only need ONE token to force ALL shaders to compile
  temperature: 0.0,   // Deterministic — no randomness needed for warmup
});

// After this returns, every shader in the model is compiled and cached in the GPU driver.
// We reset conversation history so the dummy prompt doesn't leak into the user's chat.
conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }];

self.postMessage({ status: 'ready' }); // NOW the UI is told it's ready
```

### Why `max_tokens: 1` is enough

A transformer model's forward pass processes the entire architecture in one shot per token. Generating exactly 1 token is sufficient to force the GPU driver to compile every single shader in the model's computational graph — attention, feed-forward layers, layer normalization, the works. We don't need to generate a real response; we just need the GPU to execute the pipeline once.

### The cost vs gain

- **Cost:** The very first load (or first load after clearing GPU shader cache) takes an extra 5-20 seconds. This time is paid during the `progress` phase, not after `ready`.
- **Gain:** Every subsequent prompt in the session gets its first token in under 1-2 seconds instead of 10-20 seconds.

---

## Hot TTFT: Stateful KV Caching

### What was happening before

Every time the user submitted a message, our worker constructed a fresh array and passed it to the engine:

```typescript
// The OLD stateless approach
const messages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: data.prompt }
];
await engine.chat.completions.create({ messages });
```

Even though the system prompt never changes, the engine was forced to **tokenize and prefill it into the KV Cache from scratch on every single call**. The KV (Key-Value) Cache is a fundamental data structure in transformer inference — it stores the intermediate attention computations for every token the model has seen so far. Re-building it from zero on every message is pure wasted work.

### What is the KV Cache?

In a transformer's attention mechanism, for every token in the input, the model computes a **Key** vector and a **Value** vector. These are expensive matrix multiplications. During inference, once computed for a given token, these K/V pairs never change — they only need to be computed once.

The KV Cache stores these pairs in VRAM so that on the next forward pass, the model can skip recomputing them for tokens it has already processed. It only needs to compute K/V pairs for the **new** tokens being added.

Without stateful history, the KV Cache is thrown away between calls, forcing a full prefill every time. With stateful history, it only grows incrementally.

### The Fix: Persistent Conversation History

We lifted the `conversationHistory` array out of the event handler and into the **module scope** of the worker. This means it persists across every message exchange for the lifetime of the worker thread:

```typescript
// webllm.worker.ts — module scope, lives for the entire worker lifetime

const SYSTEM_PROMPT = 'You are a helpful and concise AI assistant.';

// This array is initialized once. It never gets garbage collected between messages.
let conversationHistory: { role: string; content: string }[] = [
  { role: 'system', content: SYSTEM_PROMPT }
];
```

On each `generate` call, we **append** the new user message and the assistant's response:

```typescript
if (type === 'generate') {
  // Append new user turn — engine only prefills THIS new message
  conversationHistory.push({ role: 'user', content: data.prompt });

  const reply = await engine.chat.completions.create({
    messages: conversationHistory, // Full history passed, but KV cache covers the old parts
    temperature: 0.7,
    max_tokens: 4096,
  });

  const assistantContent = reply.choices[0].message.content;

  // Append assistant turn for context on the next message
  conversationHistory.push({ role: 'assistant', content: assistantContent });
}
```

WebLLM's internal engine detects that the prefix of the conversation matches what is already in VRAM and only runs the attention prefill for the new tokens. This cuts Hot TTFT dramatically, especially on the second and third messages of a conversation.

### Conversation Reset Without Model Reload

A natural consequence of stateful history is that you need a way to clear it. We added a `reset_conversation` IPC message that wipes the history back to just the system prompt — without touching the engine, without evicting VRAM, and without recompiling any shaders:

```typescript
if (type === 'reset_conversation') {
  // History wiped. Model stays fully loaded and warm in VRAM.
  conversationHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
  self.postMessage({ status: 'conversation_reset' });
}
```

This is what powers the **"New Chat"** button in the UI. It gives you a fresh conversation in milliseconds.

---

## Auto-Boot: Eliminating the Click Entirely

Even with shaders warmed up, requiring the user to manually click "Load Model" on every page refresh adds unnecessary friction. If the model is already cached, the only reason to show a button is convention — not necessity.

### The Detection

After the worker spins up, we perform a cache check. For WebLLM, this uses the native `hasModelInCache()` API which probes IndexedDB for the compiled MLC weight shards:

```typescript
// webllm.worker.ts
if (type === 'check_cache') {
  const statuses: Record<string, boolean> = {};
  for (const modelId of data.models) {
    statuses[modelId] = await hasModelInCache(modelId);
  }
  self.postMessage({ status: 'cache_status', data: statuses });
}
```

### The Trigger

In `chat-interface.tsx`, a `useEffect` watches for the cache check result. If the currently selected WebLLM model is confirmed as cached, it silently triggers `autoLoad()`:

```typescript
useEffect(() => {
  if (!hasAttemptedAutoBoot.current && engine === 'webllm' && status === 'idle' && cachedModels[currentEngineModelId]) {
    hasAttemptedAutoBoot.current = true; // Lock — only fires once per page load
    autoLoad(currentEngineModelId);
  }
}, [cachedModels, currentEngineModelId, engine, status]);
```

### The One-Shot Lock

The `useRef` flag `hasAttemptedAutoBoot` is the critical guard here. A `useRef` persists its value across re-renders but does NOT trigger re-renders when mutated. This makes it perfect as a session-scoped "have I already done this?" flag.

Without this lock, clicking "Change Model" (which resets `status` back to `'idle'`) would re-trigger the auto-boot `useEffect` and yank the UI away from the selection screen. With the lock set to `true` after the first auto-boot, subsequent returns to `'idle'` are ignored by the effect.

---

## End-to-End TTFT Timeline (After Optimization)

### First Ever Load (model not in cache)
1. User clicks "Download & Load Model"
2. Model weights download from HuggingFace (~30s-5min depending on connection)
3. Engine compiles WebGPU shaders via dummy warmup (~5-15s, shown as "Warming up GPU shaders...")
4. UI transitions to `ready`
5. User's first prompt: **~1-2 seconds TTFT**

### Subsequent Page Loads (model cached)
1. Page loads, worker spins up, cache check fires automatically
2. Auto-boot triggers silently, progress bar shows in header
3. Model loads from SSD into VRAM (~5-15s depending on model size and SSD speed)
4. Dummy warmup fires again (~2-5s, shaders may still need recompilation per browser session)
5. UI transitions to `ready`
6. User's first prompt: **~1-2 seconds TTFT**

### Second and Third Messages (same session, stateful KV cache)
- No shader compilation needed — already done
- KV cache already contains system prompt and prior conversation
- Only new tokens are prefilled
- **TTFT: ~200-500ms** depending on prompt length
