import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const SYSTEM_INSTRUCTION = `
You are an elite software debugging assistant. Your ONLY purpose is to analyze, debug, and explain code. 

RULES:
1. If the user submits text that is NOT related to code, programming, debugging, or software architecture, you must reply exactly with: "🛑 **Access Denied:** I am a specialized debugging assistant. I only process and explain code. Please submit a valid code snippet."
2. Do not answer general knowledge questions, write essays, or provide recipes.
3. If the input IS code-related:
   a. If the code is CORRECT and has no bugs:
      - Skip the "Identified Issue", "Buggy Snippet", and "Fixed Code" sections.
      - Provide ONLY the following section:
        - ### 🧠 Explanation
          (Start by explicitly stating the code is correct, then explain clearly what the code does)
   b. If the code HAS BUGS:
      - Format your response using Markdown with the following sections in this exact order:
        - ### 🔍 Identified Issue
          (Briefly state what is wrong)
        - ### ❌ Buggy Snippet
          (Show the specific part of the code that is wrong. Use comments like // BUG HERE to point out errors)
        - ### ✅ Fixed Code
          (Provide the corrected code block with appropriate language highlighting)
        - ### 🧠 Explanation
          (Explain clearly why it was broken and how the fix works)
`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Simple in-memory cache to save quota
const analysisCache = new Map<string, { result: string; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 10; // 10 minutes

function getCachedResult(code: string): string | null {
  const cached = analysisCache.get(code);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  return null;
}

function setCachedResult(code: string, result: string) {
  analysisCache.set(code, { result, timestamp: Date.now() });
}

function handleGenAIError(error: any): never {
  console.error("Gemini API Error Detail:", error);
  
  const errorString = JSON.stringify(error).toLowerCase();
  const errorMessage = (error.message || "").toLowerCase();
  
  // Network issues
  if (errorMessage.includes("fetch failed") || errorMessage.includes("network") || !window.navigator.onLine) {
    throw new Error("NETWORK_ERROR");
  }

  // Quota / Rate limits
  const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted") || errorMessage.includes("rate limit");
  if (isQuotaError) {
    throw new Error("QUOTA_EXCEEDED");
  }

  // Authentication / API Key
  if (errorMessage.includes("401") || errorMessage.includes("unauthorized") || errorMessage.includes("invalid api key") || error.message === "API_KEY_MISSING") {
    throw new Error("API_KEY_INVALID");
  }
  if (errorMessage.includes("403") || errorMessage.includes("permission denied")) {
    throw new Error("AUTH_ERROR");
  }

  // Safety / Content filtering
  if (errorMessage.includes("safety") || errorMessage.includes("blocked") || errorMessage.includes("candidate was blocked") || errorString.includes("finishreason: safety")) {
    throw new Error("SAFETY_ERROR");
  }

  // Model availability
  if (errorMessage.includes("503") || errorMessage.includes("service unavailable") || errorMessage.includes("overloaded")) {
    throw new Error("SERVICE_UNAVAILABLE");
  }
  
  throw error;
}

export async function debugCode(code: string, history?: string[], retryCount = 0): Promise<string> {
  const cached = getCachedResult(code);
  if (cached && retryCount === 0) return cached;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout
  
  const historyContext = history && history.length > 0 
    ? `\n\nPREVIOUSLY SOLVED PROBLEMS (LEARNING CONTEXT):\n${history.join('\n---\n')}\nUse these to identify recurring patterns or user coding style.`
    : '';

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: historyContext ? `${historyContext}\n\nCURRENT CODE TO ANALYZE:\n${code}` : code,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 120000))
    ]);

    clearTimeout(timeoutId);
    if (!response.text) {
      throw new Error("EMPTY_RESPONSE");
    }

    setCachedResult(code, response.text);
    return response.text;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError' || error.message === 'AbortError') {
      throw new Error("TIMEOUT_ERROR");
    }
    const errorString = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted");

    // Exponential backoff retry
    if (isQuotaError && retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 3000;
      console.log(`Quota exceeded, retrying in ${delay/1000} seconds...`);
      await sleep(delay);
      return debugCode(code, history, retryCount + 1);
    }

    return handleGenAIError(error);
  }
}

export async function* debugCodeStream(code: string, isTurbo = false, history?: string[], retryCount = 0): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s for stream
  
  const historyContext = history && history.length > 0 
    ? `\n\nPREVIOUSLY SOLVED PROBLEMS (LEARNING CONTEXT):\n${history.join('\n---\n')}\nUse these to identify recurring patterns or user coding style.`
    : '';

  try {
    const response = await Promise.race([
      ai.models.generateContentStream({
        model: isTurbo ? "gemini-3.1-flash-lite-preview" : "gemini-3-flash-preview",
        contents: historyContext ? `${historyContext}\n\nCURRENT CODE TO ANALYZE:\n${code}` : code,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.1,
          thinkingConfig: isTurbo ? { thinkingLevel: ThinkingLevel.MINIMAL } : { thinkingLevel: ThinkingLevel.LOW }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 120000))
    ]);

    for await (const chunk of response) {
      yield chunk.text;
    }
    clearTimeout(timeoutId);
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError' || error.message === 'AbortError') {
      throw new Error("TIMEOUT_ERROR");
    }
    const errorString = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted");

    if (isQuotaError && retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 3000;
      console.log(`Quota exceeded in stream, retrying in ${delay/1000} seconds...`);
      await sleep(delay);
      yield* debugCodeStream(code, isTurbo, history, retryCount + 1);
      return;
    }

    return handleGenAIError(error);
  }
}

export async function quickAnalysis(code: string, retryCount = 0): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s for quick analysis
  
  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: code,
        config: {
          systemInstruction: "You are a high-speed debugging engine. Provide a lightning-fast, precise summary of bugs and the fix. Be extremely concise. Use bullet points.",
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 30000))
    ]);

    clearTimeout(timeoutId);
    return response.text || "No issues found.";
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError' || error.message === 'AbortError') {
      throw new Error("TIMEOUT_ERROR");
    }
    const errorString = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted");

    if (isQuotaError && retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 3000;
      console.log(`Quota exceeded in quick analysis, retrying in ${delay/1000} seconds...`);
      await sleep(3000);
      return quickAnalysis(code, retryCount + 1);
    }
    return handleGenAIError(error);
  }
}

export async function simulateExecution(code: string, language: string, variables?: Record<string, any>, stdin?: string, retryCount = 0): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 150000); // 150s for simulation
  
  const variablesContext = variables && Object.keys(variables).length > 0 
    ? `\n\nCONTEXT VARIABLES:\n${Object.entries(variables).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')}`
    : '';
    
  const stdinContext = stdin ? `\n\nSTANDARD INPUT (stdin):\n${stdin}` : '';

  let languageSpecificInstructions = '';
  const lowerLang = language.toLowerCase();
  
  if (lowerLang === 'cpp' || lowerLang === 'c') {
    languageSpecificInstructions = `
      6. For C/C++, handle pointer arithmetic, memory allocation (malloc/free, new/delete), and standard library containers (std::vector, std::map, etc.) with extreme care.
      7. Simulate undefined behavior (like out-of-bounds access) as a crash or error message if applicable.
      8. Ensure standard output formatting (like printf or cout) is exact.`;
  } else if (lowerLang === 'javascript' || lowerLang === 'typescript' || lowerLang === 'js' || lowerLang === 'ts') {
    languageSpecificInstructions = `
      6. For JavaScript/TypeScript, simulate the event loop, promises, and async/await behavior accurately.
      7. Handle prototype chain, closures, and 'this' context correctly.
      8. If DOM APIs are used, simulate their basic behavior (e.g., document.querySelector returning a mock element).
      9. Support modern ESNext features and common Node.js globals if applicable.`;
  } else if (lowerLang === 'python' || lowerLang === 'py' || lowerLang === 'python3') {
    languageSpecificInstructions = `
      6. For Python, simulate indentation-based scoping, list comprehensions, and generators accurately.
      7. Handle Python-specific data structures like dictionaries, sets, and tuples correctly.
      8. Simulate common library behaviors (e.g., math, datetime, collections) if they are imported.
      9. Respect Python 3.x syntax and standard library expectations.`;
  } else if (lowerLang === 'react' || lowerLang === 'jsx' || lowerLang === 'tsx') {
    languageSpecificInstructions = `
      6. For React, simulate the component lifecycle, hooks (useState, useEffect, useMemo, etc.), and state updates accurately.
      7. Handle JSX/TSX rendering logic, props passing, and conditional rendering.
      8. Simulate the Virtual DOM behavior and how state changes trigger re-renders.
      9. If event handlers are present, simulate their execution and subsequent state transitions.
      10. Provide a textual representation of the rendered UI structure if applicable, alongside console logs.`;
  } else if (lowerLang === 'json') {
    languageSpecificInstructions = `
      6. For JSON, validate the structure and provide a pretty-printed version of the data.
      7. If the JSON represents a configuration or a specific data model, explain its structure and potential usage.
      8. Identify any syntax errors or potential schema violations if a schema is implied.`;
  }

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `You are a high-precision code execution engine. 
      Your goal is to simulate the following ${language} code with 95%+ accuracy.
      
      RULES:
      1. Track all variable states internally step-by-step.
      2. Handle all loops, conditionals, and complex logic precisely.
      3. Respect the provided Standard Input (stdin) for all input operations.
      4. Provide ONLY the final terminal output (stdout/stderr).
      5. No explanations, no markdown, just raw text output.
      ${languageSpecificInstructions}

      ${variablesContext}
      ${stdinContext}
      
      CODE TO SIMULATE:
      ${code}`,
        config: {
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 150000))
    ]);

    clearTimeout(timeoutId);
    return response.text || "No output produced.";
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError' || error.message === 'AbortError') {
      return "Error: AI Simulation timed out (150s). The code might be too complex or the service is slow.";
    }
    const errorString = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted");

    if (isQuotaError && retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 3000;
      console.log(`Quota exceeded in simulation, retrying in ${delay/1000} seconds...`);
      await sleep(delay);
      return simulateExecution(code, language, variables, stdin, retryCount + 1);
    }
    // Re-throw so App.tsx can handle categorization and cooldowns
    return handleGenAIError(error);
  }
}
