import { useState } from 'react';

export interface SubmitGuard {
  /** True when this submit may proceed; false while an earlier one is still running. */
  begin: () => boolean;
  /** The request has settled (success or failure): the next submit may run. */
  end: () => void;
}

function createGuard(): SubmitGuard {
  let busy = false;
  return {
    begin() {
      if (busy) return false;
      busy = true;
      return true;
    },
    end() {
      busy = false;
    },
  };
}

/**
 * Synchronous double-submit lock. A mutation's `isPending` only changes on
 * the next render, so two quick taps could both pass a state check and send
 * two requests; this flag flips at once and the second tap is ignored.
 */
export function useSubmitGuard(): SubmitGuard {
  const [guard] = useState(createGuard);
  return guard;
}
