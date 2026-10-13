// How a tool the voice door runs failed: the one reading of child_process.spawnSync's result, for the voice kit,
// ffmpeg and the take aligner alike.

/** Why a spawned process failed, or null when it ran and exited 0 (a missing binary or a signal is a failure). */
export const failure = (done) => (done?.error ? done.error.message : done?.signal ? `signal ${done.signal}` : done?.status !== 0 ? `exit ${done?.status}` : null);

/** The last line a failed tool wrote to its captured stderr, as ": <line>" for a refusal; '' when it wrote none. */
export const lastLine = (done) => {
  const line = String(done?.stderr ?? '').trim().split('\n').at(-1);
  return line ? `: ${line}` : '';
};
