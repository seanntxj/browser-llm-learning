import { pipeline, env } from '@huggingface/transformers';

// 1. Force the engine to use pure CDN fetches instead of trying local variations
env.allowLocalModels = false;

// 2. THE FIX: Configure remote fetch parameters
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 4; // Optimizes WASM for your Lenovo/Mobile devices
}
env.remoteHost = 'https://huggingface.co';
env.remotePathTemplate = '{model}/resolve/{revision}/';

let generator: any = null;

// Listen for messages from the main React/shadcn thread
self.addEventListener('message', async (event: MessageEvent) => {
  const { type, data } = event.data;

  if (type === 'load') {
    try {
      self.postMessage({ status: 'loading', message: 'Initializing model...' });
      
      const progress_callback = (data: any) => {
        let msg = data.status === 'progress' ? 'Downloading' : data.status;
        if (data.file) msg += ` ${data.file}`;
        if (data.progress) msg += ` (${Math.round(data.progress)}%)`;
        self.postMessage({ status: 'progress', message: msg });
      };

      // Auto-detects WebGPU, falls back to WASM if unavailable
      generator = await pipeline('text-generation', data.modelId, {
        device: 'webgpu', 
        dtype: 'q4', // 4-bit quantization for mobile/laptop safety
        progress_callback,
      });

      self.postMessage({ status: 'ready' });
    } catch (error: any) {
      // If WebGPU failed during initialization, force WASM fallback
      try {
        const progress_callback = (data: any) => {
          let msg = data.status === 'progress' ? 'Downloading' : data.status;
          if (data.file) msg += ` ${data.file}`;
          if (data.progress) msg += ` (${Math.round(data.progress)}%)`;
          self.postMessage({ status: 'progress', message: msg });
        };
        
        generator = await pipeline('text-generation', data.modelId, {
          device: 'wasm',
          dtype: 'q8',
          progress_callback,
        });
        self.postMessage({ status: 'ready', message: 'Running on CPU fallback' });
      } catch (wasmError: any) {
        self.postMessage({ status: 'error', error: wasmError.message });
      }
    }
  }

  if (type === 'generate') {
    if (!generator) {
      self.postMessage({ status: 'error', error: 'Model not loaded' });
      return;
    }

    // Format for instruct models (stateless, no memory)
    const messages = [
      { role: 'system', content: 'You are a helpful and concise AI assistant.' },
      { role: 'user', content: data.prompt }
    ];

    try {
      // Wait for the full generation to complete
      const result = await generator(messages, {
        max_new_tokens: 8192, 
        temperature: 0.7,
      });

      // Extract the assistant's reply from the output array
      const assistantMessage = result[0].generated_text.at(-1).content;
      
      // Send the final output all at once
      self.postMessage({ status: 'update', output: assistantMessage });
      self.postMessage({ status: 'complete' });
    } catch (e: any) {
      self.postMessage({ status: 'error', error: e.message });
    }
  }
});