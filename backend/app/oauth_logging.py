"""Remove query strings from Uvicorn request logs, including rejected credentials."""
import logging


class RedactQuery(logging.Filter):
    def filter(self, record):
        # Uvicorn access logger arguments: peer, method, path, version, status.
        if isinstance(record.args, tuple) and len(record.args) == 5:
            args = list(record.args)
            if isinstance(args[2], str):
                args[2] = args[2].split('?', 1)[0]
            record.args = tuple(args)
        return True


def install():
    logger = logging.getLogger('uvicorn.access')
    if not any(isinstance(item, RedactQuery) for item in logger.filters):
        logger.addFilter(RedactQuery())
