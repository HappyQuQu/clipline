from contextlib import contextmanager

from sqlalchemy.orm import Session

from app.services.settings import effective_config
from app.tasks.queue import Interrupted


class TaskContext:
    def __init__(self, queue, claim, stopped):
        self.queue, self.claim, self.stopped = queue, claim, stopped
        with Session(queue.engine) as session:
            self.config = effective_config(session, queue.config)
        if claim.kind == "prepare" and "playbackMaxWidth" in claim.payload:
            self.config = self.config.model_copy(
                update={"playback_max_width": claim.payload["playbackMaxWidth"]}
            )

    def check(self):
        if self.stopped.is_set():
            raise Interrupted()
        with Session(self.queue.engine) as session:
            self.queue.owned(session, self.claim)

    def update(self, stage, progress, checkpoint):
        self.check()
        self.queue.update(self.claim, stage, progress, checkpoint)

    @contextmanager
    def media_slot(self):
        key = None
        while key is None:
            self.check()
            key = self.queue.acquire_media(self.claim)
            if key is None:
                self.stopped.wait(0.1)
        try:
            yield
        finally:
            self.queue.release_media(self.claim, key)
