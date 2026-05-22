import { useState, useEffect } from 'react';
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
    transformersId: 'onnx-community/SmolLM2-360M-Instruct-ONNX', // Fallback to 360M for ONNX as 1.7B isn't compiled
    webllmId: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC'
  },
];

export function ChatInterface() {
  const hasWebGPU = 'gpu' in navigator;
  const [engine, setEngine] = useState<'transformers' | 'webllm'>(hasWebGPU ? 'webllm' : 'transformers');
  const { status, output, loadModel, generate, progressMessage, cachedModels, checkCache, reset } = useLocalAI(engine);
  const [input, setInput] = useState('');
  
  const [selectedModelIndex, setSelectedModelIndex] = useState("0");
  
  const selectedModelInfo = MODELS[parseInt(selectedModelIndex)];
  const currentEngineModelId = engine === 'webllm' ? selectedModelInfo.webllmId : selectedModelInfo.transformersId;

  useEffect(() => {
    // Slight delay to ensure worker is ready to receive messages
    const timer = setTimeout(() => {
      const modelsToCheck = MODELS.map(m => engine === 'webllm' ? m.webllmId : m.transformersId);
      checkCache(modelsToCheck);
    }, 100);
    return () => clearTimeout(timer);
  }, [engine, status]); // Check when engine changes or when going back to idle status

  return (
    <Card className="w-full max-w-2xl mx-auto mt-10">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Local Browser LLM</CardTitle>
        <div className="flex items-center space-x-2">
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
        {status === 'idle' && (
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
            <Button onClick={() => loadModel(currentEngineModelId)} className="w-full">
              Download & Load Model
            </Button>
          </div>
        )}
        
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center p-8 space-y-4">
            <div className="flex items-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading Engine...</span>
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
                  Thinking... (First prompt takes longer to compile shaders)
                </div>
              ) : (
                output || <span className="text-muted-foreground">AI response will appear here...</span>
              )}
            </div>
            <Textarea 
              placeholder="Ask something..." 
              value={input} 
              onChange={(e) => setInput(e.target.value)}
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