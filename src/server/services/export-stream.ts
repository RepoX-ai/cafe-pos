/**
 * Adapts a CSV chunk generator to a byte stream for a Response body.
 *
 * Pull-based with a high-water mark of one chunk: the generator is advanced
 * only when the reader has taken the previous chunk, so a slow download
 * slows the export instead of buffering it. Cancelling the stream, or the
 * request's abort signal firing, calls `return()` on the generator, which
 * runs its cleanup (rollback + connection release).
 */
export function toByteStream(
  chunks: AsyncGenerator<string, void, undefined>,
  opts: { signal?: AbortSignal; onError?: (error: unknown) => void } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const stop = () => {
    void chunks.return(undefined).catch(() => undefined);
  };
  opts.signal?.addEventListener("abort", stop, { once: true });
  const detach = () => opts.signal?.removeEventListener("abort", stop);

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { value, done } = await chunks.next();
          if (done) {
            detach();
            controller.close();
          } else {
            controller.enqueue(encoder.encode(value));
          }
        } catch (error) {
          detach();
          opts.onError?.(error);
          controller.error(new Error("Export failed"));
        }
      },
      cancel() {
        detach();
        stop();
      },
    },
    { highWaterMark: 1 },
  );
}
