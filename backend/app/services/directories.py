import os
from pathlib import Path

from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor


class RecordingDirectories:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def resolve(self, value: str, *, relative: bool = False) -> Path:
        if not isinstance(value, str) or any(ord(char) < 32 for char in value) or "\\" in value:
            raise AppError("INVALID_SOURCE_PATH", "录像目录格式不正确。")
        path = Path(value.strip())
        if ".." in path.parts or (relative and path.is_absolute()):
            raise AppError("SOURCE_PATH_OUTSIDE_ROOT", "请选择允许录像目录内的文件夹。")
        if not relative and not path.is_absolute():
            raise AppError("INVALID_SOURCE_PATH", "请输入容器内的完整录像目录。")
        path = self.root / path if relative else path
        if not path.is_relative_to(self.root):
            raise AppError("SOURCE_PATH_OUTSIDE_ROOT", "请选择允许录像目录内的文件夹。")
        try:
            resolved = path.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise AppError(
                "SOURCE_PATH_UNAVAILABLE", "录像目录不存在或暂时无法访问。", 404
            ) from error
        if not resolved.is_relative_to(self.root):
            raise AppError("SOURCE_PATH_OUTSIDE_ROOT", "请选择允许录像目录内的文件夹。")
        if not resolved.is_dir():
            raise AppError("SOURCE_PATH_NOT_DIRECTORY", "所选路径不是目录。")
        if not os.access(resolved, os.R_OK | os.X_OK):
            raise AppError("SOURCE_PATH_UNREADABLE", "录像目录不可读，请检查挂载权限。", 403)
        return resolved

    def browse(self, root_id: str, relative_path: str, cursor: str | None, limit: int) -> dict:
        if root_id != "default":
            raise AppError("UNKNOWN_RECORDING_ROOT", "录像根目录不存在。", 404)
        directory = self.resolve(relative_path, relative=True)
        context = str(directory)
        position = decode_cursor(cursor, context)
        entries = []
        try:
            with os.scandir(directory) as scan:
                for count, entry in enumerate(scan):
                    if count >= 10_000:
                        raise AppError("DIRECTORY_TOO_LARGE", "目录项过多，请缩小浏览目录。", 413)
                    if entry.name.startswith("."):
                        continue
                    try:
                        child = self.resolve(entry.path)
                    except AppError:
                        continue
                    entries.append(
                        {
                            "name": entry.name,
                            "path": str(child),
                            "relativePath": child.relative_to(self.root).as_posix(),
                        }
                    )
        except OSError as error:
            raise AppError(
                "SOURCE_PATH_UNREADABLE", "无法读取录像目录，请检查挂载权限。", 403
            ) from error
        entries.sort(key=lambda item: item["name"])
        page = [entry for entry in entries if position is None or entry["name"] > position]
        has_more = len(page) > limit
        page = page[:limit]
        return {
            "roots": [{"id": "default", "path": str(self.root), "name": "录像目录"}],
            "rootId": root_id,
            "path": str(directory),
            "relativePath": directory.relative_to(self.root).as_posix(),
            "items": page,
            "nextCursor": encode_cursor(context, page[-1]["name"]) if has_more else None,
        }
