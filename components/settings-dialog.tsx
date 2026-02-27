'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Save } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PromptSettings {
  leads?: {
    system_prompt?: string;
    analysis_prompt?: string;
  };
  application?: {
    system_prompt?: string;
    analysis_prompt?: string;
  };
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [settings, setSettings] = useState<PromptSettings>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeModule, setActiveModule] = useState<'leads' | 'application'>('leads');
  const [activeTab, setActiveTab] = useState<'system' | 'analysis'>('system');

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  async function loadSettings() {
    setIsLoading(true);
    try {
      const response = await fetch('/api/settings/prompts');
      if (response.ok) {
        const data = await response.json();
        console.log('[v0] Settings loaded:', data);
        setSettings(data);
      }
    } catch (error) {
      console.error('[v0] Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      
      if (response.ok) {
        console.log('[v0] Settings saved successfully');
        onOpenChange(false);
      }
    } catch (error) {
      console.error('[v0] Failed to save settings:', error);
    } finally {
      setIsSaving(false);
    }
  }

  function updatePrompt(module: 'leads' | 'application', type: 'system_prompt' | 'analysis_prompt', value: string) {
    setSettings((prev) => ({
      ...prev,
      [module]: {
        ...prev[module],
        [type]: value,
      },
    }));
  }

  const currentPrompt = settings[activeModule]?.[activeTab === 'system' ? 'system_prompt' : 'analysis_prompt'] || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="text-xl">LLM Prompt Settings</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <div className="flex flex-col h-[600px]">
            {/* Module Tabs */}
            <div className="border-b px-6">
              <Tabs value={activeModule} onValueChange={(v) => setActiveModule(v as 'leads' | 'application')}>
                <TabsList className="bg-transparent border-0 p-0 h-auto">
                  <TabsTrigger 
                    value="leads" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2"
                  >
                    Leads Module
                  </TabsTrigger>
                  <TabsTrigger 
                    value="application"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2"
                  >
                    Application Module
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Prompt Type Tabs */}
            <div className="border-b px-6 pt-3">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'system' | 'analysis')}>
                <TabsList className="bg-transparent border-0 p-0 h-auto">
                  <TabsTrigger 
                    value="system"
                    className="rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-4 py-1.5 text-sm"
                  >
                    System Prompt
                  </TabsTrigger>
                  <TabsTrigger 
                    value="analysis"
                    className="rounded-md data-[state=active]:bg-secondary px-4 py-1.5 text-sm"
                  >
                    Analysis Prompt
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Content */}
            <div className="flex-1 px-6 py-4 overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-base">
                  {activeTab === 'system' ? 'System Prompt' : 'Analysis Prompt'}
                </h3>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary">
                  {activeModule.toUpperCase()}
                </Badge>
              </div>
              
              {activeTab === 'system' && (
                <p className="text-sm text-muted-foreground mb-3">
                  Sets the context and role for the LLM when analyzing {activeModule}. Defines who the AI is and how it should behave.
                </p>
              )}
              
              <ScrollArea className="h-[380px]">
                <Textarea
                  value={currentPrompt}
                  onChange={(e) => updatePrompt(
                    activeModule,
                    activeTab === 'system' ? 'system_prompt' : 'analysis_prompt',
                    e.target.value
                  )}
                  className="min-h-[360px] font-mono text-sm resize-none"
                  placeholder={`Enter ${activeTab} prompt for ${activeModule}...`}
                />
              </ScrollArea>
            </div>
          </div>
        )}

        <DialogFooter className="p-6 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? (
              <>
                <Spinner className="h-4 w-4" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save All Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
