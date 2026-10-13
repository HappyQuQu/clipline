import sys
from urllib.error import URLError
from urllib.request import urlopen

from app.core.config import AppConfig


def main() -> None:
    try:
        with urlopen(
            f"http://127.0.0.1:{AppConfig().port}/api/health/ready", timeout=3
        ) as response:
            healthy = response.status == 200
    except (OSError, URLError):
        healthy = False
    sys.exit(0 if healthy else 1)


if __name__ == "__main__":
    main()
