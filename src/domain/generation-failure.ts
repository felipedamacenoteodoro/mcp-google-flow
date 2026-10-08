/**
 * Turns Flow's failure text into advice the agent can pass on. The server
 * never tries to get around Flow's abuse protection; it only explains it.
 */
export function adviceForFailure(reason: string): string {
  if (/atividade incomum|unusual activity|actividad inusual/i.test(reason)) {
    return (
      "Flow's abuse protection flagged this browser session. This server does not try to get around it. " +
      'Pause for a while before trying again, generate fewer videos back to back, turn off extensions that change web pages ' +
      '(translators, ad blockers) in the Chrome profile Flow runs in, and use Flow normally in that same profile for a bit. ' +
      'If it keeps happening, set FLOW_MCP_SUBMIT=manual: everything is still prepared for you, and you click generate yourself.'
    );
  }
  if (/áudio|audio/i.test(reason)) {
    return 'Flow could not voice the line. Try a shorter, simpler spoken line, or the same shot without dialogue.';
  }
  return 'Try a different prompt.';
}
