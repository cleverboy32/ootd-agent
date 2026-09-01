import { getClientId, withBasePath } from '@/lib/utils';

/**
 * A base fetch wrapper that sends the configured owner id as a routing hint.
 * The server proxy always overwrites this header and remains the identity authority.
 * @param url The request URL.
 * @param options The standard `fetch` options object.
 * @returns A Promise that resolves to the fetch Response.
 */
async function fetchWithClient(url: string, options: RequestInit = {}): Promise<Response> {

  const clientId = getClientId();

  // 2. Create new headers
  const headers = new Headers(options.headers);
  headers.set('X-Client-ID', clientId);
  
  // Set Content-Type for JSON bodies if not already set
  if (options.body && typeof options.body === 'string') {
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
  }

  // 3. Build the new options object
  const newOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'same-origin',
  };

  // 4. Make the actual fetch request
  let response: Response;
  try {
    const resolvedUrl = url.startsWith("/") ? withBasePath(url) : url;
    response = await fetch(resolvedUrl, newOptions);
  } catch {
    throw new Error('Failed to fetch');
  }

  // 5. [Recommended] Add generic error handling
  if (!response.ok) {
    // Try to parse the error body
    const errorBody = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
    // Throw an error with more info for the upper layer to catch
    throw new Error(errorBody.error || errorBody.message || `HTTP error! Status: ${response.status}`);
  }

  return response;
}

// 6. Create a more user-friendly apiClient object
export const apiClient = {
  get: async (url: string, options: RequestInit = {}) => {
    const response = await fetchWithClient(url, { ...options, method: 'GET' });
    return response.json(); // Automatically parse JSON
  },

  post: async <T>(url: string, body: T, options: RequestInit = {}) => {
    const response = await fetchWithClient(url, { ...options, method: 'POST', body: JSON.stringify(body) });
    return response.json();
  },

  patch: async <T>(url: string, body: T, options: RequestInit = {}) => {
    const response = await fetchWithClient(url, { ...options, method: 'PATCH', body: JSON.stringify(body) });
    return response.json();
  },

  delete: async (url: string, options: RequestInit = {}) => {
    const response = await fetchWithClient(url, { ...options, method: 'DELETE' });
    // DELETE requests often return 204 No Content, so we return the raw response
    return response;
  },
  
  // For streaming responses, we can't auto-parse JSON, so we need a special method
  postAndGetStream: <T>(url:string, body: T, options: RequestInit = {}) => {
    return fetchWithClient(url, { ...options, method: 'POST', body: JSON.stringify(body) });
  }
};