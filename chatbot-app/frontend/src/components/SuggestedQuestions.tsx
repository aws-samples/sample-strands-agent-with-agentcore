'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';
import { apiPost } from '@/lib/api-client';

interface SuggestedQuestion {
  id: string;
  text: string;
}

interface SuggestedQuestionsProps {
  onQuestionSubmit: (question: string) => void;
  enabledTools: string[];
  onQuestionSelect?: (question: string) => void;
}

export function SuggestedQuestions({ onQuestionSubmit, enabledTools }: SuggestedQuestionsProps) {
  const [questions, setQuestions] = useState<SuggestedQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showQuestions, setShowQuestions] = useState(false);

  const generateQuestions = async () => {
    setIsLoading(true);
    setShowQuestions(false);
    
    // If no tools are available, show generic fallback questions
    if (!enabledTools || enabledTools.length === 0) {
      setQuestions([
        { id: '1', text: 'What can you help me with?' },
        { id: '2', text: 'Tell me about your capabilities' }
      ]);
      setIsLoading(false);
      setTimeout(() => setShowQuestions(true), 100);
      return;
    }
    
    try {
      const data = await apiPost<{ questions: SuggestedQuestion[] }>(
        'chat/suggestions',
        {
          available_tools: enabledTools,
          conversation_history: ""
        }
      );

      if (data.questions && Array.isArray(data.questions)) {
        setQuestions(data.questions);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      setQuestions([
        { id: '1', text: 'What can you help me with?' },
        { id: '2', text: 'How can I use these tools?' }
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => setShowQuestions(true), 100);
    }
  };

  useEffect(() => {
    generateQuestions();
  }, []);

  if (isLoading) {
    return null;
  }

  if (questions.length === 0) return null;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 mb-4">
      <div 
        className={`grid grid-cols-1 md:grid-cols-2 gap-2 transition-all duration-500 ease-out ${
          showQuestions ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        {questions.map((question, index) => (
          <Button
            key={question.id}
            variant="outline"
            className={`h-auto p-3 text-left justify-start text-wrap whitespace-normal transition-all duration-200 ${
              index === 0 
                ? "border-blue-200 hover:border-blue-300 hover:bg-blue-50 text-blue-700"
                : "border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50 text-emerald-700"
            }`}
            onClick={() => onQuestionSubmit(question.text)}
          >
            <div className="flex items-start gap-2 w-full">
              <div className="flex-shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="text-label leading-relaxed">{question.text}</span>
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
