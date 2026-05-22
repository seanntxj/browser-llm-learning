# In-Browser LLM Architecture & Implementation Guide: Deep Dive

Welcome! Since you already have experience running local LLMs via Ollama, you understand the fundamentals of inference, tokenization, and quantization. However, running LLMs **natively inside a web browser** requires a complete paradigm shift. 

With Ollama, you operate a Client-Server architecture (your app talks to a local API running on your CPU/GPU). In this project, **the browser is both the client and the server**. There is no backend. The browser downloads the model weights, compiles the GPU shaders, and executes the matrix multiplications entirely within the V8 JavaScript engine.

This document serves as your deep-dive guide to the exact code that makes this possible.

---

## 1. The Core Architecture: The Web Worker Pattern

In JavaScript, the main thread handles the UI (DOM updates, React renders, CSS animations). LLM inference is extremely computationally heavy. If we ran inference on the main thread, the entire browser tab would freeze until the model finished generating text.

To solve this, we use **Web Workers**. Web Workers are background threads that run JavaScript independently of the main UI thread.

### The Bridge: `useLocalAI.ts`
The hook `useLocalAI` acts as the traffic controller. It is responsible for spawning, communicating with, and killing the background worker. 

Here is the critical worker lifecycle code:
```typescript
const initWorker = () => {
  // 1. Memory Leak Prevention
  // If a worker already exists (e.g., user clicked "Change Model"), we MUST terminate it.
  // This immediately stops GPU computations and frees up VRAM/RAM for the new model.
  if (workerRef.current) {
    workerRef.current.terminate();
  }
  
  // 2. Dynamic Engine Selection
  // We use standard ES module imports to load the correct worker file.
  if (engineType === 'webllm') {
    workerRef.current = new Worker(new URL('../workers/webllm.worker.ts', import.meta.url), {
      type: 'module',
    });
  } else {
    // ... load transformers.worker.ts
  }

  // 3. The IPC (Inter-Process Communication) Listener
  // The worker sends messages back via `postMessage()`. We catch them here.
  workerRef.current.onmessage = (event) => {
    const { status: workerStatus, output, error, message } = event.data;
    
    // We map the worker's internal state to React states, triggering UI re-renders.
    if (workerStatus === 'progress') setProgressMessage(message || '');
    if (workerStatus === 'update') setOutput(output);
    // ...
  };
};
```

---

## 2. Engine Deep Dive: Transformers.js

`src/workers/transformers.worker.ts` handles the ONNX format. It is a port of the Python `transformers` library, utilizing the ONNX Runtime Web.

### Environment & Configuration
Before we can load a model, we have to patch some default behaviors in the engine.
```typescript
import { pipeline, env } from '@huggingface/transformers';

// SECURITY & FETCH FIX:
// By default, Transformers.js tries to fetch from local relative paths first.
// In a Vite React app, this causes 404s and false "Unauthorized" 401 errors.
env.allowLocalModels = false;

// WASM OPTIMIZATION:
// If the browser (or hardware) doesn't support WebGPU, it falls back to WebAssembly (CPU).
// By default, WASM runs on 1 thread, which is agonizingly slow. We bump it to 4.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 4;
}
```

### Loading the Model
The `pipeline` function handles downloading the weights, parsing `config.json`, and setting up the tokenizer.
```typescript
generator = await pipeline('text-generation', data.modelId, {
  device: 'webgpu', // Explicitly request GPU acceleration
  dtype: 'q4',      // 4-bit quantization (reduces VRAM usage from ~16GB to ~1-3GB)
  progress_callback: (data) => {
    // This callback gives us real-time download percentages for each model shard.
    // We format it and send it back to the React thread.
  }
});
```

---

## 3. Engine Deep Dive: WebLLM

`src/workers/webllm.worker.ts` handles the highly optimized MLC engine. It doesn't use ONNX; it uses TVM (Tensor Virtual Machine) to compile models into raw WebGPU shaders.

### Initialization
WebLLM is laser-focused on chat completions, so its API mirrors OpenAI's structure.
```typescript
import { CreateMLCEngine } from '@mlc-ai/web-llm';

// CreateMLCEngine handles the download and the shader compilation automatically.
engine = await CreateMLCEngine(data.modelId, {
  initProgressCallback: (progress) => {
    // Unlike Transformers.js which gives raw bytes, WebLLM gives us rich text:
    // e.g., "Loading model from cache...", "Compiling shader..."
    self.postMessage({ status: 'progress', message: progress.text });
  }
});
```

---

## 4. Prompt Engineering & Execution

When you type a message and hit "Send", the string goes to the active worker. However, modern models (like Qwen and SmolLM) are **Instruct Models**. They will hallucinate if you just send raw text. They expect a specific conversational structure.

Here is how we execute the inference in both workers:
```typescript
// 1. The Chat Template
// We format the raw prompt into an array of message objects.
// The engine's Tokenizer will automatically convert this into the correct format
// (e.g., `<|im_start|>user\nHello<|im_end|>`) based on the model's chat_template.
const messages = [
  { role: 'system', content: 'You are a helpful and concise AI assistant.' },
  { role: 'user', content: data.prompt }
];

// 2. Inference (WebLLM example)
const reply = await engine.chat.completions.create({
  messages,
  temperature: 0.7,
  
  // CRITICAL: Max Tokens
  // Reasoning models output <think> blocks before their actual answer.
  // The default is usually 256 tokens. If left at 256, the generation will stop
  // mid-thought and the user will see a cut-off message. We bump this to 4096.
  max_tokens: 4096, 
});

// 3. IPC Response
self.postMessage({ status: 'update', output: reply.choices[0].message.content });
```

---

## 5. The Browser Cache System

When you refresh the page and click "Load", it doesn't download gigabytes of data again. Both libraries use the browser's **Cache API / IndexedDB** to store model chunks persistently. 

However, we want to visually show the user which models are cached *before* they click load (the `💾` icon). Since React has no access to this cache directly, we query the workers.

### Transformers.js Cache Sniffing
Transformers.js doesn't have a helper function for this, but we know it uses the standard Cache API under a specific bucket name:
```typescript
// Open the hidden browser cache bucket used by Transformers.js
const cache = await caches.open('transformers-cache');
const keys = await cache.keys();
const cachedUrls = keys.map((req: any) => req.url);

for (const modelId of data.models) {
  // If any URL in the cache contains the model's HuggingFace ID, it's stored locally!
  statuses[modelId] = cachedUrls.some((url: string) => url.includes(modelId));
}
```

### WebLLM Cache Sniffing
WebLLM abstracts this away into a nice helper:
```typescript
import { hasModelInCache } from '@mlc-ai/web-llm';

for (const modelId of data.models) {
  // Checks IndexedDB/Cache for the compiled MLC weights
  statuses[modelId] = await hasModelInCache(modelId);
}
```

---

## 6. Vite Bundling Quirks

To make all of this work, `vite.config.ts` requires some surgical adjustments.

```typescript
export default defineConfig({
  // ...
  worker: {
    // Web workers traditionally used classic scripts. 
    // We enforce 'es' so we can use modern `import` statements inside our worker files.
    format: 'es', 
  },
  optimizeDeps: {
    // Transformers.js bundles massive .wasm files for the ONNX runtime.
    // If Vite tries to pre-bundle this library (which it does by default), 
    // it will strip/mangle the file paths, causing WebAssembly initialization to fail.
    // Excluding it forces Vite to serve it exactly as it exists in node_modules.
    exclude: ['@huggingface/transformers'],
  },
})
```

## Summary
You have built a local-first AI app that dynamically juggles two bleeding-edge web AI engines. It isolates massive GPU workloads into background threads, manages browser cache APIs directly, and gracefully prevents memory leaks by terminating workers when users pivot models.