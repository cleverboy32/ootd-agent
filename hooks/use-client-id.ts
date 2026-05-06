import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

const CLIENT_ID_KEY = 'ootd-agent-client-id';

export const useClientId = () => {
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    // localStorage is only available in the browser.
    if (typeof window !== 'undefined') {
      let id = localStorage.getItem(CLIENT_ID_KEY);
      if (!id) {
        id = uuidv4();
        localStorage.setItem(CLIENT_ID_KEY, id);
      }
      setClientId(id);
    }
  }, []);

  return clientId;
};
