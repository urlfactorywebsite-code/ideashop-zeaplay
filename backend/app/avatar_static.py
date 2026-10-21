"""Keep private avatar files out of the existing public media mounts."""
import posixpath
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles


class AvatarSafeStaticFiles(StaticFiles):
    @staticmethod
    def _private(path):
        normalized = posixpath.normpath(str(path).replace('\\', '/')).strip('/').casefold()
        return '.avatars' in normalized.split('/') or normalized == 'avatars/custom' or normalized.startswith('avatars/custom/')

    async def get_response(self, path, scope):
        if self._private(path):
            raise HTTPException(404)
        # Also reject an alias/symlink that resolves into a private directory.
        for directory in self.all_directories:
            try:
                root = Path(directory).resolve()
                candidate = (root / path).resolve()
            except (OSError, ValueError) as exc:
                raise HTTPException(404) from exc
            if candidate.is_relative_to(root) and self._private(candidate.relative_to(root)):
                raise HTTPException(404)
        return await super().get_response(path, scope)
