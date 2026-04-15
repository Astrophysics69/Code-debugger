/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bug, Play, Code2, Sparkles, AlertCircle, Terminal, Info, Copy, Check, Upload, Zap, Plus, Trash2, Settings2, X, Cpu, Share2, Link, Search, StepForward, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { transform } from "sucrase";
import hljs from 'highlight.js';
import { debugCode, simulateExecution, quickAnalysis, debugCodeStream } from "./services/geminiService";
import { saveSnippet, getSnippet } from "./lib/firebase";

const LANGUAGE_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  javascript: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20' },
  typescript: { color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
  jsx: { color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' },
  tsx: { color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  python: { color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  cpp: { color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20' },
  c: { color: 'text-gray-400', bg: 'bg-gray-400/10', border: 'border-gray-400/20' },
  rust: { color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  go: { color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' },
  json: { color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' },
};

function CodeBlock({ language, value, variant = 'default', onRun }: { language: string; value: string; variant?: 'default' | 'wrong'; onRun?: (code: string, lang: string) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isWrong = variant === 'wrong';
  const runnableLanguages = ['javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx', 'json', 'python', 'py', 'cpp', 'c', 'objectivec', 'rust', 'go'];
  const canRun = runnableLanguages.includes(language?.toLowerCase()) && onRun;

  return (
    <div className={`relative group my-4 rounded-lg overflow-hidden border shadow-2xl ${isWrong ? 'border-red-500/30' : 'border-white/10'}`}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${isWrong ? 'bg-red-950/50 border-red-500/20' : 'bg-[#1e1e1e] border-white/5'}`}>
        <span className={`text-[10px] font-mono uppercase tracking-widest ${isWrong ? 'text-red-400' : 'text-[#8E9299]'}`}>
          {isWrong ? 'BUGGY SNIPPET' : (language || 'code')}
        </span>
        <div className="flex items-center gap-2">
          {canRun && (
            <button
              onClick={() => onRun(value, language)}
              className="text-green-500 hover:text-green-400 transition-colors p-1 rounded hover:bg-white/5 flex items-center gap-1 text-[10px] font-mono uppercase"
              title="Run this snippet"
            >
              <Play className="w-3 h-3" />
              Run
            </button>
          )}
          <button
            onClick={handleCopy}
            className="text-[#8E9299] hover:text-white transition-colors p-1 rounded hover:bg-white/5"
            title="Copy code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '1.5rem',
          fontSize: '0.85rem',
          lineHeight: '1.5',
          background: isWrong ? '#1a0a0a' : '#151619',
        }}
        codeTagProps={{
          style: {
            fontFamily: '"JetBrains Mono", monospace',
          }
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

interface ParsedResponse {
  type: 'denied' | 'raw' | 'debug';
  content?: string;
  issue?: string;
  buggySnippet?: string;
  fixedCode?: string;
  explanation?: string;
}

interface HistoryItem {
  id: string;
  timestamp: number;
  code: string;
  issue: string;
  fixedCode: string;
  language: string;
}

export default function App() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [isTurbo, setIsTurbo] = useState(true);
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [progress, setProgress] = useState(0);
  const [detectedLang, setDetectedLang] = useState("javascript");
  const [selectedLang, setSelectedLang] = useState("auto");
  const [variables, setVariables] = useState<{ id: string; key: string; value: string; type: string }[]>([]);
  const [stdin, setStdin] = useState("");
  const [showVars, setShowVars] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [isPaused, setIsPaused] = useState(false);
  const [pausedLine, setPausedLine] = useState<number | null>(null);
  const [executionResult, setExecutionResult] = useState<{ logs: { id: string; text: string; type: 'log' | 'error' | 'warn' | 'info' | 'debug' | 'input' | 'prompt' }[]; error: string | null } | null>(null);
  const [isPyodideLoading, setIsPyodideLoading] = useState(false);
  const [isCppLoading, setIsCppLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isSharing, setIsSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const resumeRef = useRef<(() => void) | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pyodideRef = useRef<any>(null);
  const cppCompilerRef = useRef<any>(null);

  // Detect language when code changes
  useEffect(() => {
    const savedHistory = localStorage.getItem('debug_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('debug_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (!code.trim()) {
      setDetectedLang("javascript");
      return;
    }
    try {
      const result = hljs.highlightAuto(code);
      if (result.language) {
        setDetectedLang(result.language);
      }
    } catch (e) {
      console.error("Language detection failed", e);
    }
  }, [code]);

  // Handle shared snippets from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const snippetId = params.get('s');
    if (snippetId) {
      const loadSnippet = async () => {
        setIsLoading(true);
        try {
          const data = await getSnippet(snippetId);
          if (data) {
            setCode(data.code);
            if (data.language) setSelectedLang(data.language);
          }
        } catch (e) {
          console.error("Failed to load shared snippet", e);
          setError("Failed to load shared snippet. It may have been deleted or the link is invalid.");
        } finally {
          setIsLoading(false);
        }
      };
      loadSnippet();
    }
  }, []);

  const handleShare = async () => {
    if (!code.trim()) return;
    setIsSharing(true);
    setShareUrl(null);
    try {
      const lang = selectedLang === 'auto' ? detectedLang : selectedLang;
      const id = await saveSnippet(code, lang);
      const url = `${window.location.origin}${window.location.pathname}?s=${id}`;
      setShareUrl(url);
      navigator.clipboard.writeText(url);
    } catch (e) {
      console.error("Failed to share snippet", e);
      setError("Failed to generate share link. Please try again.");
    } finally {
      setIsSharing(false);
    }
  };

  const runCode = async (codeToRun: string, lang: string = 'javascript') => {
    setIsExecuting(true);
    setProgress(0);
    const logs: { id: string; text: string; type: 'log' | 'error' | 'warn' | 'info' | 'debug' | 'input' | 'prompt' }[] = [];
    const normalizedLang = lang.toLowerCase();
    
    const addLog = (text: string, type: 'log' | 'error' | 'warn' | 'info' | 'debug' | 'input' | 'prompt' = 'log') => {
      const newLog = { id: crypto.randomUUID(), text, type };
      logs.push(newLog);
      setExecutionResult(prev => prev ? { ...prev, logs: [...prev.logs, newLog] } : null);
    };

    setExecutionResult({ logs: [{ id: crypto.randomUUID(), text: "Initializing execution...", type: 'info' }], error: null });

    // Security check for specific multi-threaded C++ patterns that cause infinite loops
    if ((normalizedLang === 'cpp' || normalizedLang === 'c') && 
        codeToRun.includes('#include <thread>') && 
        (codeToRun.includes('while (!ready)') || codeToRun.includes('while(!ready)'))) {
      setExecutionResult({ 
        logs: [
          { id: crypto.randomUUID(), text: "⚠️ Execution Blocked", type: 'error' },
          { id: crypto.randomUUID(), text: "The provided C++ code contains a multi-threading pattern known to cause infinite loops due to lack of synchronization (non-atomic shared state).", type: 'warn' },
          { id: crypto.randomUUID(), text: "To fix this, use std::atomic<bool> or appropriate synchronization primitives.", type: 'info' }
        ], 
        error: "Potential Infinite Loop Detected" 
      });
      setIsExecuting(false);
      return;
    }
    
    // Simulate progress for visual feedback
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return prev;
        const increment = Math.random() * 10;
        return Math.min(prev + increment, 95);
      });
    }, 500);

    const stdinLines = stdin.split('\n');
    let stdinIndex = 0;
    const getNextStdin = (prompt?: string) => {
      if (prompt) {
        addLog(prompt, 'prompt');
      }
      const val = stdinLines[stdinIndex++] || "";
      addLog(val, 'input');
      return val;
    };

    const varsMap: Record<string, any> = {};
    variables.forEach(v => {
      if (!v.key.trim()) return;
      try {
        if (v.type === 'number') varsMap[v.key] = Number(v.value);
        else if (v.type === 'boolean') varsMap[v.key] = v.value.toLowerCase() === 'true';
        else if (v.type === 'json') varsMap[v.key] = JSON.parse(v.value);
        else varsMap[v.key] = v.value;
      } catch (e) {
        varsMap[v.key] = v.value;
      }
    });

    try {
      if (isSimulationMode || normalizedLang === 'cpp' || normalizedLang === 'c' || normalizedLang === 'objectivec' || normalizedLang === 'rust' || normalizedLang === 'go' || (normalizedLang === 'json' && isSimulationMode)) {
        let engineName = "AI Simulation Mode";
        if (normalizedLang === 'cpp') engineName = "C++ AI Simulation Engine";
        else if (normalizedLang === 'javascript' || normalizedLang === 'js') engineName = "JS AI Simulation Engine";
        else if (normalizedLang === 'typescript' || normalizedLang === 'ts') engineName = "TS AI Simulation Engine";
        else if (normalizedLang === 'python' || normalizedLang === 'py' || normalizedLang === 'python3') engineName = "Python 3 AI Simulation Engine";
        else if (normalizedLang === 'jsx' || normalizedLang === 'tsx' || codeToRun.includes('React') || codeToRun.includes('useState')) engineName = "React AI Simulation Engine";
        else if (normalizedLang === 'json') engineName = "JSON AI Simulation Engine";
        
        setExecutionResult({ logs: [{ id: crypto.randomUUID(), text: `🤖 ${engineName}: Analyzing code behavior...`, type: 'info' }], error: null });
        
        const simulationOutput = await simulateExecution(codeToRun, normalizedLang, varsMap, stdin);
        
        setExecutionResult({ 
          logs: [
            { id: crypto.randomUUID(), text: `✨ ${engineName} Result:`, type: 'info' },
            { id: crypto.randomUUID(), text: "---------------------------", type: 'info' },
            { id: crypto.randomUUID(), text: simulationOutput, type: 'log' },
            { id: crypto.randomUUID(), text: "---------------------------", type: 'info' },
            { id: crypto.randomUUID(), text: "Note: This output was predicted by AI analysis.", type: 'debug' }
          ], 
          error: null 
        });
        return;
      }

      if (normalizedLang === 'python' || normalizedLang === 'py' || normalizedLang === 'python3') {
        if (!pyodideRef.current) {
          setIsPyodideLoading(true);
          // @ts-ignore
          pyodideRef.current = await window.loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
          });
          setIsPyodideLoading(false);
        }
        
        // Load packages from imports automatically
        setExecutionResult({ logs: [{ id: crypto.randomUUID(), text: "Analyzing imports & loading packages...", type: 'info' }], error: null });
        try {
          await pyodideRef.current.loadPackagesFromImports(codeToRun);
        } catch (e) {
          console.warn("Failed to load some packages from imports", e);
        }

        // Inject variables into Python
        for (const [k, v] of Object.entries(varsMap)) {
          pyodideRef.current.globals.set(k, v);
        }

        // Mock input() for Python
        pyodideRef.current.globals.set('input', (prompt?: string) => {
          return getNextStdin(prompt);
        });

        // Capture python stdout
        pyodideRef.current.setStdout({
          batched: (text: string) => addLog(text)
        });

        // Add a timeout for Python execution (10s)
        const pythonTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Execution Timeout: Potential infinite loop detected (10s limit)")), 10000)
        );

        await Promise.race([
          pyodideRef.current.runPythonAsync(codeToRun),
          pythonTimeout
        ]);

        setExecutionResult(prev => prev ? { ...prev, logs: prev.logs.filter(l => l.text !== "Initializing execution..." && l.text !== "Analyzing imports & loading packages..."), error: null } : null);
        clearInterval(progressInterval);
        setProgress(100);
        setTimeout(() => setProgress(0), 1000);
        return;
      }

      if (normalizedLang === 'json') {
        const parsed = JSON.parse(codeToRun);
        addLog(JSON.stringify(parsed, null, 2));
        setExecutionResult(prev => prev ? { ...prev, logs: prev.logs.filter(l => l.text !== "Initializing execution..."), error: null } : null);
        clearInterval(progressInterval);
        setProgress(100);
        setTimeout(() => setProgress(0), 1000);
        return;
      }

      let finalCode = codeToRun;
      if (['typescript', 'ts', 'tsx', 'jsx'].includes(normalizedLang)) {
        const result = transform(codeToRun, {
          transforms: ['typescript', 'jsx', 'imports'],
        });
        finalCode = result.code;
      }

      // Run JS in a Worker to prevent UI freeze
      await new Promise((resolve, reject) => {
        // Instrument code for breakpoints ONLY if breakpoints exist
        let instrumentedCode = "";
        if (breakpoints.size > 0) {
          const instrumentedLines = finalCode.split('\n').map((line, i) => {
            const lineNum = i + 1;
            // Skip empty lines or comments to reduce overhead
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.endsWith('*/')) return line;
            
            // Avoid instrumenting inside multi-line constructs if possible
            // This is still a heuristic, but better than nothing
            return `await __checkBreakpoint(${lineNum}); ${line}`;
          });
          instrumentedCode = `(async () => {\n${instrumentedLines.join('\n')}\n})()`;
        } else {
          instrumentedCode = `(async () => {\n${finalCode}\n})()`;
        }

        const workerCode = `
          self.onmessage = async function(e) {
            const { type, code, vars, breakpoints } = e.data;
            
            if (type === 'resume') {
              if (self.resumePromise) {
                self.resumePromise();
                self.resumePromise = null;
              }
              return;
            }

            if (type === 'step') {
              self.isStepping = true;
              if (self.resumePromise) {
                self.resumePromise();
                self.resumePromise = null;
              }
              return;
            }

            const console = {
              log: (...args) => self.postMessage({ type: 'log', content: args }),
              error: (...args) => self.postMessage({ type: 'error', content: args }),
              warn: (...args) => self.postMessage({ type: 'warn', content: args }),
              info: (...args) => self.postMessage({ type: 'info', content: args }),
            };

            const __checkBreakpoint = async (line) => {
              if (breakpoints.includes(line) || self.isStepping) {
                self.isStepping = false;
                
                // Try to capture current values of injected variables
                const currentVars = {};
                const varKeys = Object.keys(vars);
                // We can't easily get local variables not in 'vars', but we can get the ones we injected
                // Note: This eval works because it's inside the same scope as the user code if we pass it in.
                // Actually, __checkBreakpoint is defined OUTSIDE the user function in my current setup.
                // I need to move it INSIDE or pass a getter.
                
                self.postMessage({ type: 'breakpoint', line });
                await new Promise(resolve => {
                  self.resumePromise = resolve;
                });
              }
            };

            const int = (v) => parseInt(v);
            const float = (v) => parseFloat(v);
            const str = (v) => String(v);
            const bool = (v) => Boolean(v);
            const len = (v) => v?.length ?? 0;
            const range = (n) => Array.from({length: n}, (_, i) => i);
            const input = () => {
              self.postMessage({ type: 'warn', content: ["input() is not supported in JS Worker mode."] });
              return "";
            };

            try {
              const varKeys = Object.keys(vars);
              const varValues = Object.values(vars);
              const fn = new Function('console', 'input', 'int', 'float', 'str', 'bool', 'len', 'range', '__checkBreakpoint', code);
              await fn(console, input, int, float, str, bool, len, range, __checkBreakpoint, ...varValues);
              self.postMessage({ type: 'done' });
            } catch (err) {
              self.postMessage({ type: 'error', content: [err.message] });
              self.postMessage({ type: 'done' });
            }
          };
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        workerRef.current = worker;
        
        const timer = setTimeout(() => {
          if (!isPaused) {
            worker.terminate();
            workerRef.current = null;
            reject(new Error("Execution Timeout: Potential infinite loop detected (5s limit)"));
          }
        }, 5000);

        worker.onmessage = (e) => {
          const { type, content, line } = e.data;
          if (type === 'log') addLog(content.map(String).join(' '), 'log');
          if (type === 'error') addLog(content.map(String).join(' '), 'error');
          if (type === 'warn') addLog(content.map(String).join(' '), 'warn');
          if (type === 'info') addLog(content.map(String).join(' '), 'info');
          if (type === 'breakpoint') {
            setIsPaused(true);
            setPausedLine(line);
            addLog(`Paused at line ${line}`, 'debug');
          }
          if (type === 'done') {
            clearTimeout(timer);
            worker.terminate();
            workerRef.current = null;
            setIsPaused(false);
            setPausedLine(null);
            resolve(null);
          }
        };

        stopRef.current = () => {
          clearTimeout(timer);
          worker.terminate();
          workerRef.current = null;
          setIsPaused(false);
          setPausedLine(null);
          addLog("Execution stopped by user.", 'debug');
          resolve(null);
        };

        worker.postMessage({ 
          type: 'start',
          code: instrumentedCode, 
          vars: varsMap,
          breakpoints: Array.from(breakpoints)
        });

        resumeRef.current = () => {
          setIsPaused(false);
          setPausedLine(null);
          worker.postMessage({ type: 'resume' });
        };
      });
      
      setExecutionResult(prev => prev ? { 
        logs: prev.logs.filter(l => l.text !== "Initializing execution..."), 
        error: null 
      } : null);

    } catch (err: any) {
      clearInterval(progressInterval);
      setProgress(0);
      if (err.message === "QUOTA_EXCEEDED" || err.message === "AUTH_ERROR" || err.message === "SAFETY_ERROR" || err.message === "NETWORK_ERROR" || err.message === "TIMEOUT_ERROR") {
        handleAIError(err);
      }
      setExecutionResult({ logs: logs.filter(l => l.text !== "Initializing execution..." && l.text !== "Analyzing imports & loading packages..."), error: err.message });
    } finally {
      setIsExecuting(false);
      clearInterval(progressInterval);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setCode(content);
      // Reset input so the same file can be uploaded again if needed
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const parseAIResponse = (text: string): ParsedResponse => {
    if (text.includes("Access Denied")) {
      return { type: 'denied', content: text };
    }

    const sections = {
      issue: "",
      buggySnippet: "",
      fixedCode: "",
      explanation: ""
    };

    const issueMatch = text.match(/### 🔍 Identified Issue([\s\S]*?)(?=### |$)/i);
    const buggyMatch = text.match(/### ❌ Buggy Snippet([\s\S]*?)(?=### |$)/i);
    const fixedCodeMatch = text.match(/### ✅ Fixed Code([\s\S]*?)(?=### |$)/i);
    const explanationMatch = text.match(/### 🧠 Explanation([\s\S]*?)(?=### |$)/i);

    if (issueMatch) sections.issue = issueMatch[1].trim();
    if (buggyMatch) sections.buggySnippet = buggyMatch[1].trim();
    if (fixedCodeMatch) sections.fixedCode = fixedCodeMatch[1].trim();
    if (explanationMatch) sections.explanation = explanationMatch[1].trim();

    // Fallback if parsing fails but there is text
    if (!sections.issue && !sections.buggySnippet && !sections.fixedCode && !sections.explanation && text) {
      return { type: 'raw', content: text };
    }

    return { type: 'debug', ...sections };
  };

  const handleQuickAnalysis = async () => {
    if (!code.trim() || cooldown > 0) return;
    setIsLoading(true);
    setProgress(10);
    
    const interval = setInterval(() => {
      setProgress(prev => (prev < 90 ? prev + 15 : prev));
    }, 200);

    try {
      const result = await quickAnalysis(code);
      setResult(result);
      setProgress(100);
      setTimeout(() => setProgress(0), 500);
    } catch (error: any) {
      handleAIError(error);
    } finally {
      setIsLoading(false);
      clearInterval(interval);
    }
  };
  const handleDebug = async () => {
    if (!code.trim() || cooldown > 0) return;
    
    if (code.length > 25000 && !isTurbo) {
      setError("This code snippet is exceptionally large. 'Turbo Mode' is highly recommended to avoid timeouts.");
    } else if (code.length > 12000 && !isTurbo) {
      setError("Code is quite long. Enabling 'Turbo Mode' is recommended for faster analysis.");
    }

    setIsLoading(true);
    setError(null);
    setResult("");
    
    try {
      const historyContext = history.slice(-5).map(h => `ISSUE: ${h.issue}\nFIX: ${h.fixedCode}`);
      const stream = debugCodeStream(code, isTurbo, historyContext);
      let fullResponse = "";
      
      for await (const chunk of stream) {
        if (chunk) {
          fullResponse += chunk;
          setResult(fullResponse);
        }
      }

      // Save to history if successful and contains a fix
      const parsed = parseAIResponse(fullResponse);
      if (parsed.type === 'debug' && parsed.issue && parsed.fixedCode) {
        const newItem: HistoryItem = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          code: code,
          issue: parsed.issue,
          fixedCode: parsed.fixedCode,
          language: detectedLang
        };
        setHistory(prev => [newItem, ...prev].slice(0, 20)); // Keep last 20
      }
    } catch (err: any) {
      handleAIError(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAIError = (err: any) => {
    let message = "An unexpected error occurred. Please try again.";
    
    if (err.message === "AbortError") {
      message = "The request was cancelled or timed out.";
    }

    switch (err.message) {
      case "NETWORK_ERROR":
        message = "🌐 Network connection issue. Please check your internet connection or firewall settings and try again.";
        break;
      case "TIMEOUT_ERROR":
        message = "⏱️ Request timed out. The code snippet might be too complex for a quick analysis. Try breaking it into smaller parts.";
        break;
      case "QUOTA_EXCEEDED":
        message = isTurbo 
          ? "🚀 Turbo quota reached. The AI service is temporarily at capacity. Please wait a minute for the system to reset."
          : "📉 Standard quota exceeded. Enable 'Turbo Mode' for higher limits or wait for the cooldown period to end.";
        setCooldown(60);
        const timer = setInterval(() => {
          setCooldown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        break;
      case "API_KEY_INVALID":
        message = "🔑 Invalid API Key. Please check your Gemini API key in the settings menu. It may be expired or incorrectly copied.";
        break;
      case "AUTH_ERROR":
        message = "🚫 Permission Denied. Your API key doesn't have access to the requested model. Check your Google AI Studio project permissions.";
        break;
      case "SAFETY_ERROR":
        message = "🛡️ Content Filtered. The AI blocked this request due to safety concerns. Ensure your code doesn't contain sensitive or prohibited content.";
        break;
      case "SERVICE_UNAVAILABLE":
        message = "🏗️ AI Service Unavailable. The Gemini servers are currently overloaded or undergoing maintenance. Please try again in a few minutes.";
        break;
      case "EMPTY_RESPONSE":
        message = "❓ Empty Response. The AI was unable to generate a result for this input. Try rephrasing your code or adding more context.";
        break;
      default:
        message = `⚠️ An unexpected error occurred: ${err.message || "Unknown Error"}. Please try again later.`;
    }
    
    setError(message);
    console.error(err);
  };

  const parsedResult = result ? parseAIResponse(result) : null;

  return (
    <div className="min-h-screen bg-[#E6E6E6] p-4 md:p-8 font-sans text-[#151619]">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="bg-[#151619] p-2 rounded-lg">
                <Bug className="w-6 h-6 text-[#FF4444] animate-pulse" />
              </div>
              <h1 className="text-3xl font-bold tracking-tighter uppercase italic font-serif">
                DebugAI <span className="text-[#8E9299] font-normal not-italic">v1.0</span>
              </h1>
            </div>
            <p className="text-sm text-[#8E9299] font-mono uppercase tracking-widest">
              Specialized Code Analysis & Explanation Engine
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Badge variant="outline" className={`font-mono text-[10px] ${isSimulationMode ? 'border-green-500 text-green-500' : pyodideRef.current ? 'border-green-500 text-green-500' : 'border-[#151619] text-[#151619]'}`}>
              PYTHON 3: {isSimulationMode ? 'AI SIMULATION' : pyodideRef.current ? 'READY' : isPyodideLoading ? 'LOADING...' : 'STANDBY'}
            </Badge>
            <Badge variant="outline" className={`font-mono text-[10px] ${isSimulationMode ? 'border-yellow-500 text-yellow-500' : 'border-[#151619] text-[#151619]'}`}>
              JS/TS/REACT: {isSimulationMode ? 'AI SIMULATION' : 'LOCAL WORKER'}
            </Badge>
            <Badge variant="outline" className="border-blue-500 text-blue-500 font-mono text-[10px]">
              C/C++: AI SIMULATION
            </Badge>
            <Badge variant="outline" className={`font-mono text-[10px] ${isSimulationMode ? 'border-orange-500 text-orange-500' : 'border-[#151619] text-[#151619]'}`}>
              JSON: {isSimulationMode ? 'AI SIMULATION' : 'PARSER'}
            </Badge>
            <Badge variant="outline" className="border-[#151619] text-[#151619] font-mono px-3 py-1">
              SYSTEM READY
            </Badge>
            <div className="flex items-center gap-2 ml-4 px-3 py-1 rounded-full bg-white/5 border border-white/10">
              <Zap className={`w-3 h-3 ${isTurbo ? 'text-yellow-400 fill-yellow-400' : 'text-[#3A3B3F]'}`} />
              <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">Turbo</span>
              <button 
                onClick={() => setIsTurbo(!isTurbo)}
                className={`w-8 h-4 rounded-full transition-colors relative ${isTurbo ? 'bg-yellow-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${isTurbo ? 'left-4.5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
              <Cpu className={`w-3 h-3 ${isSimulationMode ? 'text-blue-400 fill-blue-400' : 'text-[#3A3B3F]'}`} />
              <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">AI Sim</span>
              <button 
                onClick={() => setIsSimulationMode(!isSimulationMode)}
                className={`w-8 h-4 rounded-full transition-colors relative ${isSimulationMode ? 'bg-blue-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${isSimulationMode ? 'left-4.5' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
        </header>
        
        {progress > 0 && (
          <div className="fixed top-0 left-0 w-full h-1 z-50 bg-white/5">
            <motion.div 
              className="h-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.2 }}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Input Section */}
          <Card className="bg-[#151619] border-none shadow-2xl overflow-hidden">
            <CardHeader className="border-b border-white/10 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[#8E9299]" />
                    <CardTitle className="text-white text-sm font-mono uppercase tracking-wider">Source Input</CardTitle>
                  </div>
                  
                  <div className="h-4 w-[1px] bg-white/10 mx-1" />
                  
                  <div className="flex items-center gap-2">
                    <select 
                      className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[10px] font-mono text-white/70 uppercase focus:outline-none focus:border-white/30 cursor-pointer transition-all hover:bg-white/10"
                      value={selectedLang}
                      onChange={(e) => setSelectedLang(e.target.value)}
                    >
                      <option value="auto" className="bg-[#151619]">Auto-Detect</option>
                      <option value="javascript" className="bg-[#151619]">JavaScript</option>
                      <option value="typescript" className="bg-[#151619]">TypeScript</option>
                      <option value="jsx" className="bg-[#151619]">React (JSX)</option>
                      <option value="tsx" className="bg-[#151619]">React (TSX)</option>
                      <option value="python" className="bg-[#151619]">Python 3</option>
                      <option value="cpp" className="bg-[#151619]">C++</option>
                      <option value="c" className="bg-[#151619]">C</option>
                      <option value="rust" className="bg-[#151619]">Rust</option>
                      <option value="go" className="bg-[#151619]">Go</option>
                      <option value="json" className="bg-[#151619]">JSON</option>
                    </select>

                    {breakpoints.size > 0 && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setBreakpoints(new Set())}
                        className="h-6 px-2 text-[9px] text-red-400 hover:text-red-300 hover:bg-red-400/10 font-mono uppercase"
                      >
                        Clear Breakpoints ({breakpoints.size})
                      </Button>
                    )}

                    <AnimatePresence mode="wait">
                      <motion.div
                        key={`lang-badge-top-${detectedLang}`}
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 5 }}
                        className="flex items-center gap-1.5"
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${LANGUAGE_CONFIG[detectedLang]?.color.replace('text-', 'bg-') || 'bg-[#FF4444]'} animate-pulse`} />
                        <span className={`text-[10px] font-mono uppercase tracking-widest ${LANGUAGE_CONFIG[detectedLang]?.color || 'text-[#FF4444]'}`}>
                          {detectedLang}
                        </span>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBreakpoints(new Set())}
                    disabled={breakpoints.size === 0}
                    className="text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-red-400 hover:bg-red-400/5 h-7 px-2"
                  >
                    Clear Breakpoints
                  </Button>
                  <Badge variant="secondary" className="bg-white/5 text-[#8E9299] border-none font-mono text-[10px]">
                    UTF-8
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="relative flex h-[400px] overflow-hidden">
                {/* Line Numbers / Breakpoints Gutter */}
                <div 
                  id="editor-gutter"
                  className="w-12 bg-[#1a1b1e] border-r border-white/5 flex flex-col py-6 select-none overflow-hidden"
                >
                  {code.split('\n').map((_, i) => (
                    <div 
                      key={`line-${i}`} 
                      className="h-[20px] flex items-center justify-center group cursor-pointer relative shrink-0"
                      onClick={() => {
                        const newBreakpoints = new Set(breakpoints);
                        if (newBreakpoints.has(i + 1)) {
                          newBreakpoints.delete(i + 1);
                        } else {
                          newBreakpoints.add(i + 1);
                        }
                        setBreakpoints(newBreakpoints);
                      }}
                    >
                      <span className={`text-[10px] font-mono ${pausedLine === i + 1 ? 'text-yellow-500 font-bold' : 'text-white/20 group-hover:text-white/40'}`}>
                        {i + 1}
                      </span>
                      {breakpoints.has(i + 1) && (
                        <div className="absolute left-1 w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                      )}
                      {pausedLine === i + 1 && (
                        <div className="absolute right-0 w-1 h-full bg-yellow-500" />
                      )}
                    </div>
                  ))}
                </div>
                <Textarea
                  placeholder="// Paste your code here (JS, TS, Python 3, C++, etc.)..."
                  className="flex-1 bg-transparent border-none text-white font-mono text-sm resize-none focus-visible:ring-0 p-6 pt-6 placeholder:text-[#3A3B3F] leading-[20px] overflow-y-auto"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onScroll={(e) => {
                    const gutter = document.getElementById('editor-gutter');
                    if (gutter) {
                      gutter.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
                    }
                  }}
                  style={{ lineHeight: '20px' }}
                />

                {/* Floating Language Badge */}
                <div className="absolute bottom-4 left-6 pointer-events-none">
                  <AnimatePresence mode="wait">
                    {code.trim() && (
                      <motion.div
                        key={`lang-badge-float-${detectedLang}`}
                        initial={{ opacity: 0, y: 10, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.9 }}
                        className={`px-3 py-1 rounded-full border ${LANGUAGE_CONFIG[detectedLang]?.bg || 'bg-white/5'} ${LANGUAGE_CONFIG[detectedLang]?.border || 'border-white/10'} flex items-center gap-2 shadow-lg backdrop-blur-sm`}
                      >
                        <Code2 className={`w-3 h-3 ${LANGUAGE_CONFIG[detectedLang]?.color || 'text-white/50'}`} />
                        <span className={`text-[10px] font-mono uppercase tracking-widest font-bold ${LANGUAGE_CONFIG[detectedLang]?.color || 'text-white/50'}`}>
                          {detectedLang}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* Variable Injection Console */}
                <AnimatePresence>
                  {showVars && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="absolute bottom-20 left-6 right-6 z-10"
                    >
                      <Card className="bg-[#1a1b1e] border border-white/10 shadow-2xl">
                        <CardHeader className="py-2 px-4 border-b border-white/5 flex flex-row items-center justify-between space-y-0">
                          <div className="flex items-center gap-2">
                            <Settings2 className="w-3.5 h-3.5 text-yellow-500" />
                            <CardTitle className="text-[10px] font-mono uppercase tracking-widest text-white/70">Execution Environment</CardTitle>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 text-white/30 hover:text-white hover:bg-white/5"
                            onClick={() => setShowVars(false)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </CardHeader>
                        <CardContent className="p-0 max-h-[300px] overflow-hidden">
                          <Tabs defaultValue="variables" className="w-full">
                            <div className="px-4 pt-2 border-b border-white/5">
                              <TabsList className="bg-transparent h-8 p-0 gap-4">
                                <TabsTrigger value="variables" className="data-[state=active]:bg-transparent data-[state=active]:text-yellow-500 data-[state=active]:border-b-2 data-[state=active]:border-yellow-500 rounded-none h-8 px-0 text-[10px] font-mono uppercase tracking-widest">Variables</TabsTrigger>
                                <TabsTrigger value="stdin" className="data-[state=active]:bg-transparent data-[state=active]:text-yellow-500 data-[state=active]:border-b-2 data-[state=active]:border-yellow-500 rounded-none h-8 px-0 text-[10px] font-mono uppercase tracking-widest">Standard Input (stdin)</TabsTrigger>
                              </TabsList>
                            </div>
                            
                            <TabsContent value="variables" className="p-4 m-0 overflow-y-auto max-h-[240px]">
                              <div className="space-y-3">
                                {variables.length === 0 && (
                                  <div className="text-center py-6 border-2 border-dashed border-white/5 rounded-lg">
                                    <p className="text-[10px] font-mono text-white/20 uppercase tracking-tighter">No variables defined</p>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="mt-2 text-[10px] text-yellow-500/50 hover:text-yellow-500 hover:bg-yellow-500/5"
                                      onClick={() => setVariables([...variables, { id: crypto.randomUUID(), key: '', value: '', type: 'string' }])}
                                    >
                                      <Plus className="w-3 h-3 mr-1" /> Add First Variable
                                    </Button>
                                  </div>
                                )}
                                {variables.map((v) => (
                                  <div key={`var-${v.id}`} className="flex gap-2 items-start group">
                                    <div className="flex-1 grid grid-cols-3 gap-2">
                                      <input 
                                        placeholder="Key (e.g. userId)" 
                                        className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-yellow-500/50"
                                        value={v.key}
                                        onChange={(e) => {
                                          setVariables(variables.map(item => item.id === v.id ? { ...item, key: e.target.value } : item));
                                        }}
                                      />
                                      <input 
                                        placeholder="Value" 
                                        className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-yellow-500/50"
                                        value={v.value}
                                        onChange={(e) => {
                                          setVariables(variables.map(item => item.id === v.id ? { ...item, value: e.target.value } : item));
                                        }}
                                      />
                                      <select 
                                        className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-white/70 focus:outline-none focus:border-yellow-500/50 appearance-none cursor-pointer"
                                        value={v.type}
                                        onChange={(e) => {
                                          setVariables(variables.map(item => item.id === v.id ? { ...item, type: e.target.value } : item));
                                        }}
                                      >
                                        <option value="string" className="bg-[#1a1b1e]">String</option>
                                        <option value="number" className="bg-[#1a1b1e]">Number</option>
                                        <option value="boolean" className="bg-[#1a1b1e]">Boolean</option>
                                        <option value="json" className="bg-[#1a1b1e]">JSON/Object</option>
                                      </select>
                                    </div>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-8 w-8 text-white/20 hover:text-red-400 hover:bg-red-400/10"
                                      onClick={() => {
                                        setVariables(variables.filter(item => item.id !== v.id));
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                ))}
                                {variables.length > 0 && (
                                  <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="w-full border-white/5 text-white/40 hover:text-white hover:bg-white/5 text-[10px] font-mono uppercase"
                                    onClick={() => setVariables([...variables, { id: crypto.randomUUID(), key: '', value: '', type: 'string' }])}
                                  >
                                    <Plus className="w-3 h-3 mr-2" /> Add Variable
                                  </Button>
                                )}
                              </div>
                            </TabsContent>
                            
                            <TabsContent value="stdin" className="p-4 m-0">
                              <div className="space-y-2">
                                <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Enter values to be read by input() calls (one per line):</p>
                                <Textarea 
                                  placeholder="Value 1&#10;Value 2&#10;..."
                                  className="min-h-[150px] bg-white/5 border-white/10 text-white font-mono text-xs focus-visible:ring-yellow-500/50"
                                  value={stdin}
                                  onChange={(e) => setStdin(e.target.value)}
                                />
                              </div>
                            </TabsContent>
                          </Tabs>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.div 
                  className="absolute bottom-4 right-4 flex gap-2"
                  initial="hidden"
                  animate="visible"
                  variants={{
                    hidden: { opacity: 0, y: 10 },
                    visible: {
                      opacity: 1,
                      y: 0,
                      transition: {
                        staggerChildren: 0.1
                      }
                    }
                  }}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept=".js,.ts,.tsx,.jsx,.py,.java,.cpp,.c,.cc,.cxx,.h,.hpp,.cs,.go,.rs,.php,.rb,.html,.css,.json,.swift,.kt,.kts,.scala,.dart,.sql,.sh,.bash,.yml,.yaml,.md,.xml"
                  />
                  <motion.div 
                    variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
                    whileHover={{ y: -4, scale: 1.02 }}
                    whileTap={{ y: 0, scale: 0.98 }}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleShare}
                      disabled={isSharing || !code.trim()}
                      className="text-blue-500 hover:text-blue-600 hover:bg-blue-50 border-blue-200 hover:border-blue-300 transition-all"
                    >
                      {isSharing ? <Sparkles className="w-4 h-4 mr-2 animate-spin" /> : <Share2 className="w-4 h-4 mr-2" />}
                      {shareUrl ? "Link Copied!" : "Share Snippet"}
                    </Button>
                  </motion.div>

                  <motion.div 
                    variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
                    whileHover={{ y: -4, scale: 1.02 }}
                    whileTap={{ y: 0, scale: 0.98 }}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowVars(!showVars)}
                      className={`transition-all ${showVars ? 'bg-white/10 text-white border-white/30' : 'text-[#8E9299] hover:text-white hover:bg-white/10 border-white/10'}`}
                    >
                      <Settings2 className="w-4 h-4 mr-2" />
                      Variables {variables.length > 0 && `(${variables.length})`}
                    </Button>
                  </motion.div>

                  <motion.div 
                    variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
                    whileHover={{ y: -4, scale: 1.02 }}
                    whileTap={{ y: 0, scale: 0.98 }}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={triggerFileUpload}
                      disabled={isLoading}
                      className="text-[#8E9299] hover:text-white hover:bg-white/10 border-white/10 hover:border-white/20 transition-all"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Upload File
                    </Button>
                  </motion.div>
                  
                  <motion.div 
                    variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
                    whileHover={{ y: -4, scale: 1.02 }}
                    whileTap={{ y: 0, scale: 0.98 }}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCode("");
                        setExecutionResult(null);
                      }}
                      disabled={isLoading || !code.trim()}
                      className="text-[#8E9299] hover:text-white hover:bg-white/10 border-white/10 hover:border-white/20 transition-all"
                    >
                      Clear Input
                    </Button>
                  </motion.div>

                  <motion.div 
                    variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
                    whileHover={{ y: -4, scale: 1.05 }}
                    whileTap={{ y: 0, scale: 0.95 }}
                  >
                    {isExecuting ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => stopRef.current?.()}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200 hover:border-red-300 transition-all"
                      >
                        <X className="w-4 h-4 mr-2" />
                        Stop Code
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runCode(code, selectedLang === 'auto' ? detectedLang : selectedLang)}
                        disabled={isLoading || !code.trim() || isPyodideLoading || isCppLoading}
                        className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200 hover:border-green-300 transition-all"
                      >
                        {isPyodideLoading || isCppLoading ? <Sparkles className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                        Run Code
                      </Button>
                    )}
                  </motion.div>

                  <motion.div 
                    variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
                    whileHover={{ y: -4, scale: 1.05 }}
                    whileTap={{ y: 0, scale: 0.95 }}
                  >
                    <Button 
                      onClick={() => setIsTurbo(!isTurbo)} 
                      variant="outline"
                      size="sm"
                      className={`transition-all ${isTurbo ? 'border-orange-500/50 text-orange-500 bg-orange-500/5' : 'border-white/10 text-white/40'}`}
                    >
                      <Zap className={`w-4 h-4 mr-2 ${isTurbo ? 'fill-orange-500' : ''}`} />
                      Turbo {isTurbo ? 'ON' : 'OFF'}
                    </Button>
                  </motion.div>

                  <motion.div 
                    variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
                    whileHover={{ y: -4, scale: 1.05 }}
                    whileTap={{ y: 0, scale: 0.95 }}
                  >
                    <Button 
                      onClick={handleQuickAnalysis} 
                      disabled={isLoading || !code.trim()}
                      variant="outline"
                      size="sm"
                      className="border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 transition-all"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Quick Scan
                    </Button>
                  </motion.div>

                  <motion.div 
                    variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1 } }}
                    whileHover={{ y: -4, scale: 1.05 }}
                    whileTap={{ y: 0, scale: 0.95 }}
                  >
                    <Button 
                      onClick={handleDebug} 
                      disabled={isLoading || !code.trim() || cooldown > 0}
                      className="bg-[#FF4444] hover:bg-[#FF4444]/90 text-white border-none shadow-[0_0_15px_rgba(255,68,68,0.3)] transition-all disabled:bg-[#FF4444]/50"
                    >
                      {isLoading ? (
                        <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Bug className="w-4 h-4 mr-2" />
                      )}
                      {isLoading ? "Analyzing..." : cooldown > 0 ? `Cooldown (${cooldown}s)` : "Execute Debug"}
                    </Button>
                  </motion.div>
                </motion.div>
              </div>

              {/* Integrated Console Output */}
              <AnimatePresence>
                {isExecuting && progress > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="px-6 py-2 bg-[#0a0a0a] border-t border-white/10"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Execution Progress</span>
                      <span className="text-[10px] font-mono text-green-500">{Math.round(progress)}%</span>
                    </div>
                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ type: "spring", stiffness: 50, damping: 20 }}
                      />
                    </div>
                  </motion.div>
                )}
                {executionResult && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-white/10 bg-[#0a0a0a]"
                  >
                    <div className="flex items-center justify-between px-6 py-2 bg-white/5 border-b border-white/5">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-3 h-3 text-green-500" />
                        <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">Console Output</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isPaused && (
                          <Badge variant="outline" className="bg-yellow-500/10 border-yellow-500/50 text-yellow-500 text-[9px] font-mono animate-pulse">
                            PAUSED @ LINE {pausedLine}
                          </Badge>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setExecutionResult(prev => prev ? { ...prev, logs: [] } : null)}
                          className="h-5 px-2 text-[9px] text-[#8E9299] hover:text-white hover:bg-white/5"
                        >
                          <Trash2 className="w-2.5 h-2.5 mr-1" />
                          Clear Console
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setExecutionResult(null)}
                          className="h-5 px-2 text-[9px] text-[#8E9299] hover:text-white hover:bg-white/5"
                        >
                          Close Console
                        </Button>
                      </div>
                    </div>

                    {isPaused && (
                      <div className="bg-yellow-500/5 border-b border-yellow-500/10 px-6 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                            <span className="text-[10px] font-mono text-yellow-500 uppercase tracking-tighter">Debugger Active</span>
                          </div>
                          <Separator orientation="vertical" className="h-3 bg-yellow-500/20" />
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Variables:</span>
                            <div className="flex gap-2">
                              {variables.map(v => (
                                <Badge key={`debug-var-${v.id}`} variant="outline" className="bg-white/5 border-white/10 text-[9px] font-mono text-white/60 lowercase">
                                  {v.key}: {v.value}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="ghost"
                            className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-7 text-[9px] uppercase tracking-widest px-3 gap-1.5"
                            onClick={() => stopRef.current?.()}
                          >
                            <Square className="w-2.5 h-2.5 fill-current" /> Stop
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10 h-7 text-[9px] uppercase tracking-widest px-3 gap-1.5"
                            onClick={() => {
                              setIsPaused(false);
                              setPausedLine(null);
                              workerRef.current?.postMessage({ type: 'step' });
                            }}
                          >
                            <StepForward className="w-2.5 h-2.5" /> Step Over
                          </Button>
                          <Button 
                            size="sm" 
                            className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold h-7 text-[9px] uppercase tracking-widest px-3 gap-1.5"
                            onClick={() => resumeRef.current?.()}
                          >
                            <Play className="w-2.5 h-2.5 fill-black" /> Resume
                          </Button>
                        </div>
                      </div>
                    )}

                    <ScrollArea className="h-[150px] w-full">
                      <div className="p-6 font-mono text-xs space-y-1">
                        {executionResult.logs.length === 0 && !executionResult.error && (
                          <p className="text-[#3A3B3F] italic">No output produced.</p>
                        )}
                        {executionResult.logs.map((log, index) => {
                          const typeConfigs = {
                            log: { 
                              style: 'text-white/90', 
                              icon: <Terminal className="w-3 h-3" />,
                              bg: 'hover:bg-white/5',
                              label: 'LOG'
                            },
                            error: { 
                              style: 'text-red-400', 
                              icon: <X className="w-3 h-3" />,
                              bg: 'bg-red-400/5 hover:bg-red-400/10',
                              label: 'ERROR'
                            },
                            warn: { 
                              style: 'text-yellow-400', 
                              icon: <AlertCircle className="w-3 h-3" />,
                              bg: 'bg-yellow-400/5 hover:bg-yellow-400/10',
                              label: 'WARN'
                            },
                            info: { 
                              style: 'text-blue-400', 
                              icon: <Info className="w-3 h-3" />,
                              bg: 'bg-blue-400/5 hover:bg-blue-400/10',
                              label: 'INFO'
                            },
                            debug: { 
                              style: 'text-purple-400 italic', 
                              icon: <Settings2 className="w-3 h-3" />,
                              bg: 'hover:bg-purple-400/5',
                              label: 'DEBUG'
                            },
                            input: { 
                              style: 'text-green-400 font-bold', 
                              icon: <Terminal className="w-3 h-3" />,
                              bg: 'bg-green-400/5 hover:bg-green-400/10',
                              label: 'INPUT'
                            },
                            prompt: { 
                              style: 'text-cyan-400 font-bold', 
                              icon: <Sparkles className="w-3 h-3" />,
                              bg: 'bg-cyan-400/5 hover:bg-cyan-400/10',
                              label: 'AI'
                            }
                          };
                          
                          const config = typeConfigs[log.type] || typeConfigs.log;
                          const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                          
                          return (
                            <div 
                              key={`debug-log-${log.id}-${index}`} 
                              className={`group flex gap-3 px-4 py-1.5 transition-colors border-l-2 border-transparent ${config.bg} ${config.style} ${log.type === 'error' ? 'border-l-red-500' : ''}`}
                            >
                              <div className="flex flex-col items-end shrink-0 w-12 select-none opacity-20 group-hover:opacity-40 transition-opacity">
                                <span className="text-[8px] leading-none mb-1">{time}</span>
                                <span className="text-[9px] font-bold leading-none">{index + 1}</span>
                              </div>
                              
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <div className={`mt-0.5 shrink-0 p-1 rounded bg-white/5 border border-white/10 opacity-70`}>
                                  {config.icon}
                                </div>
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[8px] font-bold uppercase tracking-tighter opacity-40">{config.label}</span>
                                    {log.type === 'input' && <Badge variant="outline" className="text-[8px] h-3 px-1 border-green-500/30 text-green-500 bg-green-500/5">USER</Badge>}
                                  </div>
                                  <span className="whitespace-pre-wrap break-all leading-relaxed">
                                    {log.type === 'input' && '> '}
                                    {log.type === 'prompt' && '? '}
                                    {log.text}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {executionResult.error && (
                          <div className="text-red-400 bg-red-400/5 p-3 rounded border border-red-400/10 mt-2 flex gap-3">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <div>
                              <span className="font-bold block mb-1">Runtime Error</span>
                              <span className="opacity-80">{executionResult.error}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Output Section */}
          <div className="space-y-6">
            <Tabs defaultValue="analysis" className="w-full">
              <div className="flex items-center justify-between mb-4">
                <TabsList className="bg-white/50 p-1 rounded-lg inline-flex">
                  <TabsTrigger value="analysis" className="px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all">Analysis</TabsTrigger>
                  <TabsTrigger value="history" className="px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all flex items-center gap-2">
                    Memory 
                    {history.length > 0 && (
                      <span className="bg-[#FF4444] text-white text-[8px] px-1.5 py-0.5 rounded-full animate-pulse">
                        {history.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
                
                <AnimatePresence>
                  {history.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                    >
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          if (window.confirm("Are you sure you want to clear all learned patterns?")) {
                            setHistory([]);
                          }
                        }}
                        className="h-7 text-[9px] text-[#8E9299] hover:text-red-500 hover:bg-red-50 uppercase tracking-widest font-mono"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Clear Memory
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <TabsContent value="analysis" className="mt-0 focus-visible:outline-none">
                <AnimatePresence mode="wait">
                  {!result && !isLoading && !error && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                    >
                      <Card className="bg-white border-none shadow-xl">
                        <CardContent className="p-12 flex flex-col items-center text-center space-y-4">
                          <div className="w-16 h-16 rounded-full bg-[#E6E6E6] flex items-center justify-center">
                            <Code2 className="w-8 h-8 text-[#8E9299]" />
                          </div>
                          <div className="space-y-2">
                            <h3 className="text-lg font-bold italic font-serif">Awaiting Input</h3>
                            <p className="text-sm text-[#8E9299] max-w-xs">
                              Paste your code snippet in the left panel to begin the analysis process.
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}

              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4"
                >
                  {[1, 2, 3].map((i) => (
                    <div key={`skeleton-${i}`} className="h-24 bg-white/50 animate-pulse rounded-lg border border-white/20" />
                  ))}
                  <p className="text-center text-xs font-mono text-[#8E9299] uppercase tracking-widest animate-pulse">
                    Scanning for syntax errors and logical fallacies...
                  </p>
                </motion.div>
              )}

              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <Card className="bg-red-50 border-red-200 border">
                    <CardContent className="p-6 flex items-start gap-4">
                      <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
                      <div className="flex-1 space-y-3">
                        <div>
                          <h3 className="font-bold text-red-900">System Error</h3>
                          <p className="text-sm text-red-700">{error}</p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={handleDebug}
                          disabled={cooldown > 0}
                          className="border-red-200 text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          {cooldown > 0 ? `Wait ${cooldown}s` : "Retry Analysis"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {parsedResult && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  {parsedResult.type === 'denied' ? (
                    <Card className="bg-orange-50 border-orange-200 border">
                      <CardContent className="p-6 flex items-start gap-4">
                        <AlertCircle className="w-5 h-5 text-orange-500 mt-0.5" />
                        <div>
                          <h3 className="font-bold text-orange-900 italic font-serif">Security Protocol</h3>
                          <div className="markdown-body text-orange-800">
                            <ReactMarkdown>{parsedResult.content || ""}</ReactMarkdown>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : parsedResult.type === 'raw' ? (
                    <Card className="bg-white border-none shadow-xl">
                      <CardHeader className="bg-[#151619] text-white py-3">
                        <div className="flex items-center gap-2">
                          <Info className="w-4 h-4 text-[#FF4444]" />
                          <CardTitle className="text-xs font-mono uppercase tracking-widest">Raw Analysis</CardTitle>
                        </div>
                      </CardHeader>
                      <ScrollArea className="h-[500px]">
                        <CardContent className="p-6 prose prose-slate max-w-none">
                          <div className="markdown-body">
                            <ReactMarkdown
                              components={{
                                code({ node, className, children, ...props }: any) {
                                  const match = /language-(\w+)/.exec(className || "");
                                  const isInline = !match;
                                  
                                  if (isInline) {
                                    return (
                                      <code className="bg-[#f0f0f0] px-1.5 py-0.5 rounded text-sm font-mono text-[#151619]" {...props}>
                                        {children}
                                      </code>
                                    );
                                  }

                                  return (
                                    <CodeBlock
                                      language={match[1]}
                                      value={String(children).replace(/\n$/, "")}
                                      onRun={runCode}
                                    />
                                  );
                                },
                              }}
                            >
                              {parsedResult.content || ""}
                            </ReactMarkdown>
                          </div>
                        </CardContent>
                      </ScrollArea>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {/* Identified Issue */}
                      {parsedResult.issue && (
                        <Card className="bg-white border-none shadow-lg overflow-hidden border-l-4 border-l-[#FF4444]">
                          <CardHeader className="bg-[#f8f9fa] py-3 border-b border-black/5">
                            <div className="flex items-center gap-2">
                              <Bug className="w-4 h-4 text-[#FF4444]" />
                              <CardTitle className="text-xs font-mono uppercase tracking-widest">Identified Issue</CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent className="p-5">
                            <div className="markdown-body">
                              <ReactMarkdown>{parsedResult.issue}</ReactMarkdown>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Buggy Snippet */}
                      {parsedResult.buggySnippet && (
                        <Card className="bg-white border-none shadow-lg overflow-hidden border-l-4 border-l-red-500">
                          <CardHeader className="bg-[#f8f9fa] py-3 border-b border-black/5">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="w-4 h-4 text-red-500" />
                              <CardTitle className="text-xs font-mono uppercase tracking-widest">Buggy Snippet</CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent className="p-0">
                            <div className="markdown-body px-5 py-2">
                              <ReactMarkdown
                                components={{
                                  code({ node, className, children, ...props }: any) {
                                    const match = /language-(\w+)/.exec(className || "");
                                    const isInline = !match;
                                    
                                    if (isInline) {
                                      return (
                                        <code className="bg-red-50 px-1.5 py-0.5 rounded text-sm font-mono text-red-900" {...props}>
                                          {children}
                                        </code>
                                      );
                                    }

                                    return (
                                      <CodeBlock
                                        language={match[1]}
                                        value={String(children).replace(/\n$/, "")}
                                        variant="wrong"
                                        onRun={runCode}
                                      />
                                    );
                                  },
                                }}
                              >
                                {parsedResult.buggySnippet}
                              </ReactMarkdown>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Fixed Code */}
                      {parsedResult.fixedCode && (
                        <Card className="bg-white border-none shadow-lg overflow-hidden border-l-4 border-l-green-500">
                          <CardHeader className="bg-[#f8f9fa] py-3 border-b border-black/5">
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-500" />
                              <CardTitle className="text-xs font-mono uppercase tracking-widest">Fixed Code</CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent className="p-0">
                            <div className="markdown-body px-5 py-2">
                              <ReactMarkdown
                                components={{
                                  code({ node, className, children, ...props }: any) {
                                    const match = /language-(\w+)/.exec(className || "");
                                    const isInline = !match;
                                    
                                    if (isInline) {
                                      return (
                                        <code className="bg-[#f0f0f0] px-1.5 py-0.5 rounded text-sm font-mono text-[#151619]" {...props}>
                                          {children}
                                        </code>
                                      );
                                    }

                                    return (
                                      <CodeBlock
                                        language={match[1]}
                                        value={String(children).replace(/\n$/, "")}
                                        onRun={runCode}
                                      />
                                    );
                                  },
                                }}
                              >
                                {parsedResult.fixedCode}
                              </ReactMarkdown>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Explanation */}
                      {parsedResult.explanation && (
                        <Card className="bg-white border-none shadow-lg overflow-hidden border-l-4 border-l-blue-500">
                          <CardHeader className="bg-[#f8f9fa] py-3 border-b border-black/5">
                            <div className="flex items-center gap-2">
                              <Info className="w-4 h-4 text-blue-500" />
                              <CardTitle className="text-xs font-mono uppercase tracking-widest">Explanation</CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent className="p-5">
                            <div className="markdown-body">
                              <ReactMarkdown>{parsedResult.explanation}</ReactMarkdown>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Execution Output */}
                      {executionResult && (
                        <Card className="bg-[#151619] border-none shadow-lg overflow-hidden border-l-4 border-l-green-500">
                          <CardHeader className="bg-[#1a1b1e] py-3 border-b border-white/5 flex flex-row items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Terminal className="w-4 h-4 text-green-500" />
                              <CardTitle className="text-xs font-mono uppercase tracking-widest text-white">Execution Output</CardTitle>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setExecutionResult(null)}
                              className="h-6 text-[10px] text-[#8E9299] hover:text-white hover:bg-white/5"
                            >
                              Clear
                            </Button>
                          </CardHeader>
                          <CardContent className="p-4 font-mono text-xs">
                            <ScrollArea className="max-h-[200px]">
                              <div className="space-y-1">
                                {executionResult.logs.length === 0 && !executionResult.error && (
                                  <p className="text-[#3A3B3F] italic">No output produced.</p>
                                )}
                                {executionResult.logs.map((log, i) => (
                                  <div key={`exec-log-${log.id}-${i}`} className="text-white/90 border-l border-white/10 pl-3 py-0.5">
                                    <span className="text-white/30 mr-2">{i + 1}</span>
                                    {log.text}
                                  </div>
                                ))}
                                {executionResult.error && (
                                  <div className="text-red-400 bg-red-400/10 p-2 rounded border border-red-400/20 mt-2">
                                    <span className="font-bold mr-2">Runtime Error:</span>
                                    {executionResult.error}
                                  </div>
                                )}
                              </div>
                            </ScrollArea>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>

          <TabsContent value="history" className="mt-0 focus-visible:outline-none">
            <div className="space-y-4">
              {history.length > 0 && (
                <div className="relative mb-6">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E9299]" />
                  <input 
                    type="text"
                    placeholder="Search memory by issue or code content..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full bg-white border border-[#E6E6E6] rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF4444]/20 focus:border-[#FF4444] transition-all shadow-sm"
                  />
                  {historySearch && (
                    <button 
                      onClick={() => setHistorySearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E9299] hover:text-[#151619]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {history.length === 0 ? (
                <Card className="bg-white border-none shadow-xl">
                  <CardContent className="p-12 flex flex-col items-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-[#E6E6E6] flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-[#8E9299]" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-bold italic font-serif">No Patterns Learned Yet</h3>
                      <p className="text-sm text-[#8E9299] max-w-xs">
                        Start debugging code to build a knowledge base of common issues and fixes.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <ScrollArea className="h-[600px] pr-4">
                  <div className="space-y-4 pb-4">
                    {history
                      .filter(item => 
                        item.issue.toLowerCase().includes(historySearch.toLowerCase()) || 
                        item.code.toLowerCase().includes(historySearch.toLowerCase()) ||
                        item.fixedCode.toLowerCase().includes(historySearch.toLowerCase())
                      )
                      .map((item, idx) => (
                      <motion.div
                        key={`${item.id}-${idx}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <Card className="bg-white border-none shadow-lg overflow-hidden group">
                          <CardHeader className="bg-[#151619] text-white py-3 flex flex-row items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${LANGUAGE_CONFIG[item.language]?.color.replace('text-', 'bg-') || 'bg-blue-500'}`} />
                              <CardTitle className="text-[10px] font-mono uppercase tracking-widest">
                                {item.language} • {new Date(item.timestamp).toLocaleString()}
                              </CardTitle>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setCode(item.code)}
                              className="h-6 px-2 text-[9px] text-white/50 hover:text-white hover:bg-white/10 uppercase tracking-widest font-mono"
                            >
                              Load Code
                            </Button>
                          </CardHeader>
                          <CardContent className="p-4 space-y-4">
                            <div>
                              <h4 className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299] mb-1">Identified Issue</h4>
                              <p className="text-sm text-[#151619] line-clamp-2">{item.issue}</p>
                            </div>
                            <Separator className="bg-[#E6E6E6]" />
                            <div>
                              <h4 className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299] mb-1">Fixed Pattern</h4>
                              <div className="rounded border border-[#E6E6E6] overflow-hidden">
                                <SyntaxHighlighter
                                  language={item.language}
                                  style={vscDarkPlus}
                                  customStyle={{ margin: 0, padding: '12px', fontSize: '11px' }}
                                >
                                  {item.fixedCode}
                                </SyntaxHighlighter>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>

        {/* Footer */}
        <footer className="pt-12 pb-8 border-t border-[#151619]/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4 text-[10px] font-mono text-[#8E9299] uppercase tracking-tighter">
              <span>Status: Operational</span>
              <Separator orientation="vertical" className="h-3 bg-[#151619]/10" />
              <span>Latency: 24ms</span>
              <Separator orientation="vertical" className="h-3 bg-[#151619]/10" />
              <span>Region: Global</span>
            </div>
            <p className="text-[10px] font-mono text-[#8E9299] uppercase tracking-tighter">
              &copy; 2024 DebugAI Systems. All rights reserved.
            </p>
          </div>
        </footer>
      </div>

      <style>{`
        .markdown-body h3 {
          font-family: 'Georgia', serif;
          font-style: italic;
          font-size: 1.1rem;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
          color: #151619;
          border-bottom: 1px solid #E6E6E6;
          padding-bottom: 0.25rem;
        }
        .markdown-body p {
          font-size: 0.95rem;
          line-height: 1.6;
          color: #4a4a4a;
          margin-bottom: 1rem;
        }
        .markdown-body strong {
          color: #151619;
        }
      `}</style>
    </div>
  );
}
