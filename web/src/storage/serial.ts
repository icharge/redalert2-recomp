/** A queue of async tasks: each starts when the one before it has settled. */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const next = last.then(task, task);
    last = next.catch(() => {});
    return next;
  };
}
