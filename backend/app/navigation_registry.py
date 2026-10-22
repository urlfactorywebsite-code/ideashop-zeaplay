"""Page ceilings mirror established routes; policies can only narrow these roles."""
from dataclasses import dataclass

from .models import RoleEnum

ALL = tuple(role.value for role in RoleEnum)
STAFF = ('manager', 'admin', 'owner')
ADMINS = ('admin', 'owner')


@dataclass(frozen=True)
class Page:
    id: str
    label: str
    route: str
    roles: tuple[str, ...] = ALL
    parent: str | None = None
    location: str = 'sidebar'
    protected: bool = False


PAGES = [
    Page('dashboard', 'Dashboard', '/dashboard', protected=True),
    Page('tasks', 'All Tasks', '/tasks'),
    Page('tasks.list', 'All Tasks', '/tasks', ALL, 'tasks', 'task-tab', True),
    Page('chat', 'Chat', '/chat'),
    Page('authorized-apps', 'Authorized apps', '/settings/oauth/authorized-apps', parent='settings.oauth', location='settings-tab'),
    Page('projects', 'Projects', '/projects'),
    Page('kanban', 'Kanban Board', '/tasks/kanban', ALL, 'tasks', 'task-tab'),
    Page('tickets', 'Ticket', '/tickets'),
    Page('management', 'Management', '/management', STAFF),
    Page('users', 'Users Management', '/management/users', STAFF, 'management', 'management-tab'),
    Page('clients', 'Clients', '/management/clients', STAFF, 'management', 'management-tab'),
    Page('gantt', 'Gantt Chart', '/tasks/gantt', STAFF, 'tasks', 'task-tab'),
    Page('reports', 'Reports', '/reports'),
    Page('achievements', 'Achievements', '/achievements'),
    Page('settings', 'Settings', '/settings', protected=True),
    Page('calendar', 'Calendar', '/tasks/calendar', ALL, 'tasks', 'task-tab'),
    Page('tool-library', 'Tool Library', '/tool-library'),
    Page('levels', 'Levels', '/levels', parent='achievements'),
    Page('rewards', 'Rewards', '/admin/rewards', STAFF, parent='achievements'),
    Page('points-table', 'Points Table', '/admin/points-table', ('owner',), parent='achievements'),
    Page('template-editor', 'Template Editor', '/template-editor', ('owner',), parent='achievements'),
    Page('settings.profile', 'General / Profile', '/settings/profile', parent='settings', location='settings-tab', protected=True),
    Page('settings.support', 'Support', '/settings/support', parent='settings', location='settings-tab'),
    Page('settings.api', 'API', '/settings/api', ADMINS, 'settings', 'settings-tab'),
    Page('settings.oauth', 'OAuth', '/settings/oauth', ALL, 'settings', 'settings-tab'),
    Page('settings.logs', 'Logs', '/settings/logs', STAFF, 'settings', 'settings-tab'),
    Page('settings.media-library', 'Media Library', '/settings/media-library', ALL, 'settings', 'settings-tab'),
    Page('settings.sidebar-management', 'Sidebar Management', '/settings/sidebar-management', ADMINS, 'settings', 'settings-tab', True),
    Page('settings.push', 'Push notifications', '/settings/push', ALL, 'settings', 'settings-tab'),
]
REGISTRY = {page.id: page for page in PAGES}

# Immutable permission ceilings for existing API subsections, shared with clients.
API_SECTIONS = [
    ('overview', 'Overview', ('owner',)),
    ('documentation', 'Documentation', ('owner',)),
    ('token', 'Bearer Key Builder', ('owner',)),
    ('webhooks', 'Webhooks', ('owner',)),
    ('smtp', 'SMTP', ADMINS),
]


def api_pages(path: str, method: str) -> tuple[str, ...]:
    """Shared reads stay independently authorized; dedicated module APIs are gated.

    HashRouter URLs cannot reach the server, so /navigation also returns decisions
    used by frontend route guards. This hook adds policy checks to protected APIs.
    Existing endpoint dependencies always remain in force.
    """
    path = path.removeprefix('/api').rstrip('/')
    root = path.split('/')[1] if path.startswith('/') else ''
    if path == '/auth/register':
        return ('users',)
    direct = {'tasks': 'tasks', 'kanban': 'kanban', 'projects': 'projects', 'clients': 'clients',
              'contacts': 'clients', 'reports': 'reports', 'tickets': 'tickets', 'chat': 'chat',
              'tool-library': 'tool-library', 'achievements': 'achievements', 'badges': 'achievements',
              'levels': 'levels', 'rewards': 'achievements', 'logs': 'settings.logs',
              'media': 'settings.media-library',
              'push': 'settings.push', 'webhooks': 'settings.api'}
    if root == 'support':
        return ('settings.support',)
    if path.startswith('/internal/webhooks'):
        return ('settings.api',)
    if path == '/config/points':
        return ('points-table',)
    if root == 'users' and method not in {'GET', 'HEAD'}:
        # Self-service profile/password/avatar endpoints are recovery functions.
        if path in {'/users/me', '/users/me/change-password', '/users/me/avatar'}:
            return ()
        return ('users',)
    if path.startswith(('/config/smtp', '/config/multiple-smtp', '/smtp')):
        return ('settings.api',)
    if path.startswith('/config/oauth'):
        return ('settings.oauth',)
    if path.startswith(('/config/api', '/config/multiple-api', '/config/email-templates', '/integrations/n8n')):
        return ('settings.api',)
    if root == 'oauth2':
        # Protocol, consent, revoke-own-grant and first-party profile remain usable.
        if path.endswith('/revoke') or path in {'/oauth2/revoke', '/oauth2/profile'}:
            return ()
        if path == '/oauth2/my-grants':
            return ('authorized-apps',)
        if path.startswith(('/oauth2/clients', '/oauth2/tokens', '/oauth2/grants', '/oauth2/events', '/oauth2/dashboard')):
            return ('settings.oauth',)
        return ()
    if path in {'/push/unsubscribe', '/media/avatar/finalize'}:
        return ()
    if root in direct:
        return (direct[root],)
    return ()
