import { useState } from 'react';
import { useLocalAI } from '@/hooks/use-local-ai';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

export function ChatInterface() {
  // We use Qwen-2-0.5B because it's tiny (~350MB) and highly capable for its size.
  // Perfect for mobile phones and standard business laptops.
  const { status, output, loadModel, generate } = useLocalAI('onnx-community/Qwen2.5-0.5B-Instruct');
  const [input, setInput] = useState('');

  return (
    <Card className="w-full max-w-2xl mx-auto mt-10">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Local Browser LLM</CardTitle>
        <Badge variant={status === 'ready' ? 'default' : 'secondary'}>
          {status.toUpperCase()}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'idle' && (
          <Button onClick={loadModel} className="w-full">
            Download & Load Model (~350MB)
          </Button>
        )}
        
        {status === 'loading' && (
          <div className="flex items-center justify-center p-8 space-x-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Downloading weights to browser cache...</span>
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