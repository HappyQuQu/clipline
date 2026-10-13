import anyio
from fastapi.responses import StreamingResponse


class ClosingStreamingResponse(StreamingResponse):
    def __init__(self, iterator, *, close=None, **kwargs):
        self.iterator, self.close_callback = iterator, close
        super().__init__(iterator, **kwargs)

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:

            def release():
                try:
                    self.iterator.close()
                finally:
                    if self.close_callback:
                        self.close_callback()

            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(release)
