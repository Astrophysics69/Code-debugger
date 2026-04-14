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

function handleGenAIError(error: any): never {
  console.error("Gemini API Error:", error);
  
  const errorString = JSON.stringify(error).toLowerCase();
  const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted");

  if (error.message?.includes("fetch failed") || !window.navigator.onLine) {
    throw new Error("NETWORK_ERROR");
  }
  if (isQuotaError) {
    throw new Error("QUOTA_EXCEEDED");
  }
  if (error.message?.includes("401") || error.message?.includes("403") || error.message === "API_KEY_MISSING") {
    throw new Error("AUTH_ERROR");
  }
  if (error.message?.includes("safety") || error.message?.includes("blocked")) {
    throw new Error("SAFETY_ERROR");
  }
  
  throw error;
}

export async function debugCode(code: string, retryCount = 0): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout
  
  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: code,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 45000))
    ]);

    clearTimeout(timeoutId);
    if (!response.text) {
      throw new Error("EMPTY_RESPONSE");
    }

    return response.text;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error("TIMEOUT_ERROR");
    }
    const errorString = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted");

    // Auto-retry once for quota errors after a short delay
    if (isQuotaError && retryCount < 1) {
      console.log("Quota exceeded, retrying in 3 seconds...");
      await sleep(3000);
      return debugCode(code, retryCount + 1);
    }

    return handleGenAIError(error);
  }
}

export async function* debugCodeStream(code: string, retryCount = 0): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s for stream
  
  try {
    const response = await Promise.race([
      ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents: code,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 60000))
    ]);

    for await (const chunk of response) {
      yield chunk.text;
    }
    clearTimeout(timeoutId);
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error("TIMEOUT_ERROR");
    }
    const errorString = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted");

    if (isQuotaError && retryCount < 1) {
      console.log("Quota exceeded in stream, retrying in 3 seconds...");
      await sleep(3000);
      yield* debugCodeStream(code, retryCount + 1);
      return;
    }

    return handleGenAIError(error);
  }
}

export async function* refactorCodeStream(code: string, retryCount = 0): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
  const REFACTOR_INSTRUCTION = `
You are an expert software architect. Your goal is to suggest refactoring improvements for the provided code.
Focus on:
1. Performance optimizations.
2. Code simplification and readability.
3. Best practices and design patterns.
4. Reducing complexity.

Format your response using Markdown with the following sections:
- ### 🚀 Refactoring Suggestions
  (Bullet points of specific improvements)
- ### ✨ Refactored Code
  (Provide the improved code block with appropriate language highlighting)
- ### 🧠 Rationale
  (Explain why these changes improve the code)
`;

  try {
    const response = await Promise.race([
      ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents: code,
        config: {
          systemInstruction: REFACTOR_INSTRUCTION,
          temperature: 0.2,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 60000))
    ]);

    for await (const chunk of response) {
      yield chunk.text;
    }
    clearTimeout(timeoutId);
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error("TIMEOUT_ERROR");
    }
    const errorString = JSON.stringify(error).toLowerCase();
    const isQuotaError = errorString.includes("429") || errorString.includes("quota") || errorString.includes("resource_exhausted");

    if (isQuotaError && retryCount < 1) {
      console.log("Quota exceeded in refactor stream, retrying in 3 seconds...");
      await sleep(3000);
      yield* refactorCodeStream(code, retryCount + 1);
      return;
    }

    return handleGenAIError(error);
  }
}

export async function quickAnalysis(code: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s for quick analysis
  
  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: code,
        config: {
          systemInstruction: "You are a high-speed debugging engine. Provide a lightning-fast, precise summary of bugs and the fix. Be extremely concise. Use bullet points.",
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 15000))
    ]);

    clearTimeout(timeoutId);
    return response.text || "No issues found.";
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error("TIMEOUT_ERROR");
    }
    return handleGenAIError(error);
  }
}

export async function simulateExecution(code: string, language: string, variables?: Record<string, any>, stdin?: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s for simulation
  
  const variablesContext = variables && Object.keys(variables).length > 0 
    ? `\n\nCONTEXT VARIABLES:\n${Object.entries(variables).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')}`
    : '';
    
  const stdinContext = stdin ? `\n\nSTANDARD INPUT (stdin):\n${stdin}` : '';

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

      ${variablesContext}
      ${stdinContext}
      
      CODE TO SIMULATE:
      ${code}`,
        config: {
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AbortError")), 45000))
    ]);

    clearTimeout(timeoutId);
    return response.text || "No output produced.";
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return "Error: AI Simulation timed out (45s). The code might be too complex or the service is slow.";
    }
    // Re-throw so App.tsx can handle categorization and cooldowns
    return handleGenAIError(error);
  }
}
