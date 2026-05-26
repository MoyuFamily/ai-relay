// ============================================================
// AI API Relay — Shared Type Definitions
// ============================================================

/** OpenAI-compatible chat completion request */
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: unknown;
  // Allow passthrough of any other params
  [key: string]: unknown;
}

/** OpenAI-compatible chat completion response */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: unknown[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** OpenAI Responses API request (/v1/responses) */
export interface ResponsesAPIRequest {
  model: string;
  input: string | Array<unknown>;
  instructions?: string;
  stream?: boolean;
  tools?: unknown[];
  temperature?: number;
  // Allow passthrough of any other params
  [key: string]: unknown;
}

/** Error response in OpenAI format */
export interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code: string | number;
  };
}
