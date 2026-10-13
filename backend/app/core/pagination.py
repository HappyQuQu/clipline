import base64
import binascii
import json

from app.core.errors import AppError


def encode_cursor(context: str, position: str) -> str:
    raw = json.dumps({"context": context, "position": position}, ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(value: str | None, context: str) -> str | None:
    if value is None:
        return None
    try:
        raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        payload = json.loads(raw)
        if (
            not isinstance(payload, dict)
            or set(payload) != {"context", "position"}
            or payload["context"] != context
            or not isinstance(payload["position"], str)
        ):
            raise ValueError("Cursor does not belong to this query")
        return payload["position"]
    except (ValueError, UnicodeDecodeError, binascii.Error) as error:
        raise AppError("INVALID_CURSOR", "分页位置已失效，请重新加载。") from error
