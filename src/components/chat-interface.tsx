import { useState, useEffect, useRef } from 'react';
import { useLocalAI } from '@/hooks/use-local-ai';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const MODELS = [
  {
    name: 'Qwen 3.5 (0.8B)',
    transformersId: 'onnx-community/Qwen3.5-0.8B-ONNX',
    webllmId: 'Qwen3.5-0.8B-q4f16_1-MLC'
  },
  {
    name: 'Qwen 3.5 (1.7B)',
    transformersId: 'onnx-community/Qwen3-1.7B-ONNX',
    webllmId: 'Qwen3-1.7B-q4f16_1-MLC'
  },
  {
    name: 'SmolLM2 (1.7B)',
    transformersId: 'onnx-community/SmolLM2-360M-Instruct-ONNX',
    webllmId: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC'
  },
];

export function ChatInterface() {
  const hasWebGPU = 'gpu' in navigator;
  const [engine, setEngine] = useState<'transformers' | 'webllm'>(hasWebGPU ? 'webllm' : 'transformers');
  const {
    status,
    output,
    loadModel,
    autoLoad,
    generate,
    progressMessage,
    cachedModels,
    isAutoBooting,
    checkCache,
    resetConversation,
    reset,
  } = useLocalAI(engine);
  const [input, setInput] = useState('');
  const [selectedModelIndex, setSelectedModelIndex] = useState("0");
  const hasAttemptedAutoBoot = useRef(false);

  const selectedModelInfo = MODELS[parseInt(selectedModelIndex)];
  const currentEngineModelId = engine === 'webllm' ? selectedModelInfo.webllmId : selectedModelInfo.transformersId;

  // Check which models are cached whenever the engine or idle status changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      const modelsToCheck = MODELS.map(m => engine === 'webllm' ? m.webllmId : m.transformersId);
      checkCache(modelsToCheck);
    }, 100);
    return () => clearTimeout(timer);
  }, [engine, status]);

  // AUTO-BOOT: Only fires once per page load. The ref lock prevents it from
  // re-triggering when the user manually clicks "Change Model" and returns to idle.
  useEffect(() => {
    if (!hasAttemptedAutoBoot.current && engine === 'webllm' && status === 'idle' && cachedModels[currentEngineModelId]) {
      hasAttemptedAutoBoot.current = true;
      autoLoad(currentEngineModelId);
    }
  }, [cachedModels, currentEngineModelId, engine, status]);

  // Key Enter to send
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (status === 'ready' && input.trim()) generate(input);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto mt-10">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Local Browser LLM</CardTitle>
        <div className="flex items-center space-x-2">
          {/* Auto-boot spinner: subtle pill shown while background boot is in progress */}
          {isAutoBooting && status === 'loading' && (
            <div className="flex items-center space-x-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Auto-loading...</span>
            </div>
          )}
          {status === 'ready' && (
            <Button variant="ghost" size="sm" onClick={resetConversation}>
              New Chat
            </Button>
          )}
          {(status === 'ready' || status === 'generating' || status === 'error') && (
            <Button variant="outline" size="sm" onClick={reset} disabled={status === 'generating'}>
              Change Model
            </Button>
          )}
          <Badge variant={status === 'ready' ? 'default' : 'secondary'}>
            {status.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Show selection screen only when idle AND not auto-booting */}
        {status === 'idle' && !isAutoBooting && (
          <div className="space-y-4">
            <Tabs value={engine} onValueChange={(v) => setEngine(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="webllm" disabled={!hasWebGPU}>WebLLM {hasWebGPU ? '(Fast)' : '(No WebGPU)'}</TabsTrigger>
                <TabsTrigger value="transformers">Transformers.js</TabsTrigger>
              </TabsList>
            </Tabs>

            <Select value={selectedModelIndex} onValueChange={setSelectedModelIndex}>
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((model, idx) => {
                  const mId = engine === 'webllm' ? model.webllmId : model.transformersId;
                  const isCached = cachedModels[mId];
                  return (
                    <SelectItem key={idx} value={idx.toString()}>
                      {model.name} {isCached ? '💾' : ''}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button onClick={() => { hasAttemptedAutoBoot.current = true; loadModel(currentEngineModelId); }} className="w-full">
              Download & Load Model
            </Button>
          </div>
        )}

        {/* Loading screen - shown for both manual loads and auto-boot */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center p-8 space-y-4">
            <div className="flex items-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                {isAutoBooting ? 'Auto-loading cached model...' : 'Loading Engine...'}
              </span>
            </div>
            {progressMessage && (
              <span className="text-xs text-muted-foreground text-center max-w-md break-words">
                {progressMessage}
              </span>
            )}
          </div>
        )}

        {(status === 'ready' || status === 'generating') && (
          <>
            <div className="p-4 min-h-[150px] rounded-md border bg-muted/40 whitespace-pre-wrap text-sm">
              {status === 'generating' ? (
                <div className="flex items-center text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Thinking...
                </div>
              ) : (
                output || <span className="text-muted-foreground">AI response will appear here...</span>
              )}
            </div>
            <Textarea
              placeholder="Ask something... (Enter to send, Shift+Enter for new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={status === 'generating'}
            />
          </>
        )}
      </CardContent>

      <CardFooter>
        {(status === 'ready' || status === 'generating') && (
          <Button
            onClick={() => generate(input)}
            disabled={status === 'generating' || !input.trim()}
            className="ml-auto"
          >
            {status === 'generating' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
